import { describe, expect, it } from 'bun:test';
import { normalizeMimeType } from '../../../src/shared/mime';

describe('normalizeMimeType', () => {
  it('normalizes casing, whitespace, and optional parameters', () => {
    expect(normalizeMimeType(' IMAGE/PNG; charset=utf-8 ')).toBe('image/png');
    expect(normalizeMimeType('text/plain')).toBe('text/plain');
  });

  it('returns fallback when mime type is empty after normalization', () => {
    expect(normalizeMimeType('   ', 'application/octet-stream')).toBe('application/octet-stream');
    expect(normalizeMimeType('', 'text/plain')).toBe('text/plain');
  });
});
