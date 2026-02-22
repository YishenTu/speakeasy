import { describe, expect, it } from 'bun:test';
import {
  ATTACHMENT_PREVIEW_MAX_BASE64_LENGTH,
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH,
  estimateBase64DecodedByteLength,
  parseImageDataUrl,
} from '../../src/shared/attachment-preview';

describe('shared attachment preview helpers', () => {
  it('parses image data URLs and normalizes mime type casing', () => {
    const parsed = parseImageDataUrl('data:IMAGE/PNG;base64,aGVsbG8=');

    expect(parsed).toEqual({
      mimeType: 'image/png',
      base64: 'aGVsbG8=',
    });
  });

  it('rejects non-image and malformed data URLs', () => {
    expect(parseImageDataUrl('data:text/plain;base64,aGVsbG8=')).toBeNull();
    expect(parseImageDataUrl('not-a-data-url')).toBeNull();
    expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
  });

  it('estimates decoded base64 byte length with and without padding', () => {
    expect(estimateBase64DecodedByteLength('YQ==')).toBe(1);
    expect(estimateBase64DecodedByteLength('YWI=')).toBe(2);
    expect(estimateBase64DecodedByteLength('YWJj')).toBe(3);
  });

  it('exposes stable preview size limits', () => {
    expect(ATTACHMENT_PREVIEW_MAX_BYTES).toBe(256 * 1024);
    expect(ATTACHMENT_PREVIEW_MAX_BASE64_LENGTH).toBeGreaterThan(ATTACHMENT_PREVIEW_MAX_BYTES);
    expect(ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH).toBeGreaterThan(
      ATTACHMENT_PREVIEW_MAX_BASE64_LENGTH,
    );
  });
});
