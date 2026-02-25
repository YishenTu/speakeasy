import type { AssistantResponseStats, GroundingSource } from '../../../../shared/messages';
import type { GeminiContent } from '../../session/types';
import type { GeminiInteractionUsage, UsageTotals } from './contracts';

export function createEmptyUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    toolUseTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    hasInputTokens: false,
    hasOutputTokens: false,
    hasThoughtTokens: false,
    hasToolUseTokens: false,
    hasCachedTokens: false,
    hasTotalTokens: false,
  };
}

export function accumulateUsageTotals(
  usageTotals: UsageTotals,
  usage: GeminiInteractionUsage | undefined,
): void {
  if (!usage) {
    return;
  }

  if (typeof usage.totalInputTokens === 'number') {
    usageTotals.inputTokens += usage.totalInputTokens;
    usageTotals.hasInputTokens = true;
  }
  if (typeof usage.totalOutputTokens === 'number') {
    usageTotals.outputTokens += usage.totalOutputTokens;
    usageTotals.hasOutputTokens = true;
  }
  if (typeof usage.totalThoughtTokens === 'number') {
    usageTotals.thoughtTokens += usage.totalThoughtTokens;
    usageTotals.hasThoughtTokens = true;
  }
  if (typeof usage.totalToolUseTokens === 'number') {
    usageTotals.toolUseTokens += usage.totalToolUseTokens;
    usageTotals.hasToolUseTokens = true;
  }
  if (typeof usage.totalCachedTokens === 'number') {
    usageTotals.cachedTokens += usage.totalCachedTokens;
    usageTotals.hasCachedTokens = true;
  }
  if (typeof usage.totalTokens === 'number') {
    usageTotals.totalTokens += usage.totalTokens;
    usageTotals.hasTotalTokens = true;
  }
}

export function buildAssistantResponseStats(input: {
  usageTotals: UsageTotals;
  requestStartedAtMs: number;
  firstStreamTokenAtMs: number | null;
  firstOutputTokenAtMs: number | null;
  completedAtMs: number;
}): AssistantResponseStats {
  const requestDurationMs = toRoundedDurationMs(input.completedAtMs - input.requestStartedAtMs);
  const timeToFirstTokenMs =
    input.firstStreamTokenAtMs === null
      ? requestDurationMs
      : toRoundedDurationMs(input.firstStreamTokenAtMs - input.requestStartedAtMs);
  const outputWindowStartedAtMs = input.firstOutputTokenAtMs ?? input.requestStartedAtMs;
  const outputWindowDurationMs = Math.max(1, input.completedAtMs - outputWindowStartedAtMs);
  const turnWindowDurationMs = Math.max(1, input.completedAtMs - input.requestStartedAtMs);
  const turnTokens = getTurnTokenCount(input.usageTotals);
  const turnTokensPerSecond =
    turnTokens === undefined ? undefined : (turnTokens * 1000) / turnWindowDurationMs;
  const outputTokensPerSecond =
    input.usageTotals.hasOutputTokens && input.usageTotals.outputTokens >= 0
      ? (input.usageTotals.outputTokens * 1000) / outputWindowDurationMs
      : undefined;

  const responseStats: AssistantResponseStats = {
    requestDurationMs,
    timeToFirstTokenMs,
    hasStreamingToken: input.firstStreamTokenAtMs !== null,
  };
  if (input.usageTotals.hasOutputTokens) {
    responseStats.outputTokens = input.usageTotals.outputTokens;
  }
  if (input.usageTotals.hasInputTokens) {
    responseStats.inputTokens = input.usageTotals.inputTokens;
  }
  if (input.usageTotals.hasThoughtTokens) {
    responseStats.thoughtTokens = input.usageTotals.thoughtTokens;
  }
  if (input.usageTotals.hasToolUseTokens) {
    responseStats.toolUseTokens = input.usageTotals.toolUseTokens;
  }
  if (input.usageTotals.hasCachedTokens) {
    responseStats.cachedTokens = input.usageTotals.cachedTokens;
  }
  if (input.usageTotals.hasTotalTokens) {
    responseStats.totalTokens = input.usageTotals.totalTokens;
  }
  if (turnTokensPerSecond !== undefined) {
    responseStats.turnTokensPerSecond = turnTokensPerSecond;
  }
  if (outputTokensPerSecond !== undefined) {
    responseStats.outputTokensPerSecond = outputTokensPerSecond;
  }

  return responseStats;
}

export function withAssistantResponseStats(
  content: GeminiContent,
  responseStats: AssistantResponseStats,
): GeminiContent {
  return {
    ...content,
    metadata: {
      ...(content.metadata ?? {}),
      responseStats,
    },
  };
}

function getTurnTokenCount(usageTotals: UsageTotals): number | undefined {
  const hasTurnTokenClasses =
    usageTotals.hasOutputTokens || usageTotals.hasThoughtTokens || usageTotals.hasToolUseTokens;
  if (!hasTurnTokenClasses) {
    return undefined;
  }

  return usageTotals.outputTokens + usageTotals.thoughtTokens + usageTotals.toolUseTokens;
}

export function withAssistantInteractionMetadata(
  content: GeminiContent,
  interactionId: string,
  model: string,
): GeminiContent {
  const normalizedInteractionId = interactionId.trim();
  const normalizedModel = model.trim();
  const metadata = {
    ...(content.metadata ?? {}),
  };
  if (normalizedInteractionId) {
    metadata.interactionId = normalizedInteractionId;
  }
  if (normalizedModel) {
    metadata.sourceModel = normalizedModel;
  }
  if (!metadata.createdAt) {
    metadata.createdAt = new Date().toISOString();
  }

  return {
    ...content,
    metadata,
  };
}

export function withGroundingSources(
  content: GeminiContent,
  sources: GroundingSource[],
): GeminiContent {
  if (sources.length === 0) {
    return content;
  }

  return {
    ...content,
    metadata: {
      ...(content.metadata ?? {}),
      groundingSources: sources,
    },
  };
}

function toRoundedDurationMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

export function getMonotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}
