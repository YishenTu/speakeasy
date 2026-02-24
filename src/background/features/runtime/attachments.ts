import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH,
  ATTACHMENT_PREVIEW_TEXT_MAX_CHARS,
  estimateBase64DecodedByteLength,
  parseImageDataUrl,
} from '../../../shared/attachment-preview';
import { decodeBase64ToArrayBuffer } from '../../../shared/base64';
import type {
  ChatUploadFailurePayload,
  FileDataAttachmentPayload,
  UploadFilePayload,
  UploadFileTransportPayload,
} from '../../../shared/runtime';

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
    const previewText = normalizeAttachmentPreviewText(attachment.previewText);
    if (previewText) {
      normalizedAttachment.previewText = previewText;
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

export function buildAttachmentPreviewTextByFileUri(
  attachments: readonly FileDataAttachmentPayload[],
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const attachment of attachments) {
    const fileUri = attachment.fileUri.trim();
    const previewText = attachment.previewText?.trim();
    if (!fileUri || !previewText) {
      continue;
    }

    normalized[fileUri] = previewText;
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

export function normalizeAttachmentPreviewText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, ATTACHMENT_PREVIEW_TEXT_MAX_CHARS).trim() || undefined;
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
