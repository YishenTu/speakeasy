import type { TabCaptureFullPagePayload } from '../../../shared/runtime';
import { toErrorMessage } from '../../core/utils';

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const SCREENSHOT_MIME_TYPE = 'image/png';
const DEFAULT_SCREENSHOT_FILE_BASENAME = 'speakeasy-full-page';
const MAX_SCREENSHOT_FILE_NAME_LENGTH = 96;

interface ScreenshotBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface LayoutMetricsResponse {
  contentSize?: ScreenshotBounds;
  cssContentSize?: ScreenshotBounds;
}

interface CaptureScreenshotResponse {
  data?: string;
}

interface RuntimeEvaluateResponse {
  result?: {
    value?: unknown;
  };
}

interface CaptureFullPageScreenshotDependencies {
  attach: typeof chrome.debugger.attach;
  sendCommand: typeof chrome.debugger.sendCommand;
  detach: typeof chrome.debugger.detach;
}

export async function captureFullPageScreenshot(
  tabId: number,
  overrides: Partial<CaptureFullPageScreenshotDependencies> = {},
): Promise<TabCaptureFullPagePayload> {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error('Screenshot capture requires a valid tab id.');
  }

  const debuggerApi = chrome.debugger;
  const attach =
    overrides.attach ?? (debuggerApi ? debuggerApi.attach.bind(debuggerApi) : undefined);
  const sendCommand =
    overrides.sendCommand ?? (debuggerApi ? debuggerApi.sendCommand.bind(debuggerApi) : undefined);
  const detach =
    overrides.detach ?? (debuggerApi ? debuggerApi.detach.bind(debuggerApi) : undefined);
  if (!attach || !sendCommand || !detach) {
    throw new Error('Chrome debugger API is unavailable.');
  }

  const dependencies: CaptureFullPageScreenshotDependencies = {
    attach,
    sendCommand,
    detach,
  };

  const target: chrome.debugger.Debuggee = { tabId };
  await attachDebugger(dependencies, target);

  try {
    await sendDebuggerCommand<void>(dependencies, target, 'Page.enable');
    const layoutMetrics = await sendDebuggerCommand<LayoutMetricsResponse>(
      dependencies,
      target,
      'Page.getLayoutMetrics',
    );
    const clip = resolveCaptureClip(layoutMetrics);
    const pageTitle = await readPageTitle(dependencies, target);

    const screenshot = await sendDebuggerCommand<CaptureScreenshotResponse>(
      dependencies,
      target,
      'Page.captureScreenshot',
      {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip,
      },
    );
    const data = screenshot.data?.trim();
    if (!data) {
      throw new Error('Screenshot capture returned an empty payload.');
    }

    return {
      dataUrl: `data:${SCREENSHOT_MIME_TYPE};base64,${data}`,
      mimeType: SCREENSHOT_MIME_TYPE,
      fileName: buildScreenshotFileName(pageTitle),
      width: clip.width,
      height: clip.height,
    };
  } catch (error: unknown) {
    throw new Error(`Unable to capture full-page screenshot: ${toErrorMessage(error)}`);
  } finally {
    await detachDebugger(dependencies, target);
  }
}

async function readPageTitle(
  dependencies: CaptureFullPageScreenshotDependencies,
  target: chrome.debugger.Debuggee,
): Promise<string | null> {
  try {
    const response = await sendDebuggerCommand<RuntimeEvaluateResponse>(
      dependencies,
      target,
      'Runtime.evaluate',
      {
        expression: 'document.title',
        returnByValue: true,
      },
    );
    const title = response.result?.value;
    return typeof title === 'string' ? title : null;
  } catch {
    return null;
  }
}

async function attachDebugger(
  dependencies: CaptureFullPageScreenshotDependencies,
  target: chrome.debugger.Debuggee,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    dependencies.attach(target, DEBUGGER_PROTOCOL_VERSION, () => {
      const errorMessage = readRuntimeLastErrorMessage();
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }
      resolve();
    });
  });
}

async function detachDebugger(
  dependencies: CaptureFullPageScreenshotDependencies,
  target: chrome.debugger.Debuggee,
): Promise<void> {
  await new Promise<void>((resolve) => {
    dependencies.detach(target, () => {
      const errorMessage = readRuntimeLastErrorMessage();
      if (errorMessage) {
        console.warn('Failed to detach debugger after screenshot capture.', errorMessage);
      }
      resolve();
    });
  });
}

async function sendDebuggerCommand<TResponse>(
  dependencies: CaptureFullPageScreenshotDependencies,
  target: chrome.debugger.Debuggee,
  method: string,
  commandParams?: object,
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    const callback = (result?: TResponse) => {
      const errorMessage = readRuntimeLastErrorMessage();
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }

      resolve(result as TResponse);
    };

    if (typeof commandParams === 'undefined') {
      dependencies.sendCommand(target, method as never, callback as unknown as () => void);
      return;
    }

    dependencies.sendCommand(
      target,
      method as never,
      commandParams as never,
      callback as unknown as () => void,
    );
  });
}

function resolveCaptureClip(layoutMetrics: LayoutMetricsResponse): {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
} {
  const size = layoutMetrics.cssContentSize ?? layoutMetrics.contentSize;
  const width = Number(size?.width);
  const height = Number(size?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Unable to determine page dimensions for screenshot capture.');
  }

  const x = Number(size?.x);
  const y = Number(size?.y);

  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Math.ceil(width),
    height: Math.ceil(height),
    scale: 1,
  };
}

function buildScreenshotFileName(pageTitle: string | null): string {
  const sanitizedBaseName = sanitizeScreenshotFileBaseName(pageTitle);
  return `${sanitizedBaseName}.png`;
}

function sanitizeScreenshotFileBaseName(pageTitle: string | null): string {
  const collapsedWhitespace = (pageTitle ?? '').replace(/\s+/g, ' ').trim();
  const withoutControlCharacters = stripAsciiControlCharacters(collapsedWhitespace);
  const sanitized = withoutControlCharacters
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return DEFAULT_SCREENSHOT_FILE_BASENAME;
  }

  const truncated = sanitized.slice(0, MAX_SCREENSHOT_FILE_NAME_LENGTH).trim();
  return truncated || DEFAULT_SCREENSHOT_FILE_BASENAME;
}

function stripAsciiControlCharacters(input: string): string {
  let result = '';
  for (const character of input) {
    const codePoint = character.codePointAt(0);
    if (typeof codePoint === 'number' && (codePoint <= 0x1f || codePoint === 0x7f)) {
      result += ' ';
      continue;
    }
    result += character;
  }
  return result;
}

function readRuntimeLastErrorMessage(): string | null {
  const message = chrome.runtime.lastError?.message?.trim();
  return message ? message : null;
}
