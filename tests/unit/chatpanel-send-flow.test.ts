import { describe, expect, it } from 'bun:test';
import { sendChatTurnWithOptimisticUserMessage } from '../../src/chatpanel/send-flow';
import type { ChatMessage } from '../../src/shared/chat';
import type { FileDataAttachmentPayload } from '../../src/shared/runtime';

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve: (value: T) => {
      if (!resolve) {
        throw new Error('Deferred promise resolve handler is unavailable.');
      }
      resolve(value);
    },
    reject: (reason?: unknown) => {
      if (!reject) {
        throw new Error('Deferred promise reject handler is unavailable.');
      }
      reject(reason);
    },
  };
}

describe('chatpanel send flow', () => {
  it('appends the user message before waiting for assistant completion', async () => {
    const assistantDeferred = createDeferred<ChatMessage>();
    const appendedMessages: ChatMessage[] = [];
    const optimisticCommitCalls: number[] = [];
    const sendMessageCalls: {
      text: string;
      model: string;
      thinkingLevel: string | undefined;
      attachments: FileDataAttachmentPayload[] | undefined;
    }[] = [];

    const submitPromise = sendChatTurnWithOptimisticUserMessage(
      {
        text: 'Hello world',
        stagedFiles: [],
        model: 'gemini-2.5-pro',
        thinkingLevel: 'high',
      },
      {
        appendMessage: (message) => {
          appendedMessages.push(message);
        },
        onUserMessageAppended: () => {
          optimisticCommitCalls.push(Date.now());
        },
        createMessageId: () => 'user-1',
        createObjectUrl: () => {
          throw new Error('No attachments expected in this test.');
        },
        uploadFiles: async () => [],
        sendMessage: async (text, model, thinkingLevel, attachments) => {
          sendMessageCalls.push({
            text,
            model,
            thinkingLevel,
            attachments,
          });
          return assistantDeferred.promise;
        },
      },
    );

    expect(appendedMessages).toEqual([
      {
        id: 'user-1',
        role: 'user',
        content: 'Hello world',
      },
    ]);
    expect(optimisticCommitCalls).toHaveLength(1);
    let isSettled = false;
    void submitPromise.finally(() => {
      isSettled = true;
    });
    await Promise.resolve();
    expect(isSettled).toBe(false);

    assistantDeferred.resolve({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hi there',
    });

    await expect(submitPromise).resolves.toEqual({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hi there',
    });
    expect(sendMessageCalls).toEqual([
      {
        text: 'Hello world',
        model: 'gemini-2.5-pro',
        thinkingLevel: 'high',
        attachments: [],
      },
    ]);
  });
});
