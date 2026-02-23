import type { RuntimeResponse, TabExtractTextPayload } from './runtime';
import { isRecord } from './utils';

export const TAB_EXTRACT_TEXT_MESSAGE_TYPE = 'tab/extract-text';

export interface TabExtractTextMessageRequest {
  type: typeof TAB_EXTRACT_TEXT_MESSAGE_TYPE;
}

export function isTabExtractTextMessageRequest(
  value: unknown,
): value is TabExtractTextMessageRequest {
  return isRecord(value) && value.type === TAB_EXTRACT_TEXT_MESSAGE_TYPE;
}

export function isTabExtractTextMessageResponse(
  value: unknown,
): value is RuntimeResponse<TabExtractTextPayload> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }

  if (!value.ok) {
    return typeof value.error === 'string';
  }

  const payload = value.payload;
  return (
    isRecord(payload) &&
    typeof payload.markdown === 'string' &&
    typeof payload.title === 'string' &&
    typeof payload.url === 'string'
  );
}
