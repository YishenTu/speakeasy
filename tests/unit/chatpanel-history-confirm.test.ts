import { describe, expect, it } from 'bun:test';
import { sanitizeSessionTitleForConfirmation } from '../../src/chatpanel/features/history/history-confirm';

describe('sanitizeSessionTitleForConfirmation', () => {
  it('strips control formatting from session titles before confirm dialogs', () => {
    expect(sanitizeSessionTitleForConfirmation('  urgent "topic"\nline two\r\nline three  ')).toBe(
      "urgent 'topic' line two line three",
    );
  });

  it('falls back to a neutral label when the title becomes empty', () => {
    expect(sanitizeSessionTitleForConfirmation('  \n\r  ')).toBe('this chat');
  });
});
