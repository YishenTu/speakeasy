import { describe, expect, it } from 'bun:test';
import {
  formatHistoryTimestampValue,
  formatMessageTimestamp,
} from '../../../src/chatpanel/core/time-format';

describe('chatpanel time format helpers', () => {
  it('formats message timestamps as 24-hour clock time', () => {
    const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
    const formatCalls: Array<{
      locales: Intl.LocalesArgument | undefined;
      options: Intl.DateTimeFormatOptions | undefined;
    }> = [];

    Date.prototype.toLocaleTimeString = function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ): string {
      formatCalls.push({ locales, options });
      return '14:30';
    } as typeof Date.prototype.toLocaleTimeString;

    try {
      expect(formatMessageTimestamp(new Date('2026-02-22T14:30:00Z').getTime())).toBe('14:30');
    } finally {
      Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    }

    const formatCall = formatCalls.at(0);
    expect(formatCall?.options).toMatchObject({
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  });

  it('formats history timestamps with month/day and hour/minute', () => {
    const input = '2025-06-15T14:30:00Z';
    const expected = new Date(Date.parse(input)).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    expect(formatHistoryTimestampValue(input)).toBe(expected);
  });

  it('falls back to normalized raw history text when parsing fails', () => {
    expect(formatHistoryTimestampValue('not-a-date')).toBe('not-a-date');
    expect(formatHistoryTimestampValue('2025-06-15T14:30:not-a-date')).toBe('2025-06-15 14:30');
  });
});
