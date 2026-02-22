import { isRecord } from '../utils';

export function readStringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
}

export function readPartRecord(
  part: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): Record<string, unknown> | null {
  if (isRecord(part[camelKey])) {
    return part[camelKey] as Record<string, unknown>;
  }
  if (isRecord(part[snakeKey])) {
    return part[snakeKey] as Record<string, unknown>;
  }
  return null;
}

export function summarizeInteractionOutput(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const type = typeof output.type === 'string' ? output.type.trim() : '';
  summary.type = type || 'unknown';

  const name = typeof output.name === 'string' ? output.name.trim() : '';
  if (name) {
    summary.name = name;
  }

  const id = typeof output.id === 'string' ? output.id.trim() : '';
  if (id) {
    summary.id = id;
  }

  const result = output.result;
  if (Array.isArray(result)) {
    summary.resultCount = result.length;
  }

  return summary;
}

export function summarizeUnknownPart(part: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(part).slice(0, 8);
  const summary: Record<string, unknown> = {
    type: 'unknown_part',
  };
  if (keys.length > 0) {
    summary.keys = keys;
  }

  return summary;
}

export function normalizeFunctionCallArgs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return { ...value };
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

export function inferFileNameFromUri(fileUri: string): string {
  const match = fileUri.match(/\/([^/?#]+)(?:[?#]|$)/);
  if (!match?.[1]) {
    return 'attachment';
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function inferAttachmentNameFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('image/')) {
    return 'image';
  }
  if (normalized === 'application/pdf') {
    return 'document.pdf';
  }
  if (normalized.startsWith('text/')) {
    return 'document.txt';
  }

  return 'attachment';
}

export function inferMediaTypeFromMimeType(
  mimeType: string,
): 'image' | 'audio' | 'video' | 'document' {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.startsWith('image/')) {
    return 'image';
  }
  if (normalizedMimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (normalizedMimeType.startsWith('video/')) {
    return 'video';
  }

  return 'document';
}
