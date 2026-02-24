import { describe, expect, it } from 'bun:test';
import {
  TAB_EXTRACT_TEXT_MESSAGE_TYPE,
  isTabExtractTextMessageRequest,
  isTabExtractTextMessageResponse,
} from '../../../src/shared/tab-text-extraction-message';

describe('shared tab text extraction message helpers', () => {
  it('accepts only valid extraction request payloads', () => {
    expect(isTabExtractTextMessageRequest({ type: TAB_EXTRACT_TEXT_MESSAGE_TYPE })).toBe(true);
    expect(isTabExtractTextMessageRequest({ type: 'tab/extract-text-by-id' })).toBe(false);
    expect(isTabExtractTextMessageRequest({})).toBe(false);
    expect(isTabExtractTextMessageRequest(null)).toBe(false);
  });

  it('accepts valid success response payloads', () => {
    expect(
      isTabExtractTextMessageResponse({
        ok: true,
        payload: {
          markdown: '# Extracted',
          title: 'Example title',
          url: 'https://example.com',
        },
      }),
    ).toBe(true);
  });

  it('rejects malformed success response payloads', () => {
    expect(
      isTabExtractTextMessageResponse({
        ok: true,
        payload: {
          markdown: '# Extracted',
          title: 'Example title',
        },
      }),
    ).toBe(false);
    expect(
      isTabExtractTextMessageResponse({
        ok: true,
        payload: null,
      }),
    ).toBe(false);
  });

  it('accepts failure responses with string errors and rejects malformed failures', () => {
    expect(
      isTabExtractTextMessageResponse({
        ok: false,
        error: 'Failed to extract page text.',
      }),
    ).toBe(true);

    expect(
      isTabExtractTextMessageResponse({
        ok: false,
        error: { message: 'bad' },
      }),
    ).toBe(false);
  });

  it('rejects non-object values and missing ok flag', () => {
    expect(isTabExtractTextMessageResponse(undefined)).toBe(false);
    expect(isTabExtractTextMessageResponse('ok')).toBe(false);
    expect(
      isTabExtractTextMessageResponse({
        payload: { markdown: 'a', title: 'b', url: 'c' },
      }),
    ).toBe(false);
  });
});
