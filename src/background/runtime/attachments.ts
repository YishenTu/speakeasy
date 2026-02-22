import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH,
  estimateBase64DecodedByteLength,
  parseImageDataUrl,
} from '../../shared/attachment-preview';
import type {
  ChatUploadFailurePayload,
  FileDataAttachmentPayload,
  UploadFilePayload,
  UploadFileTransportPayload,
} from '../../shared/runtime';

export function normalizeFileDataAttachments(
  attachments: FileDataAttachmentPayload[] | undefined,
): FileDataAttachmentPayload[] {
  if (!attachments) {
    return [];
  }

  const normalized: FileDataAttachmentPayload[] = [];
  for (const attachment of attachments) {
    const fileUri = typeof attachment.fileUri === 'string' ? attachment.fileUri.trim() : '';
    const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim() : '';
    const name = typeof attachment.name === 'string' ? attachment.name.trim() : '';
    if (!fileUri || !mimeType || !name) {
      continue;
    }

    const fileName =
      typeof attachment.fileName === 'string' && attachment.fileName.trim()
        ? attachment.fileName.trim()
        : undefined;

    const normalizedAttachment: FileDataAttachmentPayload = {
      name,
      mimeType,
      fileUri,
    };
    if (fileName) {
      normalizedAttachment.fileName = fileName;
    }
    const previewDataUrl = normalizeAttachmentPreviewDataUrl(attachment.previewDataUrl, mimeType);
    if (previewDataUrl) {
      normalizedAttachment.previewDataUrl = previewDataUrl;
    }

    normalized.push(normalizedAttachment);
  }

  return normalized;
}

export function buildAttachmentPreviewByFileUri(
  attachments: readonly FileDataAttachmentPayload[],
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const attachment of attachments) {
    const fileUri = attachment.fileUri.trim();
    const previewDataUrl = attachment.previewDataUrl?.trim();
    if (!fileUri || !previewDataUrl) {
      continue;
    }

    normalized[fileUri] = previewDataUrl;
  }

  return normalized;
}

export function normalizeAttachmentPreviewDataUrl(
  value: unknown,
  mimeType: string,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH) {
    return undefined;
  }
  const parsedDataUrl = parseImageDataUrl(normalized);
  if (!parsedDataUrl) {
    return undefined;
  }
  if (estimateBase64DecodedByteLength(parsedDataUrl.base64) > ATTACHMENT_PREVIEW_MAX_BYTES) {
    return undefined;
  }

  const normalizedAttachmentMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!normalizedAttachmentMimeType.startsWith('image/')) {
    return undefined;
  }
  if (parsedDataUrl.mimeType !== normalizedAttachmentMimeType) {
    return undefined;
  }

  return normalized;
}

export function normalizeUploadFiles(files: UploadFileTransportPayload[] | undefined): {
  files: UploadFilePayload[];
  failures: ChatUploadFailurePayload[];
} {
  if (!Array.isArray(files)) {
    return {
      files: [],
      failures: [],
    };
  }

  const normalized: UploadFilePayload[] = [];
  const failures: ChatUploadFailurePayload[] = [];
  for (const [index, file] of files.entries()) {
    const name = typeof file.name === 'string' ? file.name.trim() : '';
    const mimeType = typeof file.mimeType === 'string' ? file.mimeType.trim() : '';
    const candidateBytes =
      typeof file.bytesBase64 === 'string'
        ? file.bytesBase64
        : (file as UploadFileTransportPayload & { bytes?: unknown }).bytes;
    const bytes = normalizeUploadFileBytes(candidateBytes);
    if (!bytes) {
      const normalizedName = name || 'attachment';
      failures.push({
        index,
        fileName: normalizedName,
        message: `Failed to upload "${normalizedName}": file bytes were malformed.`,
      });
      continue;
    }

    normalized.push({
      name: name || 'attachment',
      mimeType: mimeType || 'application/octet-stream',
      bytes,
    });
  }

  return {
    files: normalized,
    failures,
  };
}

export function normalizeUploadFileBytes(value: unknown): ArrayBuffer | null {
  if (typeof value === 'string') {
    return decodeBase64ToArrayBuffer(value);
  }

  if (
    value instanceof ArrayBuffer ||
    Object.prototype.toString.call(value) === '[object ArrayBuffer]'
  ) {
    return value as ArrayBuffer;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value;
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return bytes.buffer;
  }

  return null;
}

export function decodeBase64ToArrayBuffer(encoded: string): ArrayBuffer | null {
  const normalized = encoded.trim();
  if (!normalized) {
    return null;
  }

  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}
