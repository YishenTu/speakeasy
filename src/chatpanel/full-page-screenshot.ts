import { decodeBase64ToArrayBuffer } from '../shared/base64';
import { captureCurrentTabFullPageScreenshot } from '../shared/chat';
import type { TabCaptureFullPagePayload } from '../shared/runtime';

const DEFAULT_SCREENSHOT_FILE_NAME = 'speakeasy-full-page.png';

interface CaptureAndStageDependencies {
  stageFromFiles: (files: File[]) => void;
  requestFullPageScreenshot?: () => Promise<TabCaptureFullPagePayload>;
}

export async function captureAndStageFullPageScreenshot(
  dependencies: CaptureAndStageDependencies,
): Promise<File> {
  const requestFullPageScreenshot =
    dependencies.requestFullPageScreenshot ?? captureCurrentTabFullPageScreenshot;
  const screenshotPayload = await requestFullPageScreenshot();
  const screenshotFile = toScreenshotFile(screenshotPayload);
  dependencies.stageFromFiles([screenshotFile]);
  return screenshotFile;
}

export function toScreenshotFile(payload: TabCaptureFullPagePayload): File {
  const normalizedMimeType = payload.mimeType.trim().toLowerCase();
  if (!normalizedMimeType.startsWith('image/')) {
    throw new Error('Screenshot payload must be an image.');
  }

  const dataUrl = payload.dataUrl.trim();
  if (!dataUrl) {
    throw new Error('Screenshot payload is missing image data.');
  }

  const dataUrlMatch = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!dataUrlMatch) {
    throw new Error('Screenshot payload contains an invalid data URL.');
  }

  const dataUrlMimeType = dataUrlMatch[1]?.trim().toLowerCase();
  const base64Bytes = dataUrlMatch[2]?.trim() ?? '';
  if (!dataUrlMimeType || !base64Bytes) {
    throw new Error('Screenshot payload contains an invalid data URL.');
  }

  if (dataUrlMimeType !== normalizedMimeType) {
    throw new Error('Screenshot payload MIME type does not match image data.');
  }

  const bytes = decodeBase64ToArrayBuffer(base64Bytes);
  if (!bytes) {
    throw new Error('Screenshot payload contains invalid base64 image data.');
  }

  const normalizedFileName = normalizeScreenshotFileName(payload.fileName);
  return new File([bytes], normalizedFileName, { type: normalizedMimeType });
}

function normalizeScreenshotFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return DEFAULT_SCREENSHOT_FILE_NAME;
  }

  return trimmed.toLowerCase().endsWith('.png') ? trimmed : `${trimmed}.png`;
}
