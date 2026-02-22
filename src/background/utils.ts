export { isRecord } from '../shared/utils';
import { toErrorMessage as toSharedErrorMessage } from '../shared/error-message';

export function toErrorMessage(error: unknown): string {
  return toSharedErrorMessage(error, { fallback: 'Unexpected error.' });
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled runtime request: ${String(value)}`);
}
