import type { TabExtractTextPayload } from '../shared/runtime';
import {
  TAB_EXTRACT_TEXT_MESSAGE_TYPE,
  isTabExtractTextMessageResponse,
} from '../shared/tab-text-extraction-message';
import { toErrorMessage } from './utils';

interface ExtractTabTextByIdDependencies {
  sendMessage: typeof chrome.tabs.sendMessage;
}

export async function extractTabTextById(
  tabId: number,
  overrides: Partial<ExtractTabTextByIdDependencies> = {},
): Promise<TabExtractTextPayload> {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error('Tab text extraction requires a valid tab id.');
  }

  const sendMessage = overrides.sendMessage ?? chrome.tabs?.sendMessage?.bind(chrome.tabs);
  if (!sendMessage) {
    throw new Error('Chrome tabs API is unavailable.');
  }

  let response: unknown;
  try {
    response = await sendExtractTextRequest(tabId, sendMessage);
  } catch (error: unknown) {
    throw new Error(`Unable to extract tab text: ${toErrorMessage(error)}`);
  }

  if (!isTabExtractTextMessageResponse(response)) {
    throw new Error('Tab text extraction returned an invalid response payload.');
  }
  if (!response.ok) {
    throw new Error(response.error || 'Tab text extraction failed.');
  }
  return normalizeExtractedTextPayload(response.payload);
}

function sendExtractTextRequest(
  tabId: number,
  sendMessage: typeof chrome.tabs.sendMessage,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    sendMessage(tabId, { type: TAB_EXTRACT_TEXT_MESSAGE_TYPE }, (response?: unknown) => {
      const runtimeErrorMessage = chrome.runtime.lastError?.message?.trim();
      if (runtimeErrorMessage) {
        reject(new Error(runtimeErrorMessage));
        return;
      }

      resolve(response);
    });
  });
}

function normalizeExtractedTextPayload(payload: TabExtractTextPayload): TabExtractTextPayload {
  const markdown = payload.markdown.trim();
  if (!markdown) {
    throw new Error('Extracted tab text is empty.');
  }

  return {
    markdown,
    title: payload.title.trim(),
    url: payload.url.trim(),
  };
}
