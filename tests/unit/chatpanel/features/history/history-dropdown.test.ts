import { describe, expect, test } from 'bun:test';
import { formatHistoryTimestamp } from '../../../../../src/chatpanel/features/history/history-dropdown';

describe('formatHistoryTimestamp', () => {
  test.each([['2025-06-15T14:30:00Z'], ['2025-01-01T00:00:00.000Z']])(
    'formats valid ISO timestamp %s',
    (input) => {
      const expected = new Date(Date.parse(input)).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      expect(formatHistoryTimestamp(input)).toBe(expected);
    },
  );

  test('falls back to raw string for unparseable timestamps', () => {
    expect(formatHistoryTimestamp('not-a-date')).toBe('not-a-date');
  });
});
