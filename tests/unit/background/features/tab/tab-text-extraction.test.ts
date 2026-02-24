import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { extractTabTextById } from '../../../../../src/background/features/tab/tab-text-extraction';
import { TAB_EXTRACT_TEXT_MESSAGE_TYPE } from '../../../../../src/shared/tab-text-extraction-message';

interface ChromeWithRuntimeLastError {
  chrome: {
    runtime: {
      lastError?: chrome.runtime.LastError;
    };
  };
}

describe('background tab text extraction', () => {
  beforeEach(() => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {},
      tabs: {},
    };
  });

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('rejects invalid tab ids before calling chrome APIs', async () => {
    await expect(extractTabTextById(0)).rejects.toThrow(/valid tab id/i);
    await expect(extractTabTextById(-5)).rejects.toThrow(/valid tab id/i);
    await expect(extractTabTextById(1.5)).rejects.toThrow(/valid tab id/i);
  });

  it('throws when chrome tabs API is unavailable and no override is provided', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {},
      tabs: {},
    };

    await expect(extractTabTextById(3)).rejects.toThrow(/tabs api is unavailable/i);
  });

  it('sends extraction request and returns normalized payload via override dependency', async () => {
    const payload = await extractTabTextById(12, {
      sendMessage: ((tabId, request, callback) => {
        expect(tabId).toBe(12);
        expect(request).toEqual({ type: TAB_EXTRACT_TEXT_MESSAGE_TYPE });
        callback?.({
          ok: true,
          payload: {
            markdown: '  # Extracted text  ',
            title: '  Example title  ',
            url: '  https://example.test/path  ',
          },
        });
      }) as typeof chrome.tabs.sendMessage,
    });

    expect(payload).toEqual({
      markdown: '# Extracted text',
      title: 'Example title',
      url: 'https://example.test/path',
    });
  });

  it('uses chrome tabs sendMessage when override is not provided', async () => {
    const chromeObject = globalThis as typeof globalThis & {
      chrome: {
        runtime: Record<string, never>;
        tabs: {
          sendMessage: typeof chrome.tabs.sendMessage;
        };
      };
    };
    chromeObject.chrome.tabs.sendMessage = ((tabId, request, callback) => {
      expect(tabId).toBe(27);
      expect(request).toEqual({ type: TAB_EXTRACT_TEXT_MESSAGE_TYPE });
      callback?.({
        ok: true,
        payload: {
          markdown: 'content',
          title: 'title',
          url: 'https://example.test',
        },
      });
    }) as typeof chrome.tabs.sendMessage;

    await expect(extractTabTextById(27)).resolves.toEqual({
      markdown: 'content',
      title: 'title',
      url: 'https://example.test',
    });
  });

  it('wraps chrome runtime lastError responses as extraction failures', async () => {
    const chromeWithRuntime = globalThis as typeof globalThis & ChromeWithRuntimeLastError;

    await expect(
      extractTabTextById(8, {
        sendMessage: ((_tabId, _request, callback) => {
          chromeWithRuntime.chrome.runtime.lastError = {
            message: 'Receiving end does not exist.',
          } as chrome.runtime.LastError;
          callback?.(undefined);
          chromeWithRuntime.chrome.runtime.lastError = undefined;
        }) as typeof chrome.tabs.sendMessage,
      }),
    ).rejects.toThrow(/unable to extract tab text: receiving end does not exist\./i);
  });

  it('rejects malformed extraction response payloads', async () => {
    await expect(
      extractTabTextById(4, {
        sendMessage: ((_tabId, _request, callback) => {
          callback?.({ ok: true, payload: { markdown: 'hello' } });
        }) as typeof chrome.tabs.sendMessage,
      }),
    ).rejects.toThrow(/invalid response payload/i);
  });

  it('surfaces extraction failure message from unsuccessful responses', async () => {
    await expect(
      extractTabTextById(5, {
        sendMessage: ((_tabId, _request, callback) => {
          callback?.({ ok: false, error: 'Script execution failed.' });
        }) as typeof chrome.tabs.sendMessage,
      }),
    ).rejects.toThrow(/script execution failed\./i);
  });

  it('uses fallback failure message when unsuccessful response has empty error', async () => {
    await expect(
      extractTabTextById(6, {
        sendMessage: ((_tabId, _request, callback) => {
          callback?.({ ok: false, error: '' });
        }) as typeof chrome.tabs.sendMessage,
      }),
    ).rejects.toThrow(/tab text extraction failed\./i);
  });

  it('rejects responses whose markdown is empty after normalization', async () => {
    await expect(
      extractTabTextById(9, {
        sendMessage: ((_tabId, _request, callback) => {
          callback?.({
            ok: true,
            payload: {
              markdown: '   ',
              title: 'My page',
              url: 'https://example.test',
            },
          });
        }) as typeof chrome.tabs.sendMessage,
      }),
    ).rejects.toThrow(/extracted tab text is empty/i);
  });
});
