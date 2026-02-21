export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isObjectEmpty(value: object): boolean {
  return Object.keys(value).length === 0;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unexpected error.';
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled runtime request: ${String(value)}`);
}
