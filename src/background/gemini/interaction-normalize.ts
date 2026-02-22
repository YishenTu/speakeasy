import { isRecord } from '../utils';
import type { GeminiInteraction, GeminiInteractionUsage } from './contracts';

export function normalizeGeminiInteractionResponse(response: unknown): GeminiInteraction {
  if (!isRecord(response)) {
    throw new Error('Gemini response payload was not a JSON object.');
  }

  const interactionId = typeof response.id === 'string' ? response.id.trim() : '';
  if (!interactionId) {
    throw new Error('Gemini interaction response did not include an id.');
  }
  const usage = normalizeInteractionUsage(response.usage);

  const rawOutputs = Array.isArray(response.outputs) ? response.outputs : undefined;
  const normalized: GeminiInteraction = {
    id: interactionId,
  };
  if (usage) {
    normalized.usage = usage;
  }
  if (rawOutputs) {
    normalized.outputs = rawOutputs.filter(isRecord).map((output) => ({ ...output }));
  }

  return normalized;
}

export function normalizeInteractionUsage(value: unknown): GeminiInteractionUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const totalInputTokens = readNonNegativeIntegerField(
    value,
    'total_input_tokens',
    'totalInputTokens',
  );
  const totalOutputTokens = readNonNegativeIntegerField(
    value,
    'total_output_tokens',
    'totalOutputTokens',
  );
  const totalThoughtTokens = readNonNegativeIntegerField(
    value,
    'total_thought_tokens',
    'totalThoughtTokens',
  );
  const totalToolUseTokens = readNonNegativeIntegerField(
    value,
    'total_tool_use_tokens',
    'totalToolUseTokens',
  );
  const totalCachedTokens = readNonNegativeIntegerField(
    value,
    'total_cached_tokens',
    'totalCachedTokens',
  );
  const totalTokens = readNonNegativeIntegerField(value, 'total_tokens', 'totalTokens');

  if (
    totalInputTokens === undefined &&
    totalOutputTokens === undefined &&
    totalThoughtTokens === undefined &&
    totalToolUseTokens === undefined &&
    totalCachedTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  const usage: GeminiInteractionUsage = {};
  if (totalInputTokens !== undefined) {
    usage.totalInputTokens = totalInputTokens;
  }
  if (totalOutputTokens !== undefined) {
    usage.totalOutputTokens = totalOutputTokens;
  }
  if (totalThoughtTokens !== undefined) {
    usage.totalThoughtTokens = totalThoughtTokens;
  }
  if (totalToolUseTokens !== undefined) {
    usage.totalToolUseTokens = totalToolUseTokens;
  }
  if (totalCachedTokens !== undefined) {
    usage.totalCachedTokens = totalCachedTokens;
  }
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }

  return usage;
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
