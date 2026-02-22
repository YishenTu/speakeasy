import { describe, expect, test } from 'bun:test';
import { formatHistoryTimestamp } from '../../../src/chatpanel/history-dropdown';

describe('formatHistoryTimestamp', () => {
  test('formats a valid ISO timestamp', () => {
    const result = formatHistoryTimestamp('2025-06-15T14:30:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
  });

  test('falls back to sliced string for unparseable timestamps', () => {
    const result = formatHistoryTimestamp('not-a-date');
    expect(result).toBe('not-a-date');
  });

  test('handles ISO-like strings with time portion', () => {
    const result = formatHistoryTimestamp('2025-01-01T00:00:00.000Z');
    expect(result).toContain('Jan');
    expect(result).toContain('1');
  });
});
