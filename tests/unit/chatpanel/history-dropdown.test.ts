import { describe, expect, test } from 'bun:test';
import { formatHistoryTimestamp } from '../../../src/chatpanel/history-dropdown';

describe('formatHistoryTimestamp', () => {
  test('formats a valid ISO timestamp', () => {
    const input = '2025-06-15T14:30:00Z';
    const expected = new Date(Date.parse(input)).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const result = formatHistoryTimestamp(input);
    expect(result).toBe(expected);
  });

  test('falls back to sliced string for unparseable timestamps', () => {
    const result = formatHistoryTimestamp('not-a-date');
    expect(result).toBe('not-a-date');
  });

  test('handles ISO-like strings with time portion', () => {
    const input = '2025-01-01T00:00:00.000Z';
    const expected = new Date(Date.parse(input)).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const result = formatHistoryTimestamp(input);
    expect(result).toBe(expected);
  });
});
