import { describe, expect, it } from 'bun:test';
import { assertNever, toErrorMessage } from '../../src/background/utils';

describe('background utils', () => {
  it('formats error messages with fallback behavior', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage(new Error(''))).toBe('Unexpected error.');
    expect(toErrorMessage({ message: 'not an Error instance' })).toBe('not an Error instance');
  });

  it('throws for unreachable runtime branches', () => {
    expect(() => assertNever('unexpected-request' as never)).toThrow(
      'Unhandled runtime request: unexpected-request',
    );
  });
});
