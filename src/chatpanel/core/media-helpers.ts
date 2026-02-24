import { normalizeMimeType } from '../../shared/mime';

const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

export function isAcceptedMimeType(mimeType: string): boolean {
  return ACCEPTED_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function isImageMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType).startsWith('image/');
}

export function isPdfMimeType(mimeType: string): boolean {
  return normalizeMimeType(mimeType) === 'application/pdf';
}

export function getFilePreviewTypeLabel(file: { name: string; mimeType: string }): string {
  if (isPdfMimeType(file.mimeType)) {
    return 'PDF';
  }

  const extension = file.name.split('.').pop()?.trim().toUpperCase() ?? '';
  if (/^[A-Z0-9]{1,5}$/.test(extension)) {
    return extension;
  }

  return 'FILE';
}

export function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }
  return `${bytes} B`;
}
