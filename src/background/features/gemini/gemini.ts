import type { FileDataAttachmentPayload } from '../../../shared/runtime';
import type { GeminiSettings } from '../../../shared/settings';
import { isRecord, toErrorMessage } from '../../core/utils';
import type { ChatSession, GeminiContent } from '../session/types';
import { getGeminiClient } from './gemini-client';
import { composeGeminiInteractionRequest } from './gemini-request';
import { normalizeContent } from './gemini/content-normalize';
import {
  extractAttachments,
  renderContentForChat,
  renderThinkingSummaryForChat,
} from './gemini/content-render';
import type { GeminiStreamDelta, SDKCreateInteractionRequest } from './gemini/contracts';
import {
  InvalidPreviousInteractionIdError,
  isInvalidPreviousInteractionIdError,
} from './gemini/errors';
import {
  buildFunctionResponsePart,
  buildFunctionResultInput,
  buildInteractionInputFromContent,
  executeFunctionCalls,
  extractAssistantContent,
  extractFunctionCalls,
  extractGroundingSources,
} from './gemini/function-calls';
import { callGeminiInteraction, callGeminiInteractionStream } from './gemini/interaction';
import { getLocalFunctionDeclarations } from './gemini/local-tools';
import {
  accumulateUsageTotals,
  buildAssistantResponseStats,
  createEmptyUsageTotals,
  getMonotonicNowMs,
  withAssistantInteractionMetadata,
  withAssistantResponseStats,
  withGroundingSources,
} from './gemini/stats';
import {
  SESSION_TITLE_MODEL,
  buildSessionTitlePrompt,
  sanitizeGeneratedSessionTitle,
} from './gemini/title';

export { InvalidPreviousInteractionIdError, isInvalidPreviousInteractionIdError };
export type { GeminiStreamDelta };
export { normalizeContent, renderContentForChat, renderThinkingSummaryForChat, extractAttachments };

export async function completeAssistantTurn(
  session: ChatSession,
  settings: GeminiSettings,
  thinkingLevel?: string,
  onStreamDelta?: (delta: GeminiStreamDelta) => void,
): Promise<GeminiContent> {
  const latestContent = session.contents.at(-1);
  if (!latestContent || latestContent.role !== 'user') {
    throw new Error('Expected a user message before requesting an assistant turn.');
  }

  const functionDeclarations = getLocalFunctionDeclarations();
  const thinkingOpts = thinkingLevel ? { thinkingLevel } : {};
  let pendingInput = buildInteractionInputFromContent(latestContent);
  const initialRequestInput: Parameters<typeof composeGeminiInteractionRequest>[0] = {
    settings,
    input: pendingInput,
    functionDeclarations,
    ...thinkingOpts,
  };
  if (session.lastInteractionId) {
    initialRequestInput.previousInteractionId = session.lastInteractionId;
  }

  let requestPlan = composeGeminiInteractionRequest(initialRequestInput);
  const { functionCallingEnabled } = requestPlan;
  let latestAssistantContent: GeminiContent | null = null;
  const requestStartedAtMs = getMonotonicNowMs();
  let firstStreamTokenAtMs: number | null = null;
  const usageTotals = createEmptyUsageTotals();
  const streamDeltaHandler = onStreamDelta
    ? (delta: GeminiStreamDelta): void => {
        if ((delta.textDelta || delta.thinkingDelta) && firstStreamTokenAtMs === null) {
          firstStreamTokenAtMs = getMonotonicNowMs();
        }
        onStreamDelta(delta);
      }
    : undefined;

  for (let roundTrip = 0; roundTrip < settings.maxToolRoundTrips; roundTrip += 1) {
    const interaction = await callGeminiInteractionWithFunctionResultRetry({
      settings,
      requestPlan,
      pendingInput,
      functionDeclarations,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(streamDeltaHandler ? { onStreamDelta: streamDeltaHandler } : {}),
    });
    accumulateUsageTotals(usageTotals, interaction.usage);

    session.lastInteractionId = interaction.id;

    const candidateContent = withGroundingSources(
      withAssistantInteractionMetadata(
        extractAssistantContent(interaction),
        interaction.id,
        settings.model,
      ),
      extractGroundingSources(interaction),
    );
    session.contents.push(candidateContent);
    latestAssistantContent = candidateContent;

    if (!functionCallingEnabled) {
      const finalContent = finalizeAssistantContent(candidateContent, {
        usageTotals,
        requestStartedAtMs,
        firstStreamTokenAtMs,
      });
      session.contents[session.contents.length - 1] = finalContent;
      return finalContent;
    }

    const functionCalls = extractFunctionCalls(candidateContent.parts);
    if (functionCalls.length === 0) {
      const finalContent = finalizeAssistantContent(candidateContent, {
        usageTotals,
        requestStartedAtMs,
        firstStreamTokenAtMs,
      });
      session.contents[session.contents.length - 1] = finalContent;
      return finalContent;
    }

    const executedCalls = await executeFunctionCalls(functionCalls);
    session.contents.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: executedCalls.map((call) => buildFunctionResponsePart(call.call, call.response)),
    });
    pendingInput = executedCalls.map((call) => buildFunctionResultInput(call));
    requestPlan = composeGeminiInteractionRequest({
      settings,
      input: pendingInput,
      functionDeclarations,
      previousInteractionId: interaction.id,
      ...thinkingOpts,
    });
  }

  if (latestAssistantContent) {
    const finalContent = finalizeAssistantContent(latestAssistantContent, {
      usageTotals,
      requestStartedAtMs,
      firstStreamTokenAtMs,
    });
    for (let index = session.contents.length - 1; index >= 0; index -= 1) {
      if (session.contents[index]?.role === 'model') {
        session.contents[index] = finalContent;
        break;
      }
    }
    return finalContent;
  }

  throw new Error('Gemini did not produce a final response before the tool round-trip limit.');
}

function finalizeAssistantContent(
  content: GeminiContent,
  input: {
    usageTotals: ReturnType<typeof createEmptyUsageTotals>;
    requestStartedAtMs: number;
    firstStreamTokenAtMs: number | null;
  },
): GeminiContent {
  const completedAtMs = getMonotonicNowMs();
  return withAssistantResponseStats(
    content,
    buildAssistantResponseStats({
      usageTotals: input.usageTotals,
      requestStartedAtMs: input.requestStartedAtMs,
      firstStreamTokenAtMs: input.firstStreamTokenAtMs,
      completedAtMs,
    }),
  );
}

async function callGeminiInteractionWithFunctionResultRetry(input: {
  settings: GeminiSettings;
  requestPlan: ReturnType<typeof composeGeminiInteractionRequest>;
  pendingInput: Array<Record<string, unknown>>;
  functionDeclarations: Array<Record<string, unknown>>;
  thinkingLevel?: string;
  onStreamDelta?: (delta: GeminiStreamDelta) => void;
}): Promise<Awaited<ReturnType<typeof callGeminiInteraction>>> {
  try {
    return await callGeminiInteractionWithOptionalStreaming({
      settings: input.settings,
      request: input.requestPlan.request,
      ...(input.onStreamDelta ? { onStreamDelta: input.onStreamDelta } : {}),
    });
  } catch (error: unknown) {
    if (
      !shouldRetryFunctionResultTurnWithTools({
        error,
        requestPlan: input.requestPlan,
        pendingInput: input.pendingInput,
      })
    ) {
      throw error;
    }

    const retryRequestPlan = composeGeminiInteractionRequest({
      settings: input.settings,
      input: input.pendingInput,
      functionDeclarations: input.functionDeclarations,
      includeToolsForFunctionResult: true,
      ...(input.requestPlan.request.previous_interaction_id
        ? { previousInteractionId: input.requestPlan.request.previous_interaction_id }
        : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    });

    return callGeminiInteractionWithOptionalStreaming({
      settings: input.settings,
      request: retryRequestPlan.request,
      ...(input.onStreamDelta ? { onStreamDelta: input.onStreamDelta } : {}),
    });
  }
}

async function callGeminiInteractionWithOptionalStreaming(input: {
  settings: GeminiSettings;
  request: unknown;
  onStreamDelta?: (delta: GeminiStreamDelta) => void;
}): Promise<Awaited<ReturnType<typeof callGeminiInteraction>>> {
  if (input.onStreamDelta) {
    return callGeminiInteractionStream({
      settings: input.settings,
      request: input.request,
      onStreamDelta: input.onStreamDelta,
    });
  }

  return callGeminiInteraction({
    settings: input.settings,
    request: input.request,
  });
}

function shouldRetryFunctionResultTurnWithTools(input: {
  error: unknown;
  requestPlan: ReturnType<typeof composeGeminiInteractionRequest>;
  pendingInput: Array<Record<string, unknown>>;
}): boolean {
  if (!input.requestPlan.functionCallingEnabled) {
    return false;
  }

  if (
    Array.isArray(input.requestPlan.request.tools) &&
    input.requestPlan.request.tools.length > 0
  ) {
    return false;
  }

  if (!isFunctionResultOnlyInput(input.pendingInput)) {
    return false;
  }

  return isToolRelatedClientError(input.error);
}

function isFunctionResultOnlyInput(input: Array<Record<string, unknown>>): boolean {
  return input.length > 0 && input.every((part) => part.type === 'function_result');
}

function isToolRelatedClientError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  const statusCode = readErrorStatusCode(error, message);
  if (statusCode === null || statusCode < 400 || statusCode >= 500) {
    return false;
  }

  return (
    message.includes('tool') ||
    message.includes('function_result') ||
    message.includes('function result')
  );
}

function readErrorStatusCode(error: unknown, lowerCasedMessage: string): number | null {
  if (isRecord(error)) {
    const statusField = error.status;
    if (typeof statusField === 'number' && Number.isFinite(statusField)) {
      return Math.trunc(statusField);
    }

    const codeField = error.code;
    if (typeof codeField === 'number' && Number.isFinite(codeField)) {
      return Math.trunc(codeField);
    }
  }

  const prefixedStatusMatch = lowerCasedMessage.match(/^\s*(\d{3})\b/);
  if (prefixedStatusMatch?.[1]) {
    return Number.parseInt(prefixedStatusMatch[1], 10);
  }

  const jsonStatusMatch = lowerCasedMessage.match(/"code"\s*:\s*(\d{3})/);
  if (jsonStatusMatch?.[1]) {
    return Number.parseInt(jsonStatusMatch[1], 10);
  }

  return null;
}

export async function generateSessionTitle(
  apiKey: string,
  firstUserQuery: string,
  attachments?: FileDataAttachmentPayload[],
): Promise<string> {
  const normalizedApiKey = apiKey.trim();
  const normalizedQuery = firstUserQuery.trim();
  const normalizedAttachments = attachments?.filter((a) => a.fileUri?.trim() && a.mimeType?.trim());
  const hasAttachments = normalizedAttachments && normalizedAttachments.length > 0;
  if (!normalizedApiKey || (!normalizedQuery && !hasAttachments)) {
    return '';
  }

  const input: Record<string, unknown>[] = [
    {
      type: 'text',
      text: buildSessionTitlePrompt(normalizedQuery),
    },
    ...(normalizedAttachments ?? []).map((a) => ({
      type: 'file',
      file: { fileUri: a.fileUri.trim(), mimeType: a.mimeType.trim() },
    })),
  ];

  const client = getGeminiClient(normalizedApiKey);
  const response = (await client.interactions.create({
    model: SESSION_TITLE_MODEL,
    input,
    store: false,
  } as unknown as SDKCreateInteractionRequest)) as unknown;

  if (!isRecord(response)) {
    throw new Error('Gemini title generation response payload was not a JSON object.');
  }

  const rawOutputs = Array.isArray(response.outputs) ? response.outputs : [];
  for (const rawOutput of rawOutputs) {
    if (!isRecord(rawOutput)) {
      continue;
    }

    if (rawOutput.type !== 'text' || typeof rawOutput.text !== 'string') {
      continue;
    }

    const title = sanitizeGeneratedSessionTitle(rawOutput.text);
    if (title) {
      return title;
    }
  }

  return '';
}
