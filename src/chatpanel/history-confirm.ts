const NEWLINE_PATTERN = /[\r\n]+/g;
const DOUBLE_QUOTE_PATTERN = /"/g;

export function sanitizeSessionTitleForConfirmation(title: string): string {
  const normalized = (typeof title === 'string' ? title : '')
    .replace(NEWLINE_PATTERN, ' ')
    .replace(DOUBLE_QUOTE_PATTERN, "'")
    .trim();

  return normalized || 'this chat';
}
