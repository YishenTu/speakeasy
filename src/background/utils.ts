export { isRecord } from '../shared/utils';

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
