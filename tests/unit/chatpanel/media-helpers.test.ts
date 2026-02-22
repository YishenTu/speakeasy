import { describe, expect, test } from 'bun:test';
import {
  formatByteSize,
  getFilePreviewTypeLabel,
  isAcceptedMimeType,
  isImageMimeType,
  isPdfMimeType,
} from '../../../src/chatpanel/media-helpers';

describe('isImageMimeType', () => {
  test('returns true for image MIME types', () => {
    expect(isImageMimeType('image/jpeg')).toBe(true);
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isImageMimeType('image/gif')).toBe(true);
    expect(isImageMimeType('image/webp')).toBe(true);
  });

  test('returns false for non-image MIME types', () => {
    expect(isImageMimeType('application/pdf')).toBe(false);
    expect(isImageMimeType('text/plain')).toBe(false);
    expect(isImageMimeType('')).toBe(false);
  });

  test('strips parameters and normalizes case', () => {
    expect(isImageMimeType('image/PNG; charset=utf-8')).toBe(true);
    expect(isImageMimeType('IMAGE/JPEG')).toBe(true);
  });
});

describe('isPdfMimeType', () => {
  test('returns true for PDF MIME type', () => {
    expect(isPdfMimeType('application/pdf')).toBe(true);
  });

  test('returns false for non-PDF MIME types', () => {
    expect(isPdfMimeType('image/png')).toBe(false);
    expect(isPdfMimeType('text/plain')).toBe(false);
    expect(isPdfMimeType('')).toBe(false);
  });

  test('normalizes case and strips parameters', () => {
    expect(isPdfMimeType('APPLICATION/PDF')).toBe(true);
    expect(isPdfMimeType('application/pdf; charset=utf-8')).toBe(true);
  });
});

describe('isAcceptedMimeType', () => {
  test('accepts supported types', () => {
    expect(isAcceptedMimeType('image/jpeg')).toBe(true);
    expect(isAcceptedMimeType('image/png')).toBe(true);
    expect(isAcceptedMimeType('image/gif')).toBe(true);
    expect(isAcceptedMimeType('image/webp')).toBe(true);
    expect(isAcceptedMimeType('application/pdf')).toBe(true);
    expect(isAcceptedMimeType('text/plain')).toBe(true);
  });

  test('rejects unsupported types', () => {
    expect(isAcceptedMimeType('video/mp4')).toBe(false);
    expect(isAcceptedMimeType('application/json')).toBe(false);
    expect(isAcceptedMimeType('image/svg+xml')).toBe(false);
    expect(isAcceptedMimeType('')).toBe(false);
  });

  test('normalizes case and strips parameters', () => {
    expect(isAcceptedMimeType('IMAGE/PNG')).toBe(true);
    expect(isAcceptedMimeType('text/plain; charset=utf-8')).toBe(true);
  });
});

describe('getFilePreviewTypeLabel', () => {
  test('returns PDF for PDF MIME type', () => {
    expect(getFilePreviewTypeLabel({ name: 'doc.pdf', mimeType: 'application/pdf' })).toBe('PDF');
  });

  test('returns file extension for known extensions', () => {
    expect(getFilePreviewTypeLabel({ name: 'data.csv', mimeType: 'text/plain' })).toBe('CSV');
    expect(getFilePreviewTypeLabel({ name: 'image.png', mimeType: 'image/png' })).toBe('PNG');
    expect(getFilePreviewTypeLabel({ name: 'file.txt', mimeType: 'text/plain' })).toBe('TXT');
  });

  test('returns FILE for extensions longer than 5 characters', () => {
    expect(
      getFilePreviewTypeLabel({ name: 'file.toolong', mimeType: 'application/octet-stream' }),
    ).toBe('FILE');
  });

  test('uses filename as label when no dot separator exists', () => {
    expect(getFilePreviewTypeLabel({ name: 'noext', mimeType: 'application/octet-stream' })).toBe(
      'NOEXT',
    );
  });
});

describe('formatByteSize', () => {
  test('formats bytes', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(1023)).toBe('1023 B');
  });

  test('formats kilobytes', () => {
    expect(formatByteSize(1024)).toBe('1 KB');
    expect(formatByteSize(1536)).toBe('1.5 KB');
  });

  test('formats megabytes', () => {
    expect(formatByteSize(1024 * 1024)).toBe('1 MB');
    expect(formatByteSize(20 * 1024 * 1024)).toBe('20 MB');
  });
});
