import { GoogleGenAI } from '@google/genai';
import { getOrCreateBoundedCacheValue } from '../shared/bounded-cache';
import type { ChatAttachment } from '../shared/messages';
import type { GeminiSettings } from '../shared/settings';
import { composeGeminiInteractionRequest } from './gemini-request';
import type { ChatSession, GeminiContent, GeminiFunctionCall, GeminiPart } from './types';
import { isRecord, toErrorMessage } from './utils';

const MAX_GEMINI_CLIENT_CACHE_SIZE = 4;
const SESSION_TITLE_MODEL = 'gemini-flash-lite-latest';
const MAX_SESSION_TITLE_LENGTH = 60;
const INVALID_PREVIOUS_INTERACTION_ID_ERROR_MESSAGE =
  'Gemini rejected previous_interaction_id for this conversation.';

type SDKCreateInteractionRequest = Parameters<GoogleGenAI['interactions']['create']>[0];

interface LocalToolDefinition {
  declaration: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface GeminiInteraction {
  id: string;
  outputs?: Array<Record<string, unknown>>;
}

export interface GeminiStreamDelta {
  textDelta?: string;
  thinkingDelta?: string;
}

interface ExecutedFunctionCall {
  call: GeminiFunctionCall;
  response: Record<string, unknown>;
  isError?: boolean;
}

export class InvalidPreviousInteractionIdError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'InvalidPreviousInteractionIdError';
  }
}

export function isInvalidPreviousInteractionIdError(
  error: unknown,
): error is InvalidPreviousInteractionIdError {
  return error instanceof InvalidPreviousInteractionIdError;
}

const geminiClients = new Map<string, GoogleGenAI>();

const LOCAL_FUNCTION_TOOLS: Record<string, LocalToolDefinition> = {
  get_current_time: {
    declaration: {
      name: 'get_current_time',
      description: 'Get the current time, optionally in a specific IANA time zone.',
      parameters: {
        type: 'object',
        properties: {
          timeZone: {
            type: 'string',
            description:
              'Optional IANA time zone identifier, such as America/New_York or Asia/Tokyo.',
          },
        },
      },
    },
    execute: async (args) => {
      const timeZone = typeof args.timeZone === 'string' ? args.timeZone.trim() : '';
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
        ...(timeZone ? { timeZone } : {}),
      });

      return {
        iso: now.toISOString(),
        formatted: formatter.format(now),
        timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  },
  get_extension_info: {
    declaration: {
      name: 'get_extension_info',
      description: 'Get extension metadata such as version and manifest name.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async () => {
      const manifest = chrome.runtime.getManifest();
      return {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
      };
    },
  },
  generate_uuid: {
    declaration: {
      name: 'generate_uuid',
      description: 'Generate a random UUID.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async () => ({
      uuid: crypto.randomUUID(),
    }),
  },
};

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

  const functionDeclarations = Object.values(LOCAL_FUNCTION_TOOLS).map((tool) => tool.declaration);
  const thinkingOpts = thinkingLevel ? { thinkingLevel } : {};
  let pendingInput = buildInteractionInputFromContent(latestContent);
  let requestPlan = composeGeminiInteractionRequest({
    settings,
    input: pendingInput,
    functionDeclarations,
    ...(session.lastInteractionId ? { previousInteractionId: session.lastInteractionId } : {}),
    ...thinkingOpts,
  });
  const { functionCallingEnabled } = requestPlan;
  let latestAssistantContent: GeminiContent | null = null;

  for (let roundTrip = 0; roundTrip < settings.maxToolRoundTrips; roundTrip += 1) {
    const interaction = onStreamDelta
      ? await callGeminiInteractionStream({
          settings,
          request: requestPlan.request,
          onStreamDelta,
        })
      : await callGeminiInteraction({
          settings,
          request: requestPlan.request,
        });

    session.lastInteractionId = interaction.id;

    const candidateContent = extractAssistantContent(interaction);
    session.contents.push(candidateContent);
    latestAssistantContent = candidateContent;

    const functionCalls = extractFunctionCalls(candidateContent.parts);
    if (functionCalls.length === 0) {
      return candidateContent;
    }

    if (!functionCallingEnabled) {
      throw new Error('Gemini requested function calls, but function-calling tools are disabled.');
    }

    const executedCalls = await executeFunctionCalls(functionCalls);
    session.contents.push({
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
    return latestAssistantContent;
  }

  throw new Error('Gemini did not produce a final response before the tool round-trip limit.');
}

export async function generateSessionTitle(
  apiKey: string,
  firstUserQuery: string,
): Promise<string> {
  const normalizedApiKey = apiKey.trim();
  const normalizedQuery = firstUserQuery.trim();
  if (!normalizedApiKey || !normalizedQuery) {
    return '';
  }

  const client = getGeminiClient(normalizedApiKey);
  const response = (await client.interactions.create({
    model: SESSION_TITLE_MODEL,
    input: [
      {
        type: 'text',
        text: buildSessionTitlePrompt(normalizedQuery),
      },
    ],
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

export function normalizeContent(value: unknown): GeminiContent {
  if (!isRecord(value)) {
    throw new Error('Gemini content must be a JSON object.');
  }

  const role = value.role === 'user' || value.role === 'model' ? value.role : 'model';
  const rawParts = Array.isArray(value.parts) ? value.parts : [];

  const parts: GeminiPart[] = [];
  for (const rawPart of rawParts) {
    if (isRecord(rawPart)) {
      parts.push({ ...rawPart });
    }
  }

  if (parts.length === 0) {
    throw new Error('Gemini returned content with no parts.');
  }

  return {
    role,
    parts,
  };
}

export function renderContentForChat(content: GeminiContent): string {
  const blocks: string[] = [];

  for (const part of content.parts) {
    const text = typeof part.text === 'string' ? part.text.trim() : '';
    if (text) {
      blocks.push(text);
      continue;
    }

    const codeExecutionResult = readPartRecord(
      part,
      'codeExecutionResult',
      'code_execution_result',
    );
    if (codeExecutionResult) {
      const output =
        typeof codeExecutionResult.output === 'string' ? codeExecutionResult.output.trim() : '';
      if (output) {
        blocks.push(`Code output:\n${output}`);
      }
      continue;
    }

    const executableCode = readPartRecord(part, 'executableCode', 'executable_code');
    if (executableCode) {
      const code = typeof executableCode.code === 'string' ? executableCode.code.trim() : '';
      if (code) {
        const language =
          typeof executableCode.language === 'string' && executableCode.language.trim()
            ? executableCode.language.trim().toLowerCase()
            : 'text';
        blocks.push(`\`\`\`${language}\n${code}\n\`\`\``);
      }
    }
  }

  return blocks.join('\n\n');
}

export function renderThinkingSummaryForChat(content: GeminiContent): string {
  return content.parts
    .map((part) => (typeof part.thoughtSummary === 'string' ? part.thoughtSummary.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

export function extractAttachments(content: GeminiContent): ChatAttachment[] {
  const attachments: ChatAttachment[] = [];

  for (const part of content.parts) {
    const fileData = readPartRecord(part, 'fileData', 'file_data');
    if (fileData) {
      const fileUri =
        typeof fileData.fileUri === 'string'
          ? fileData.fileUri.trim()
          : typeof fileData.file_uri === 'string'
            ? fileData.file_uri.trim()
            : '';
      const mimeType =
        typeof fileData.mimeType === 'string'
          ? fileData.mimeType.trim()
          : typeof fileData.mime_type === 'string'
            ? fileData.mime_type.trim()
            : '';
      if (!fileUri || !mimeType) {
        continue;
      }

      const displayName =
        typeof fileData.displayName === 'string'
          ? fileData.displayName.trim()
          : typeof fileData.display_name === 'string'
            ? fileData.display_name.trim()
            : '';

      attachments.push({
        name: displayName || inferFileNameFromUri(fileUri),
        mimeType,
        fileUri,
      });
      continue;
    }

    const inlineData = readPartRecord(part, 'inlineData', 'inline_data');
    if (!inlineData) {
      continue;
    }

    const mimeType =
      typeof inlineData.mimeType === 'string'
        ? inlineData.mimeType.trim()
        : typeof inlineData.mime_type === 'string'
          ? inlineData.mime_type.trim()
          : '';
    if (!mimeType) {
      continue;
    }

    const displayName =
      typeof inlineData.displayName === 'string'
        ? inlineData.displayName.trim()
        : typeof inlineData.display_name === 'string'
          ? inlineData.display_name.trim()
          : '';
    attachments.push({
      name: displayName || inferAttachmentNameFromMimeType(mimeType),
      mimeType,
    });
  }

  return attachments;
}

function buildSessionTitlePrompt(firstUserQuery: string): string {
  return [
    'Generate a concise session title for a chat history dropdown.',
    'Return only the title text with no quotes or markdown.',
    'Keep the title between 3 and 8 words and under 60 characters.',
    `User query: ${firstUserQuery}`,
  ].join('\n');
}

function sanitizeGeneratedSessionTitle(rawTitle: string): string {
  const firstLine =
    rawTitle
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  const normalized = stripWrappingDelimiters(firstLine.replace(/\s+/g, ' ').trim());

  if (!normalized) {
    return '';
  }

  if (normalized.length <= MAX_SESSION_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…`;
}

function stripWrappingDelimiters(value: string): string {
  let result = value;
  while (
    result.length >= 2 &&
    (result[0] === '"' || result[0] === "'" || result[0] === '`') &&
    result.endsWith(result[0])
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

async function callGeminiInteraction(input: {
  settings: GeminiSettings;
  request: unknown;
}): Promise<GeminiInteraction> {
  const response = await createInteraction(input.settings.apiKey, input.request);
  return normalizeGeminiInteractionResponse(response);
}

async function callGeminiInteractionStream(input: {
  settings: GeminiSettings;
  request: unknown;
  onStreamDelta: (delta: GeminiStreamDelta) => void;
}): Promise<GeminiInteraction> {
  const streamRequest = {
    ...(input.request as Record<string, unknown>),
    stream: true,
  };

  const stream = await createInteraction(input.settings.apiKey, streamRequest);

  if (!isAsyncIterable(stream)) {
    throw new Error('Gemini streaming response payload was not an async iterable.');
  }

  let completedInteraction: GeminiInteraction | null = null;
  const streamedTextChunks: string[] = [];
  const streamedThoughtChunks: string[] = [];
  for await (const rawEvent of stream) {
    if (!isRecord(rawEvent)) {
      continue;
    }

    switch (readStringField(rawEvent, 'event_type')) {
      case 'content.delta': {
        const delta = extractStreamDelta(rawEvent);
        if (delta) {
          input.onStreamDelta(delta);
          if (delta.textDelta) streamedTextChunks.push(delta.textDelta);
          if (delta.thinkingDelta) streamedThoughtChunks.push(delta.thinkingDelta);
        }
        break;
      }
      case 'interaction.complete': {
        if (!isRecord(rawEvent.interaction)) {
          throw new Error(
            'Gemini interaction.complete event did not include an interaction payload.',
          );
        }
        completedInteraction = normalizeGeminiInteractionResponse(rawEvent.interaction);
        break;
      }
      case 'error': {
        const rawError = rawEvent.error;
        const errorRecord = isRecord(rawError) ? rawError : null;
        const message =
          typeof rawError === 'string'
            ? rawError.trim()
            : errorRecord
              ? readStringField(errorRecord, 'message')
              : '';
        const streamError = new Error(message || 'Gemini streaming interaction failed.');
        const classifiedError = asInvalidPreviousInteractionIdError(
          errorRecord ?? (typeof rawError === 'string' ? rawError : rawEvent),
          streamError,
        );
        if (classifiedError) {
          throw classifiedError;
        }
        throw streamError;
      }
    }
  }

  if (!completedInteraction) {
    throw new Error('Gemini stream ended before interaction.complete was received.');
  }

  return applyStreamOutputFallback(completedInteraction, {
    text: streamedTextChunks.join(''),
    thoughtSummary: streamedThoughtChunks.join(''),
  });
}

function normalizeGeminiInteractionResponse(response: unknown): GeminiInteraction {
  if (!isRecord(response)) {
    throw new Error('Gemini response payload was not a JSON object.');
  }

  const interactionId = typeof response.id === 'string' ? response.id.trim() : '';
  if (!interactionId) {
    throw new Error('Gemini interaction response did not include an id.');
  }

  const rawOutputs = Array.isArray(response.outputs) ? response.outputs : undefined;
  if (!rawOutputs) {
    return { id: interactionId };
  }

  const outputs = rawOutputs.filter(isRecord).map((output) => ({ ...output }));
  return {
    id: interactionId,
    outputs,
  };
}

function applyStreamOutputFallback(
  interaction: GeminiInteraction,
  fallback: { text: string; thoughtSummary: string },
): GeminiInteraction {
  if (Array.isArray(interaction.outputs) && interaction.outputs.length > 0) {
    return interaction;
  }

  const fallbackOutputs: Array<Record<string, unknown>> = [];
  if (fallback.thoughtSummary.trim()) {
    fallbackOutputs.push({
      type: 'thought',
      summary: [{ type: 'text', text: fallback.thoughtSummary }],
    });
  }
  if (fallback.text.trim()) {
    fallbackOutputs.push({
      type: 'text',
      text: fallback.text,
    });
  }

  if (fallbackOutputs.length === 0) {
    return interaction;
  }

  return {
    ...interaction,
    outputs: fallbackOutputs,
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return !!value && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
}

function extractStreamDelta(event: Record<string, unknown>): GeminiStreamDelta | null {
  const delta = isRecord(event.delta) ? event.delta : null;
  if (!delta) {
    return null;
  }

  const deltaType = readStringField(delta, 'type');
  if (deltaType === 'text') {
    return delta.text ? { textDelta: delta.text as string } : null;
  }

  if (deltaType === 'thought_summary') {
    const content = isRecord(delta.content) ? delta.content : null;
    return content?.text ? { thinkingDelta: content.text as string } : null;
  }

  return null;
}

async function createInteraction(apiKey: string, request: unknown): Promise<unknown> {
  const client = getGeminiClient(apiKey);
  try {
    return (await client.interactions.create(
      request as unknown as SDKCreateInteractionRequest,
    )) as unknown;
  } catch (error: unknown) {
    const classifiedError = asInvalidPreviousInteractionIdError(error);
    if (classifiedError) {
      throw classifiedError;
    }
    throw error;
  }
}

function asInvalidPreviousInteractionIdError(
  error: unknown,
  cause: unknown = error,
): InvalidPreviousInteractionIdError | null {
  if (!isPreviousInteractionIdError(error)) {
    return null;
  }

  return new InvalidPreviousInteractionIdError(
    INVALID_PREVIOUS_INTERACTION_ID_ERROR_MESSAGE,
    cause,
  );
}

function isPreviousInteractionIdError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  if (
    message.includes('previous_interaction_id') ||
    (message.includes('previous interaction') && message.includes('id'))
  ) {
    return true;
  }

  if (!isRecord(error)) {
    return false;
  }

  const errorMessage =
    typeof error.message === 'string'
      ? error.message.toLowerCase()
      : typeof error.error === 'string'
        ? error.error.toLowerCase()
        : '';
  return (
    errorMessage.includes('previous_interaction_id') ||
    (errorMessage.includes('previous interaction') && errorMessage.includes('id'))
  );
}

function extractAssistantContent(interaction: GeminiInteraction): GeminiContent {
  const parts: GeminiPart[] = [];
  for (const rawOutput of interaction.outputs ?? []) {
    const part = mapInteractionOutputToPart(rawOutput);
    if (part) {
      parts.push(part);
    }
  }

  if (parts.length === 0) {
    throw new Error('Gemini interaction did not return any outputs.');
  }

  return {
    role: 'model',
    parts,
  };
}

function mapInteractionOutputToPart(output: Record<string, unknown>): GeminiPart | null {
  const type = typeof output.type === 'string' ? output.type.trim() : '';
  if (!type) {
    return null;
  }

  switch (type) {
    case 'text': {
      const text = typeof output.text === 'string' ? output.text : '';
      return { text };
    }
    case 'thought': {
      const summary = extractThoughtSummary(output);
      if (!summary) {
        return { interactionOutput: { type: 'thought' } };
      }
      return { thoughtSummary: summary };
    }
    case 'function_call': {
      const name = typeof output.name === 'string' ? output.name.trim() : '';
      if (!name) {
        return { interactionOutput: { type: 'function_call' } };
      }

      const id = typeof output.id === 'string' ? output.id.trim() : '';
      return {
        functionCall: {
          ...(id ? { id } : {}),
          name,
          args: normalizeFunctionCallArgs(output.arguments),
        },
      };
    }
    case 'code_execution_result': {
      const result = typeof output.result === 'string' ? output.result : '';
      return {
        codeExecutionResult: {
          output: result,
        },
      };
    }
    case 'code_execution_call': {
      const args = isRecord(output.arguments) ? output.arguments : null;
      const code = args && typeof args.code === 'string' ? args.code : '';
      if (!code) {
        return { interactionOutput: { type: 'code_execution_call' } };
      }

      const language = args && typeof args.language === 'string' ? args.language : 'text';
      return {
        executableCode: {
          language,
          code,
        },
      };
    }
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
      return mapInteractionMediaOutputToPart(output);
    default:
      return {
        interactionOutput: summarizeInteractionOutput(output),
      };
  }
}

function extractThoughtSummary(output: Record<string, unknown>): string {
  const rawSummary = Array.isArray(output.summary) ? output.summary : [];
  const blocks: string[] = [];

  for (const block of rawSummary) {
    if (!isRecord(block)) {
      continue;
    }

    const type = readStringField(block, 'type');
    if (type !== 'text') {
      continue;
    }

    const text = readStringField(block, 'text');
    if (text) {
      blocks.push(text);
    }
  }

  return blocks.join('\n\n');
}

function mapInteractionMediaOutputToPart(output: Record<string, unknown>): GeminiPart | null {
  const mimeType = readStringField(output, 'mime_type');
  const uri = readStringField(output, 'uri');

  if (mimeType && uri) {
    return {
      fileData: {
        fileUri: uri,
        mimeType,
      },
    };
  }

  if (!mimeType) {
    return {
      interactionOutput: summarizeInteractionOutput(output),
    };
  }

  const data = readStringField(output, 'data');
  return {
    inlineData: {
      mimeType,
      ...(data ? { data } : {}),
    },
  };
}

function summarizeInteractionOutput(output: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const type = typeof output.type === 'string' ? output.type.trim() : '';
  summary.type = type || 'unknown';

  const name = typeof output.name === 'string' ? output.name.trim() : '';
  if (name) {
    summary.name = name;
  }

  const id = typeof output.id === 'string' ? output.id.trim() : '';
  if (id) {
    summary.id = id;
  }

  const result = output.result;
  if (Array.isArray(result)) {
    summary.resultCount = result.length;
  }

  return summary;
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function extractFunctionCalls(parts: GeminiPart[]): GeminiFunctionCall[] {
  return parts.map(parseFunctionCall).filter((call): call is GeminiFunctionCall => call !== null);
}

function parseFunctionCall(part: GeminiPart): GeminiFunctionCall | null {
  const rawFunctionCall = readPartRecord(part, 'functionCall', 'function_call');
  if (!rawFunctionCall) {
    return null;
  }

  const id = typeof rawFunctionCall.id === 'string' ? rawFunctionCall.id.trim() : '';
  const name = typeof rawFunctionCall.name === 'string' ? rawFunctionCall.name.trim() : '';
  if (!id || !name) {
    return null;
  }

  const args = normalizeFunctionCallArgs(rawFunctionCall.args);
  return { id, name, args };
}

function readPartRecord(
  part: GeminiPart,
  camelKey: string,
  snakeKey: string,
): Record<string, unknown> | null {
  if (isRecord(part[camelKey])) {
    return part[camelKey] as Record<string, unknown>;
  }
  if (isRecord(part[snakeKey])) {
    return part[snakeKey] as Record<string, unknown>;
  }
  return null;
}

function inferFileNameFromUri(fileUri: string): string {
  const match = fileUri.match(/\/([^/?#]+)(?:[?#]|$)/);
  if (!match?.[1]) {
    return 'attachment';
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function inferAttachmentNameFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('image/')) {
    return 'image';
  }
  if (normalized === 'application/pdf') {
    return 'document.pdf';
  }
  if (normalized.startsWith('text/')) {
    return 'document.txt';
  }

  return 'attachment';
}

function normalizeFunctionCallArgs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return { ...value };
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

async function executeFunctionCalls(
  functionCalls: GeminiFunctionCall[],
): Promise<ExecutedFunctionCall[]> {
  const results: ExecutedFunctionCall[] = [];

  for (const call of functionCalls) {
    const tool = LOCAL_FUNCTION_TOOLS[call.name];
    if (!tool) {
      results.push({
        call,
        response: { error: `Unknown function: ${call.name}` },
        isError: true,
      });
      continue;
    }

    try {
      const toolResult = await tool.execute(call.args);
      results.push({
        call,
        response: toolResult,
      });
    } catch (error: unknown) {
      results.push({
        call,
        response: { error: toErrorMessage(error) },
        isError: true,
      });
    }
  }

  return results;
}

function buildFunctionResponsePart(
  call: GeminiFunctionCall,
  response: Record<string, unknown>,
): GeminiPart {
  const functionResponse: Record<string, unknown> = {
    name: call.name,
    response,
  };
  if (call.id) {
    functionResponse.id = call.id;
  }
  return { functionResponse };
}

function buildFunctionResultInput(call: ExecutedFunctionCall): Record<string, unknown> {
  const callId = typeof call.call.id === 'string' ? call.call.id.trim() : '';
  if (!callId) {
    throw new Error(`Gemini function call "${call.call.name}" is missing call id.`);
  }

  return {
    type: 'function_result',
    call_id: callId,
    name: call.call.name,
    result: call.response,
    ...(call.isError ? { is_error: true } : {}),
  };
}

function buildInteractionInputFromContent(content: GeminiContent): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const part of content.parts) {
    const text = typeof part.text === 'string' ? part.text : '';
    if (text.trim()) {
      input.push({
        type: 'text',
        text,
      });
    }

    const fileData = readPartRecord(part, 'fileData', 'file_data');
    if (fileData) {
      const mimeType =
        readStringField(fileData, 'mimeType') || readStringField(fileData, 'mime_type');
      const fileUri = readStringField(fileData, 'fileUri') || readStringField(fileData, 'file_uri');
      if (mimeType && fileUri) {
        input.push({
          type: inferMediaTypeFromMimeType(mimeType),
          mime_type: mimeType,
          uri: fileUri,
        });
      }
    }

    const inlineData = readPartRecord(part, 'inlineData', 'inline_data');
    if (inlineData) {
      const mimeType =
        readStringField(inlineData, 'mimeType') || readStringField(inlineData, 'mime_type');
      if (!mimeType) {
        continue;
      }

      const data = readStringField(inlineData, 'data');
      input.push({
        type: inferMediaTypeFromMimeType(mimeType),
        mime_type: mimeType,
        ...(data ? { data } : {}),
      });
    }
  }

  if (input.length === 0) {
    throw new Error('Cannot send a user message with no text or attachment content.');
  }

  return input;
}

function inferMediaTypeFromMimeType(mimeType: string): 'image' | 'audio' | 'video' | 'document' {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith('image/')) {
    return 'image';
  }
  if (normalizedMimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (normalizedMimeType.startsWith('video/')) {
    return 'video';
  }

  return 'document';
}

function getGeminiClient(apiKey: string): GoogleGenAI {
  return getOrCreateBoundedCacheValue({
    cache: geminiClients,
    key: apiKey,
    maxSize: MAX_GEMINI_CLIENT_CACHE_SIZE,
    create: () =>
      new GoogleGenAI({
        apiKey,
        apiVersion: 'v1beta',
      }),
  });
}
