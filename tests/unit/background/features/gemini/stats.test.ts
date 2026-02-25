import { describe, expect, it } from 'bun:test';
import type { UsageTotals } from '../../../../../src/background/features/gemini/gemini/contracts';
import { buildAssistantResponseStats } from '../../../../../src/background/features/gemini/gemini/stats';

function createUsageTotals(overrides: Partial<UsageTotals>): UsageTotals {
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
    ...overrides,
  };
}

describe('buildAssistantResponseStats', () => {
  it('computes turn TPS across full turn and output TPS from first output token onward', () => {
    const stats = buildAssistantResponseStats({
      usageTotals: createUsageTotals({
        outputTokens: 30,
        thoughtTokens: 20,
        toolUseTokens: 10,
        hasOutputTokens: true,
        hasThoughtTokens: true,
        hasToolUseTokens: true,
      }),
      requestStartedAtMs: 1_000,
      firstStreamTokenAtMs: 1_200,
      firstOutputTokenAtMs: 1_700,
      completedAtMs: 2_200,
    });

    expect(stats.requestDurationMs).toBe(1_200);
    expect(stats.timeToFirstTokenMs).toBe(200);
    expect(stats.turnTokensPerSecond).toBe(50);
    expect(stats.outputTokensPerSecond).toBe(60);
    expect(stats.hasStreamingToken).toBe(true);
  });

  it('falls back to request-start output window when no output stream delta is observed', () => {
    const stats = buildAssistantResponseStats({
      usageTotals: createUsageTotals({
        outputTokens: 25,
        thoughtTokens: 15,
        hasOutputTokens: true,
        hasThoughtTokens: true,
      }),
      requestStartedAtMs: 100,
      firstStreamTokenAtMs: null,
      firstOutputTokenAtMs: null,
      completedAtMs: 600,
    });

    expect(stats.requestDurationMs).toBe(500);
    expect(stats.timeToFirstTokenMs).toBe(500);
    expect(stats.turnTokensPerSecond).toBe(80);
    expect(stats.outputTokensPerSecond).toBe(50);
    expect(stats.hasStreamingToken).toBe(false);
  });

  it('keeps output TPS undefined when output token totals are unavailable', () => {
    const stats = buildAssistantResponseStats({
      usageTotals: createUsageTotals({
        thoughtTokens: 18,
        toolUseTokens: 2,
        hasThoughtTokens: true,
        hasToolUseTokens: true,
      }),
      requestStartedAtMs: 0,
      firstStreamTokenAtMs: 50,
      firstOutputTokenAtMs: null,
      completedAtMs: 1_000,
    });

    expect(stats.turnTokensPerSecond).toBe(20);
    expect(stats.outputTokensPerSecond).toBeUndefined();
  });
});
