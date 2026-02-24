import type { ChatStreamDeltaEvent } from '../../../shared/runtime';
import type { GeminiStreamDelta } from '../gemini/gemini';

export function createStreamDeltaEmitter(
  streamRequestId: string | undefined,
  sender: chrome.runtime.MessageSender | undefined,
): ((delta: GeminiStreamDelta) => void) | undefined {
  const requestId = typeof streamRequestId === 'string' ? streamRequestId.trim() : '';
  if (!requestId) {
    return undefined;
  }

  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') {
    return undefined;
  }

  const sendOptions = typeof sender?.frameId === 'number' ? { frameId: sender.frameId } : undefined;
  const swallowDisconnect = () => {
    void chrome.runtime.lastError;
  };

  return (delta: GeminiStreamDelta) => {
    if (!delta.textDelta && !delta.thinkingDelta) {
      return;
    }

    const payload: ChatStreamDeltaEvent = {
      type: 'chat/stream-delta',
      requestId,
    };
    if (delta.textDelta) {
      payload.textDelta = delta.textDelta;
    }
    if (delta.thinkingDelta) {
      payload.thinkingDelta = delta.thinkingDelta;
    }

    try {
      if (sendOptions) {
        chrome.tabs.sendMessage(tabId, payload, sendOptions, swallowDisconnect);
      } else {
        chrome.tabs.sendMessage(tabId, payload, swallowDisconnect);
      }
    } catch (error: unknown) {
      console.warn('Failed to forward stream delta to the chat panel tab.', error);
    }
  };
}
