import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH,
  estimateBase64DecodedByteLength,
  parseImageDataUrl,
} from '../../shared/attachment-preview';
import type { AssistantResponseStats } from '../../shared/messages';
import type { GeminiContent, GeminiPart } from '../types';
import { isRecord } from '../utils';
import {
  readPartRecord,
  readStringField,
  summarizeInteractionOutput,
  summarizeUnknownPart,
} from './common';

export function normalizeContent(value: unknown): GeminiContent {
  if (!isRecord(value)) {
    throw new Error('Gemini content must be a JSON object.');
  }

  const rawId = typeof value.id === 'string' ? value.id.trim() : '';
  const role = value.role === 'user' || value.role === 'model' ? value.role : 'model';
  const rawParts = Array.isArray(value.parts) ? value.parts : [];

  const parts: GeminiPart[] = [];
  for (const rawPart of rawParts) {
    if (!isRecord(rawPart)) {
      continue;
    }

    const normalizedPart = normalizeGeminiPart(rawPart);
    if (normalizedPart) {
      parts.push(normalizedPart);
    }
  }

  if (parts.length === 0) {
    throw new Error('Gemini returned content with no parts.');
  }

  const metadata = normalizeContentMetadata(value.metadata);

  const content: GeminiContent = {
    role,
    parts,
  };
  if (rawId) {
    content.id = rawId;
  }
  if (metadata) {
    content.metadata = metadata;
  }

  return content;
}

function normalizeGeminiPart(rawPart: Record<string, unknown>): GeminiPart | null {
  if (typeof rawPart.text === 'string') {
    return { text: rawPart.text };
  }

  if (typeof rawPart.thoughtSummary === 'string') {
    return { thoughtSummary: rawPart.thoughtSummary };
  }

  const functionCall = readPartRecord(rawPart, 'functionCall', 'function_call');
  if (functionCall) {
    const name = readStringField(functionCall, 'name');
    if (!name) {
      return { interactionOutput: { type: 'function_call' } };
    }

    const id = readStringField(functionCall, 'id');
    const rawArgs =
      Object.prototype.hasOwnProperty.call(functionCall, 'args') && functionCall.args !== undefined
        ? functionCall.args
        : functionCall.arguments;

    const normalizedFunctionCall: { id?: string; name: string; args?: unknown } = {
      name,
    };
    if (id) {
      normalizedFunctionCall.id = id;
    }
    if (rawArgs !== undefined) {
      normalizedFunctionCall.args = rawArgs;
    }

    return { functionCall: normalizedFunctionCall };
  }

  const functionResponse = readPartRecord(rawPart, 'functionResponse', 'function_response');
  if (functionResponse) {
    const id = readStringField(functionResponse, 'id');
    const name = readStringField(functionResponse, 'name');
    const response = isRecord(functionResponse.response) ? { ...functionResponse.response } : {};
    const normalizedFunctionResponse: {
      id?: string;
      name?: string;
      response: Record<string, unknown>;
    } = {
      response,
    };
    if (id) {
      normalizedFunctionResponse.id = id;
    }
    if (name) {
      normalizedFunctionResponse.name = name;
    }

    return { functionResponse: normalizedFunctionResponse };
  }

  const fileData = readPartRecord(rawPart, 'fileData', 'file_data');
  if (fileData) {
    return { fileData: { ...fileData } };
  }

  const inlineData = readPartRecord(rawPart, 'inlineData', 'inline_data');
  if (inlineData) {
    return { inlineData: { ...inlineData } };
  }

  const codeExecutionResult = readPartRecord(
    rawPart,
    'codeExecutionResult',
    'code_execution_result',
  );
  if (codeExecutionResult) {
    const output = typeof codeExecutionResult.output === 'string' ? codeExecutionResult.output : '';
    return { codeExecutionResult: { output } };
  }

  const executableCode = readPartRecord(rawPart, 'executableCode', 'executable_code');
  if (executableCode) {
    const language =
      typeof executableCode.language === 'string' ? executableCode.language : undefined;
    const code = typeof executableCode.code === 'string' ? executableCode.code : undefined;
    const normalizedExecutableCode: { language?: string; code?: string } = {};
    if (language) {
      normalizedExecutableCode.language = language;
    }
    if (code) {
      normalizedExecutableCode.code = code;
    }

    return { executableCode: normalizedExecutableCode };
  }

  const interactionOutput = readPartRecord(rawPart, 'interactionOutput', 'interaction_output');
  if (interactionOutput) {
    return {
      interactionOutput: summarizeInteractionOutput(interactionOutput),
    };
  }

  return {
    interactionOutput: summarizeUnknownPart(rawPart),
  };
}

function normalizeContentMetadata(value: unknown): GeminiContent['metadata'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const responseStats = normalizeAssistantResponseStats(value.responseStats);
  const interactionId = readStringField(value, 'interactionId', 'interaction_id');
  const sourceModel = readStringField(value, 'sourceModel', 'source_model');
  const createdAt = readStringField(value, 'createdAt', 'created_at');
  const attachmentPreviewByFileUri = normalizeAttachmentPreviewByFileUri(
    readPartRecord(value, 'attachmentPreviewByFileUri', 'attachment_preview_by_file_uri'),
  );

  if (
    !responseStats &&
    !interactionId &&
    !sourceModel &&
    !createdAt &&
    !attachmentPreviewByFileUri
  ) {
    return undefined;
  }

  const metadata: NonNullable<GeminiContent['metadata']> = {};
  if (responseStats) {
    metadata.responseStats = responseStats;
  }
  if (interactionId) {
    metadata.interactionId = interactionId;
  }
  if (sourceModel) {
    metadata.sourceModel = sourceModel;
  }
  if (createdAt) {
    metadata.createdAt = createdAt;
  }
  if (attachmentPreviewByFileUri) {
    metadata.attachmentPreviewByFileUri = attachmentPreviewByFileUri;
  }

  return metadata;
}

function normalizeAttachmentPreviewByFileUri(
  value: Record<string, unknown> | null,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [rawFileUri, rawPreviewDataUrl] of Object.entries(value)) {
    const fileUri = rawFileUri.trim();
    if (!fileUri || typeof rawPreviewDataUrl !== 'string') {
      continue;
    }

    const previewDataUrl = rawPreviewDataUrl.trim();
    if (!isImageDataUrl(previewDataUrl)) {
      continue;
    }

    normalized[fileUri] = previewDataUrl;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isImageDataUrl(value: string): boolean {
  if (value.length > ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH) {
    return false;
  }

  const parsedDataUrl = parseImageDataUrl(value);
  if (!parsedDataUrl) {
    return false;
  }

  return estimateBase64DecodedByteLength(parsedDataUrl.base64) <= ATTACHMENT_PREVIEW_MAX_BYTES;
}

function normalizeAssistantResponseStats(value: unknown): AssistantResponseStats | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const requestDurationMs = readNonNegativeIntegerField(
    value,
    'requestDurationMs',
    'request_duration_ms',
  );
  const timeToFirstTokenMs = readNonNegativeIntegerField(
    value,
    'timeToFirstTokenMs',
    'time_to_first_token_ms',
  );
  const hasStreamingToken = readBooleanField(value, 'hasStreamingToken', 'has_streaming_token');

  if (
    requestDurationMs === undefined ||
    timeToFirstTokenMs === undefined ||
    hasStreamingToken === undefined
  ) {
    return undefined;
  }

  const outputTokens = readNonNegativeIntegerField(value, 'outputTokens', 'output_tokens');
  const inputTokens = readNonNegativeIntegerField(value, 'inputTokens', 'input_tokens');
  const thoughtTokens = readNonNegativeIntegerField(value, 'thoughtTokens', 'thought_tokens');
  const toolUseTokens = readNonNegativeIntegerField(value, 'toolUseTokens', 'tool_use_tokens');
  const cachedTokens = readNonNegativeIntegerField(value, 'cachedTokens', 'cached_tokens');
  const totalTokens = readNonNegativeIntegerField(value, 'totalTokens', 'total_tokens');
  const outputTokensPerSecond = readNonNegativeNumberField(
    value,
    'outputTokensPerSecond',
    'output_tokens_per_second',
  );
  const totalTokensPerSecond = readNonNegativeNumberField(
    value,
    'totalTokensPerSecond',
    'total_tokens_per_second',
  );

  const stats: AssistantResponseStats = {
    requestDurationMs,
    timeToFirstTokenMs,
    hasStreamingToken,
  };
  if (outputTokens !== undefined) {
    stats.outputTokens = outputTokens;
  }
  if (inputTokens !== undefined) {
    stats.inputTokens = inputTokens;
  }
  if (thoughtTokens !== undefined) {
    stats.thoughtTokens = thoughtTokens;
  }
  if (toolUseTokens !== undefined) {
    stats.toolUseTokens = toolUseTokens;
  }
  if (cachedTokens !== undefined) {
    stats.cachedTokens = cachedTokens;
  }
  if (totalTokens !== undefined) {
    stats.totalTokens = totalTokens;
  }
  if (outputTokensPerSecond !== undefined) {
    stats.outputTokensPerSecond = outputTokensPerSecond;
  }
  if (totalTokensPerSecond !== undefined) {
    stats.totalTokensPerSecond = totalTokensPerSecond;
  }

  return stats;
}

function readBooleanField(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function readNonNegativeIntegerField(
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.round(value);
    }
  }
  return undefined;
}

function readNonNegativeNumberField(
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  return undefined;
}
