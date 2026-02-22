import type { FileDataAttachmentPayload } from '../shared/runtime';
import type { GeminiSettings } from '../shared/settings';
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
} from './gemini/stats';
import {
  SESSION_TITLE_MODEL,
  buildSessionTitlePrompt,
  sanitizeGeneratedSessionTitle,
} from './gemini/title';
import type { ChatSession, GeminiContent } from './types';
import { isRecord } from './utils';

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
    const interaction = streamDeltaHandler
      ? await callGeminiInteractionStream({
          settings,
          request: requestPlan.request,
          onStreamDelta: streamDeltaHandler,
        })
      : await callGeminiInteraction({
          settings,
          request: requestPlan.request,
        });
    accumulateUsageTotals(usageTotals, interaction.usage);

    session.lastInteractionId = interaction.id;

    const candidateContent = withAssistantInteractionMetadata(
      extractAssistantContent(interaction),
      interaction.id,
      settings.model,
    );
    session.contents.push(candidateContent);
    latestAssistantContent = candidateContent;

    const functionCalls = extractFunctionCalls(candidateContent.parts);
    if (functionCalls.length === 0) {
      const completedAtMs = getMonotonicNowMs();
      const finalContent = withAssistantResponseStats(
        candidateContent,
        buildAssistantResponseStats({
          usageTotals,
          requestStartedAtMs,
          firstStreamTokenAtMs,
          completedAtMs,
        }),
      );
      session.contents[session.contents.length - 1] = finalContent;
      return finalContent;
    }

    if (!functionCallingEnabled) {
      throw new Error('Gemini requested function calls, but function-calling tools are disabled.');
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
    const completedAtMs = getMonotonicNowMs();
    const finalContent = withAssistantResponseStats(
      latestAssistantContent,
      buildAssistantResponseStats({
        usageTotals,
        requestStartedAtMs,
        firstStreamTokenAtMs,
        completedAtMs,
      }),
    );
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
