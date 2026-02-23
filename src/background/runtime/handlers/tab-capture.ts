import type { RuntimeRequest, TabCaptureFullPagePayload } from '../../../shared/runtime';
import type { RuntimeDependencies, RuntimeRequestContext } from '../contracts';

const INVALID_TARGET_TAB_ID_MESSAGE =
  'Full-page screenshot capture requires a valid target tab id.';
const INVALID_SENDER_TAB_ID_MESSAGE =
  'Full-page screenshot capture requires an active browser tab.';

export async function handleCaptureFullPageScreenshot(
  context: RuntimeRequestContext | undefined,
  dependencies: RuntimeDependencies,
): Promise<TabCaptureFullPagePayload> {
  const tabId = context?.sender?.tab?.id;
  if (!isPositiveInteger(tabId)) {
    throw new Error(INVALID_SENDER_TAB_ID_MESSAGE);
  }

  return dependencies.captureFullPageScreenshot(tabId);
}

export async function handleCaptureFullPageScreenshotById(
  request: Extract<RuntimeRequest, { type: 'tab/capture-full-page-by-id' }>,
  dependencies: RuntimeDependencies,
): Promise<TabCaptureFullPagePayload> {
  if (!isPositiveInteger(request.tabId)) {
    throw new Error(INVALID_TARGET_TAB_ID_MESSAGE);
  }

  return dependencies.captureFullPageScreenshot(request.tabId);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
