const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

export function isAcceptedMimeType(mimeType: string): boolean {
  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return ACCEPTED_MIME_TYPES.has(normalizedMimeType);
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase().startsWith('image/') ?? false;
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() === 'application/pdf';
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
