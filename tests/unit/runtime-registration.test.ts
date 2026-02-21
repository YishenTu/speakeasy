import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { registerBackgroundRuntimeHandlers } from '../../src/background/runtime';
import type { RuntimeResponse } from '../../src/shared/runtime';

type RuntimeListener = (
  request: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: RuntimeResponse<unknown>) => void,
) => boolean;

describe('background runtime registration', () => {
  let listener: RuntimeListener | null = null;
  let openOptionsErrorMessage: string | null = null;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    listener = null;
    openOptionsErrorMessage = null;
    originalWarn = console.warn;
    console.warn = () => {};

    const runtime = {
      lastError: undefined as chrome.runtime.LastError | undefined,
      onMessage: {
        addListener: (registered: RuntimeListener) => {
          listener = registered;
        },
      },
      openOptionsPage: (callback: () => void) => {
        runtime.lastError = openOptionsErrorMessage
          ? ({ message: openOptionsErrorMessage } as chrome.runtime.LastError)
          : undefined;
        callback();
      },
    };

    (globalThis as { chrome?: unknown }).chrome = {
      runtime,
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
      },
    };

    registerBackgroundRuntimeHandlers();
  });

  afterEach(() => {
    console.warn = originalWarn;
    (globalThis as { chrome?: unknown }).chrome = undefined;
    listener = null;
  });

  it('ignores unknown messages and does not keep the response channel open', () => {
    if (!listener) {
      throw new Error('runtime listener was not registered');
    }

    let responded = false;
    const keptOpen = listener(
      { type: 'unrelated/request' },
      {} as chrome.runtime.MessageSender,
      () => {
        responded = true;
      },
    );

    expect(keptOpen).toBe(false);
    expect(responded).toBe(false);
  });

  it('responds with success payload for known runtime messages', async () => {
    if (!listener) {
      throw new Error('runtime listener was not registered');
    }

    const response = await new Promise<RuntimeResponse<unknown>>((resolve) => {
      const keptOpen = listener?.(
        { type: 'app/open-options' },
        {} as chrome.runtime.MessageSender,
        resolve,
      );
      expect(keptOpen).toBe(true);
    });

    expect(response).toEqual({
      ok: true,
      payload: { opened: true },
    });
  });

  it('responds with failure payload when runtime handler throws', async () => {
    if (!listener) {
      throw new Error('runtime listener was not registered');
    }

    openOptionsErrorMessage = 'cannot open options';
    const response = await new Promise<RuntimeResponse<unknown>>((resolve) => {
      const keptOpen = listener?.(
        { type: 'app/open-options' },
        {} as chrome.runtime.MessageSender,
        resolve,
      );
      expect(keptOpen).toBe(true);
    });

    expect(response).toEqual({
      ok: false,
      error: 'cannot open options',
    });
  });
});
