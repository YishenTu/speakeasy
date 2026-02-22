import { isRecord } from './utils';

interface ErrorMessageOptions {
  fallback?: string;
}

const DEFAULT_ERROR_MESSAGE = 'Unexpected error.';

export function toErrorMessage(error: unknown, options: ErrorMessageOptions = {}): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }

  if (typeof error === 'string') {
    const message = error.trim();
    if (message) {
      return message;
    }
  }

  if (isRecord(error)) {
    const messageField =
      typeof error.message === 'string'
        ? error.message
        : typeof error.error === 'string'
          ? error.error
          : '';
    const message = messageField.trim();
    if (message) {
      return message;
    }
  }

  return options.fallback ?? DEFAULT_ERROR_MESSAGE;
}
