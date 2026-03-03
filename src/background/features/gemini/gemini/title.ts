const MAX_SESSION_TITLE_LENGTH = 60;
export const SESSION_TITLE_MODEL = 'gemini-3.1-flash-lite-preview';

export function buildSessionTitlePrompt(firstUserQuery: string): string {
  const lines = [
    'Generate a concise session title for a chat history dropdown.',
    'Return only the title text with no quotes or markdown.',
    'Keep the title between 3 and 8 words and under 60 characters.',
  ];
  if (firstUserQuery) {
    lines.push(`User query: ${firstUserQuery}`);
  } else {
    lines.push('The user sent the attached file(s) with no text. Base the title on the content.');
  }
  return lines.join('\n');
}

export function sanitizeGeneratedSessionTitle(rawTitle: string): string {
  const firstLine =
    rawTitle
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  const normalized = stripWrappingDelimiters(firstLine.replace(/\s+/g, ' ').trim());

  if (!normalized) {
    return '';
  }

  if (normalized.length <= MAX_SESSION_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function stripWrappingDelimiters(value: string): string {
  let result = value;
  while (
    result.length >= 2 &&
    (result[0] === '"' || result[0] === "'" || result[0] === '`') &&
    result.endsWith(result[0])
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}
