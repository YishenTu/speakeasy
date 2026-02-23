import { afterEach, describe, expect, it } from 'bun:test';
import { requestOpenOptionsPage } from '../../src/shared/runtime-client';

describe('shared runtime client', () => {
  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('returns null when options page opens successfully', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async () => ({
          ok: true,
          payload: { opened: true as const },
        }),
      },
    };

    await expect(requestOpenOptionsPage()).resolves.toBeNull();
  });

  it('returns runtime error when options request fails', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async () => ({
          ok: false,
          error: 'settings unavailable',
        }),
      },
    };

    await expect(requestOpenOptionsPage()).resolves.toBe('settings unavailable');
  });

  it('returns fallback error when runtime response is missing', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async () => undefined,
      },
    };

    await expect(requestOpenOptionsPage()).resolves.toBe('Unable to open settings.');
  });
});
