export const ATTACHMENT_PREVIEW_MAX_BYTES = 256 * 1024;
export const ATTACHMENT_PREVIEW_MAX_BASE64_LENGTH = Math.ceil(
  (ATTACHMENT_PREVIEW_MAX_BYTES / 3) * 4,
);
export const ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH = ATTACHMENT_PREVIEW_MAX_BASE64_LENGTH + 64;
export const ATTACHMENT_PREVIEW_TEXT_MAX_CHARS = 64 * 1024;

const IMAGE_DATA_URL_PATTERN = /^data:([^;,]+);base64,([a-zA-Z0-9+/_=-]+)$/;

export interface ParsedImageDataUrl {
  mimeType: string;
  base64: string;
}

export function parseImageDataUrl(value: string): ParsedImageDataUrl | null {
  const match = IMAGE_DATA_URL_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const mimeType = match[1]?.trim().toLowerCase() ?? '';
  const base64 = match[2] ?? '';
  if (!mimeType.startsWith('image/') || !base64) {
    return null;
  }

  return {
    mimeType,
    base64,
  };
}

export function estimateBase64DecodedByteLength(base64: string): number {
  const normalized = base64.trim();
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}
