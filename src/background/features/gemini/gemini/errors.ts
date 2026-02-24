import { isRecord, toErrorMessage } from '../../../core/utils';
import { readStringField } from './common';

const INVALID_PREVIOUS_INTERACTION_ID_ERROR_MESSAGE =
  'Gemini rejected previous_interaction_id for this conversation.';

export class InvalidPreviousInteractionIdError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'InvalidPreviousInteractionIdError';
  }
}

export function isInvalidPreviousInteractionIdError(
  error: unknown,
): error is InvalidPreviousInteractionIdError {
  return error instanceof InvalidPreviousInteractionIdError;
}

export function asInvalidPreviousInteractionIdError(
  error: unknown,
  cause: unknown = error,
): InvalidPreviousInteractionIdError | null {
  if (!isPreviousInteractionIdError(error)) {
    return null;
  }

  return new InvalidPreviousInteractionIdError(
    INVALID_PREVIOUS_INTERACTION_ID_ERROR_MESSAGE,
    cause,
  );
}

function isPreviousInteractionIdError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  if (
    message.includes('previous_interaction_id') ||
    (message.includes('previous interaction') && message.includes('id'))
  ) {
    return true;
  }

  if (!isRecord(error)) {
    return false;
  }

  const errorMessage = readStringField(error, 'message', 'error').toLowerCase();
  return (
    errorMessage.includes('previous_interaction_id') ||
    (errorMessage.includes('previous interaction') && errorMessage.includes('id'))
  );
}
