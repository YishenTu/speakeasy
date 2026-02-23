import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { captureFullPageScreenshot } from '../../src/background/full-page-screenshot';

type RuntimeWithLastError = {
  runtime: {
    lastError?: chrome.runtime.LastError;
  };
};

describe('background full-page screenshot', () => {
  beforeEach(() => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {},
    };
  });

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('captures full-page screenshot data through the debugger protocol', async () => {
    const commandCalls: Array<{ method: string; params?: object }> = [];
    const attachCalls: chrome.debugger.Debuggee[] = [];
    const detachCalls: chrome.debugger.Debuggee[] = [];

    const payload = await captureFullPageScreenshot(44, {
      attach: (target, version, callback) => {
        attachCalls.push(target);
        expect(version).toBe('1.3');
        callback();
      },
      sendCommand: (target, method, paramsOrCallback, maybeCallback) => {
        const params = typeof paramsOrCallback === 'function' ? undefined : paramsOrCallback;
        const callback =
          typeof paramsOrCallback === 'function'
            ? (paramsOrCallback as (result?: unknown) => void)
            : (maybeCallback as (result?: unknown) => void);

        commandCalls.push({ method, ...(params ? { params } : {}) });
        expect(target).toEqual({ tabId: 44 });

        if (method === 'Page.getLayoutMetrics') {
          callback({
            cssContentSize: {
              x: 0,
              y: 0,
              width: 1280.4,
              height: 3020.1,
            },
          });
          return;
        }

        if (method === 'Runtime.evaluate') {
          callback({
            result: {
              value: '  Example Article Title  ',
            },
          });
          return;
        }

        if (method === 'Page.captureScreenshot') {
          callback({
            data: 'AAAA',
          });
          return;
        }

        callback();
      },
      detach: (target, callback) => {
        detachCalls.push(target);
        callback();
      },
    });

    expect(attachCalls).toEqual([{ tabId: 44 }]);
    expect(commandCalls.map((call) => call.method)).toEqual([
      'Page.enable',
      'Page.getLayoutMetrics',
      'Runtime.evaluate',
      'Page.captureScreenshot',
    ]);
    expect(commandCalls[3]).toEqual({
      method: 'Page.captureScreenshot',
      params: {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: 1281,
          height: 3021,
          scale: 1,
        },
      },
    });
    expect(detachCalls).toEqual([{ tabId: 44 }]);
    expect(payload).toEqual({
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      fileName: 'Example Article Title.png',
      width: 1281,
      height: 3021,
    });
  });

  it('detaches debugger when screenshot capture fails after attach', async () => {
    const detachCalls: chrome.debugger.Debuggee[] = [];

    await expect(
      captureFullPageScreenshot(11, {
        attach: (_target, _version, callback) => {
          callback();
        },
        sendCommand: (_target, method, paramsOrCallback, maybeCallback) => {
          const callback =
            typeof paramsOrCallback === 'function'
              ? (paramsOrCallback as (result?: unknown) => void)
              : (maybeCallback as (result?: unknown) => void);

          if (method === 'Page.getLayoutMetrics') {
            callback({
              cssContentSize: {
                x: 0,
                y: 0,
                width: 0,
                height: 1200,
              },
            });
            return;
          }

          callback();
        },
        detach: (target, callback) => {
          detachCalls.push(target);
          callback();
        },
      }),
    ).rejects.toThrow(/full-page screenshot/i);

    expect(detachCalls).toEqual([{ tabId: 11 }]);
  });

  it('surfaces debugger command errors from chrome.runtime.lastError', async () => {
    const chromeWithRuntime = globalThis as typeof globalThis & RuntimeWithLastError;

    await expect(
      captureFullPageScreenshot(33, {
        attach: (_target, _version, callback) => {
          callback();
        },
        sendCommand: (_target, method, paramsOrCallback, maybeCallback) => {
          const callback =
            typeof paramsOrCallback === 'function'
              ? (paramsOrCallback as (result?: unknown) => void)
              : (maybeCallback as (result?: unknown) => void);

          if (method === 'Page.getLayoutMetrics') {
            chromeWithRuntime.runtime.lastError = {
              message: 'Debugger command failed',
            } as chrome.runtime.LastError;
            callback(undefined);
            chromeWithRuntime.runtime.lastError = undefined;
            return;
          }

          callback();
        },
        detach: (_target, callback) => {
          callback();
        },
      }),
    ).rejects.toThrow(/debugger command failed/i);
  });

  it('falls back to default screenshot name when title evaluation is unavailable', async () => {
    const payload = await captureFullPageScreenshot(56, {
      attach: (_target, _version, callback) => {
        callback();
      },
      sendCommand: (_target, method, paramsOrCallback, maybeCallback) => {
        const callback =
          typeof paramsOrCallback === 'function'
            ? (paramsOrCallback as (result?: unknown) => void)
            : (maybeCallback as (result?: unknown) => void);

        if (method === 'Page.getLayoutMetrics') {
          callback({
            cssContentSize: {
              x: 0,
              y: 0,
              width: 600,
              height: 900,
            },
          });
          return;
        }

        if (method === 'Runtime.evaluate') {
          callback({
            result: {
              value: '',
            },
          });
          return;
        }

        if (method === 'Page.captureScreenshot') {
          callback({
            data: 'BBBB',
          });
          return;
        }

        callback();
      },
      detach: (_target, callback) => {
        callback();
      },
    });

    expect(payload.fileName).toBe('speakeasy-full-page.png');
  });
});
