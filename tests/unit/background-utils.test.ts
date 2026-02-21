import { describe, expect, it } from 'bun:test';
import { assertNever, isObjectEmpty, toErrorMessage } from '../../src/background/utils';

describe('background utils', () => {
  it('detects whether objects are empty', () => {
    expect(isObjectEmpty({})).toBe(true);
    expect(isObjectEmpty({ key: 'value' })).toBe(false);
  });

  it('formats error messages with fallback behavior', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage(new Error(''))).toBe('Unexpected error.');
    expect(toErrorMessage({ message: 'not an Error instance' })).toBe('Unexpected error.');
  });

  it('throws for unreachable runtime branches', () => {
    expect(() => assertNever('unexpected-request' as never)).toThrow(
      'Unhandled runtime request: unexpected-request',
    );
  });
});
