export function normalizeMimeType(value: string, fallback = ''): string {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return normalized || fallback;
}
