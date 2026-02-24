import { describe, expect, test } from 'bun:test';
import type { StagedFile } from '../../../../../src/chatpanel/features/attachments/attachment-manager';
import { createConversationFlowController } from '../../../../../src/chatpanel/features/conversation/conversation-flow';
import type { ChatMessage } from '../../../../../src/shared/chat';
import type { FileDataAttachmentPayload } from '../../../../../src/shared/runtime';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type HarnessOptions = {
  composerText?: string;
  stagedFiles?: StagedFile[];
  uploadedAttachments?: FileDataAttachmentPayload[];
  sendImpl?: (
    userInput: string,
    model: string,
    thinkingLevel?: string,
    attachments?: FileDataAttachmentPayload[],
    streamRequestId?: string,
  ) => Promise<ChatMessage>;
  regenerateImpl?: (
    previousInteractionId: string,
    model: string,
    thinkingLevel?: string,
    streamRequestId?: string,
  ) => Promise<ChatMessage>;
  forkImpl?: (previousInteractionId: string) => Promise<string>;
  switchImpl?: (interactionId: string) => Promise<string>;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  if (!resolve || !reject) {
    throw new Error('Failed to initialize deferred promise.');
  }

  return { promise, resolve, reject };
}

function createHarness(options: HarnessOptions = {}) {
  let composerText = options.composerText ?? '';
  let stagedFiles = options.stagedFiles ?? [];
  let uploadedAttachments = options.uploadedAttachments ?? [];
  let busy = false;

  const appendCalls: ChatMessage[] = [];
  const replaceCalls: Array<{ messageId: string; message: ChatMessage }> = [];
  const removeCalls: string[] = [];
  const localErrors: string[] = [];
  const busyTransitions: boolean[] = [];
  const setComposerTextCalls: string[] = [];
  const clearStageCalls: boolean[] = [];
  const setStagedPreviewsHiddenCalls: boolean[] = [];
  const sendCalls: Array<{
    userInput: string;
    model: string;
    thinkingLevel?: string;
    attachments?: FileDataAttachmentPayload[];
    streamRequestId?: string;
  }> = [];
  const regenerateCalls: Array<{
    previousInteractionId: string;
    model: string;
    thinkingLevel?: string;
    streamRequestId?: string;
  }> = [];
  const forkCalls: string[] = [];
  const switchCalls: string[] = [];
  const historySetOpenCalls: boolean[] = [];
  const rememberedPreviewMessages: ChatMessage[] = [];
  let historyReloadCount = 0;
  let composerFocusCount = 0;
  let composerResizeCount = 0;

  const flow = createConversationFlowController({
    runtime: {
      sendMessage: async (userInput, model, thinkingLevel, attachments, streamRequestId) => {
        sendCalls.push({ userInput, model, thinkingLevel, attachments, streamRequestId });
        if (options.sendImpl) {
          return options.sendImpl(userInput, model, thinkingLevel, attachments, streamRequestId);
        }
        return {
          id: 'assistant-final',
          role: 'assistant',
          content: 'Final answer',
          interactionId: 'interaction-final',
        };
      },
      regenerateAssistantMessage: async (previousInteractionId, model, thinkingLevel, streamId) => {
        regenerateCalls.push({
          previousInteractionId,
          model,
          thinkingLevel,
          streamRequestId: streamId,
        });
        if (options.regenerateImpl) {
          return options.regenerateImpl(previousInteractionId, model, thinkingLevel, streamId);
        }
        return {
          id: 'assistant-regen',
          role: 'assistant',
          content: 'Regenerated answer',
          interactionId: 'interaction-regen',
        };
      },
      forkChat: async (previousInteractionId) => {
        forkCalls.push(previousInteractionId);
        if (options.forkImpl) {
          return options.forkImpl(previousInteractionId);
        }
        return 'forked-chat-id';
      },
      switchAssistantBranch: async (interactionId) => {
        switchCalls.push(interactionId);
        if (options.switchImpl) {
          return options.switchImpl(interactionId);
        }
        return 'switched-chat-id';
      },
    },
    attachmentManager: {
      getStaged: () => stagedFiles,
      setStagedPreviewsHidden: (hidden) => {
        setStagedPreviewsHiddenCalls.push(hidden);
      },
      hasUploadingFiles: () => stagedFiles.some((staged) => staged.uploadState === 'uploading'),
      hasFailedFiles: () => stagedFiles.some((staged) => staged.uploadState === 'failed'),
      getUploadedAttachments: () => uploadedAttachments,
      clearStage: (revokePreviews) => {
        clearStageCalls.push(revokePreviews);
        stagedFiles = [];
      },
    },
    toolbar: {
      selectedModel: () => 'gemini-3-flash-preview',
      selectedThinkingLevel: () => 'minimal',
    },
    composer: {
      getText: () => composerText,
      setText: (text) => {
        setComposerTextCalls.push(text);
        composerText = text;
      },
      resize: () => {
        composerResizeCount += 1;
      },
      focus: () => {
        composerFocusCount += 1;
      },
    },
    history: {
      reloadActive: async () => {
        historyReloadCount += 1;
      },
      setOpen: (open) => {
        historySetOpenCalls.push(open);
      },
    },
    render: {
      appendMessage: (message) => {
        appendCalls.push(message);
      },
      replaceMessageById: (messageId, message) => {
        replaceCalls.push({ messageId, message });
      },
      removeMessageById: (messageId) => {
        removeCalls.push(messageId);
      },
    },
    busyState: {
      isBusy: () => busy,
      setBusy: (nextBusy) => {
        busyTransitions.push(nextBusy);
        busy = nextBusy;
      },
    },
    interactions: {
      getLastAssistantInteractionId: () => 'last-assistant-interaction',
    },
    previews: {
      rememberLocalAttachmentPreviews: (message) => {
        rememberedPreviewMessages.push(message);
      },
    },
    appendLocalError: (message) => {
      localErrors.push(message);
    },
  });

  return {
    flow,
    appendCalls,
    replaceCalls,
    removeCalls,
    localErrors,
    busyTransitions,
    setComposerTextCalls,
    clearStageCalls,
    setStagedPreviewsHiddenCalls,
    sendCalls,
    regenerateCalls,
    forkCalls,
    switchCalls,
    historySetOpenCalls,
    rememberedPreviewMessages,
    setStagedFiles: (nextStagedFiles: StagedFile[]) => {
      stagedFiles = nextStagedFiles;
    },
    setUploadedAttachments: (nextUploadedAttachments: FileDataAttachmentPayload[]) => {
      uploadedAttachments = nextUploadedAttachments;
    },
    getHistoryReloadCount: () => historyReloadCount,
    getComposerFocusCount: () => composerFocusCount,
    getComposerResizeCount: () => composerResizeCount,
  };
}

function createStagedFile(
  id: string,
  uploadState: 'uploading' | 'uploaded' | 'failed',
): StagedFile {
  return {
    id,
    file: new File(['payload'], `${id}.txt`, { type: 'text/plain' }),
    name: `${id}.txt`,
    mimeType: 'text/plain',
    uploadState,
  };
}

describe('conversation flow controller', () => {
  test('send flow appends optimistic rows, resolves assistant response, and refreshes history', async () => {
    const harness = createHarness({
      composerText: 'Hello world',
    });

    await harness.flow.send();

    expect(harness.sendCalls).toHaveLength(1);
    expect(harness.sendCalls[0]?.userInput).toBe('Hello world');
    expect(harness.sendCalls[0]?.model).toBe('gemini-3-flash-preview');
    expect(harness.sendCalls[0]?.thinkingLevel).toBe('minimal');
    expect(typeof harness.sendCalls[0]?.streamRequestId).toBe('string');
    expect(harness.sendCalls[0]?.streamRequestId?.length).toBeGreaterThan(0);
    expect(harness.appendCalls).toHaveLength(2);
    expect(harness.appendCalls[0]?.role).toBe('user');
    expect(harness.appendCalls[0]?.content).toBe('Hello world');
    expect(harness.appendCalls[1]?.role).toBe('assistant');
    expect(harness.appendCalls[1]?.content).toBe('');
    expect(harness.rememberedPreviewMessages).toHaveLength(1);
    expect(harness.clearStageCalls).toEqual([true]);
    expect(harness.replaceCalls).toHaveLength(1);
    expect(harness.replaceCalls[0]?.message).toEqual({
      id: 'assistant-final',
      role: 'assistant',
      content: 'Final answer',
      interactionId: 'interaction-final',
    });
    expect(harness.removeCalls).toHaveLength(0);
    expect(harness.localErrors).toEqual([]);
    expect(harness.busyTransitions).toEqual([true, false]);
    expect(harness.setComposerTextCalls).toEqual(['']);
    expect(harness.getComposerResizeCount()).toBe(1);
    expect(harness.getComposerFocusCount()).toBe(1);
    expect(harness.getHistoryReloadCount()).toBe(1);
  });

  test('send flow queues while staged uploads are still in progress without surfacing warnings', async () => {
    const harness = createHarness({
      composerText: 'Upload pending',
      stagedFiles: [createStagedFile('pending', 'uploading')],
    });

    await harness.flow.send();

    expect(harness.sendCalls).toHaveLength(0);
    expect(harness.localErrors).toEqual([]);
    expect(harness.busyTransitions).toEqual([]);
    expect(harness.appendCalls).toHaveLength(1);
    expect(harness.appendCalls[0]?.role).toBe('user');
    expect(harness.appendCalls[0]?.content).toBe('Upload pending');
    expect(harness.setComposerTextCalls).toEqual(['']);
    expect(harness.getComposerResizeCount()).toBe(1);
    expect(harness.getComposerFocusCount()).toBe(1);
    expect(harness.setStagedPreviewsHiddenCalls).toEqual([true]);
  });

  test('send flow dispatches queued submission once uploads finish', async () => {
    const uploadedAttachment: FileDataAttachmentPayload = {
      name: 'pending.txt',
      mimeType: 'text/plain',
      fileUri: 'https://example.invalid/files/pending',
    };
    const harness = createHarness({
      composerText: 'Upload pending',
      stagedFiles: [createStagedFile('pending', 'uploading')],
    });

    await harness.flow.send();
    expect(harness.sendCalls).toHaveLength(0);
    const queuedMessageId = harness.appendCalls[0]?.id;
    expect(queuedMessageId).toBeTruthy();

    harness.setStagedFiles([
      {
        ...createStagedFile('pending', 'uploaded'),
        uploadedAttachment,
      },
    ]);
    harness.setUploadedAttachments([uploadedAttachment]);

    await harness.flow.onAttachmentStateChange();

    expect(harness.sendCalls).toHaveLength(1);
    expect(harness.sendCalls[0]?.userInput).toBe('Upload pending');
    expect(harness.sendCalls[0]?.attachments).toEqual([uploadedAttachment]);
    expect(harness.appendCalls).toHaveLength(2);
    expect(harness.appendCalls[1]?.role).toBe('assistant');
    expect(harness.replaceCalls).toHaveLength(2);
    expect(harness.replaceCalls[0]?.messageId).toBe(queuedMessageId);
    expect(harness.clearStageCalls).toEqual([true]);
    expect(harness.setComposerTextCalls).toEqual(['']);
    expect(harness.setStagedPreviewsHiddenCalls).toEqual([true]);
    expect(harness.localErrors).toEqual([]);
  });

  test('queued send restores composer when an upload fails before dispatch', async () => {
    const harness = createHarness({
      composerText: 'Upload pending',
      stagedFiles: [createStagedFile('pending', 'uploading')],
    });

    await harness.flow.send();
    const queuedMessageId = harness.appendCalls[0]?.id;
    expect(queuedMessageId).toBeTruthy();

    harness.setStagedFiles([createStagedFile('pending', 'failed')]);
    await harness.flow.onAttachmentStateChange();

    expect(harness.sendCalls).toHaveLength(0);
    expect(harness.removeCalls).toEqual([queuedMessageId as string]);
    expect(harness.setComposerTextCalls).toEqual(['', 'Upload pending']);
    expect(harness.setStagedPreviewsHiddenCalls).toEqual([true, false]);
  });

  test('cancelQueuedSend removes queued optimistic message and restores local draft state', async () => {
    const harness = createHarness({
      composerText: 'Upload pending',
      stagedFiles: [createStagedFile('pending', 'uploading')],
    });

    await harness.flow.send();
    const queuedMessageId = harness.appendCalls[0]?.id;
    expect(queuedMessageId).toBeTruthy();

    harness.flow.cancelQueuedSend();

    expect(harness.sendCalls).toHaveLength(0);
    expect(harness.removeCalls).toEqual([queuedMessageId as string]);
    expect(harness.setComposerTextCalls).toEqual(['', 'Upload pending']);
    expect(harness.setStagedPreviewsHiddenCalls).toEqual([true, false]);
    expect(harness.getComposerResizeCount()).toBe(2);
  });

  test('regen action cancels queued send draft before running regeneration', async () => {
    const harness = createHarness({
      composerText: 'Upload pending',
      stagedFiles: [createStagedFile('pending', 'uploading')],
    });

    await harness.flow.send();
    const queuedMessageId = harness.appendCalls[0]?.id;
    expect(queuedMessageId).toBeTruthy();

    await harness.flow.handleMessageAction('regen', {
      id: 'assistant-target',
      role: 'assistant',
      content: 'Existing answer',
      interactionId: 'assistant-interaction',
    });

    expect(harness.regenerateCalls).toHaveLength(1);
    expect(harness.removeCalls).toEqual([queuedMessageId as string]);
    expect(harness.setComposerTextCalls).toEqual(['', 'Upload pending']);
    expect(harness.setStagedPreviewsHiddenCalls).toEqual([true, false]);
  });

  test('switch branch cancels queued send draft before switching', async () => {
    const harness = createHarness({
      composerText: 'Upload pending',
      stagedFiles: [createStagedFile('pending', 'uploading')],
    });

    await harness.flow.send();
    const queuedMessageId = harness.appendCalls[0]?.id;
    expect(queuedMessageId).toBeTruthy();

    await harness.flow.switchAssistantBranch(' interaction-id ');

    expect(harness.switchCalls).toEqual(['interaction-id']);
    expect(harness.removeCalls).toEqual([queuedMessageId as string]);
    expect(harness.setComposerTextCalls).toEqual(['', 'Upload pending']);
    expect(harness.setStagedPreviewsHiddenCalls).toEqual([true, false]);
  });

  test('stream deltas patch the assistant placeholder before final assistant reconciliation', async () => {
    const deferredSend = createDeferred<ChatMessage>();
    const harness = createHarness({
      composerText: 'Stream this',
      sendImpl: () => deferredSend.promise,
    });

    const sendPromise = harness.flow.send();
    const streamRequestId = harness.sendCalls[0]?.streamRequestId;
    expect(typeof streamRequestId).toBe('string');
    expect(streamRequestId?.length).toBeGreaterThan(0);

    if (!streamRequestId) {
      throw new Error('Missing stream request id for send call.');
    }

    harness.flow.applyStreamDelta(streamRequestId, 'delta text', 'delta thoughts');
    expect(harness.replaceCalls).toHaveLength(1);
    expect(harness.replaceCalls[0]?.message.content).toBe('delta text');
    expect(harness.replaceCalls[0]?.message.thinkingSummary).toBe('delta thoughts');

    deferredSend.resolve({
      id: 'assistant-stream-final',
      role: 'assistant',
      content: 'Final streamed answer',
      interactionId: 'interaction-stream-final',
    });
    await sendPromise;

    expect(harness.replaceCalls).toHaveLength(2);
    expect(harness.replaceCalls[1]?.message).toEqual({
      id: 'assistant-stream-final',
      role: 'assistant',
      content: 'Final streamed answer',
      interactionId: 'interaction-stream-final',
    });
  });

  test('regen failures restore the original assistant message and surface an error', async () => {
    const harness = createHarness({
      regenerateImpl: async () => {
        throw new Error('regen failed');
      },
    });
    const targetMessage: ChatMessage = {
      id: 'assistant-target',
      role: 'assistant',
      content: 'Original assistant response',
      interactionId: 'interaction-target',
    };

    await harness.flow.handleMessageAction('regen', targetMessage);

    expect(harness.regenerateCalls).toHaveLength(1);
    expect(harness.regenerateCalls[0]?.previousInteractionId).toBe('interaction-target');
    expect(harness.regenerateCalls[0]?.streamRequestId).toBeTruthy();
    expect(harness.replaceCalls).toHaveLength(2);
    expect(harness.replaceCalls[0]?.messageId).toBe('assistant-target');
    expect(harness.replaceCalls[0]?.message.content).toBe('');
    expect(harness.replaceCalls[1]?.message).toEqual(targetMessage);
    expect(harness.localErrors).toEqual(['regen failed']);
    expect(harness.busyTransitions).toEqual([true, false]);
  });

  test('fork action stages message content into the composer and refreshes history', async () => {
    const harness = createHarness();
    const sourceMessage: ChatMessage = {
      id: 'user-source',
      role: 'user',
      content: 'Branch from this prompt',
      previousInteractionId: 'previous-interaction-id',
    };

    await harness.flow.handleMessageAction('fork', sourceMessage);

    expect(harness.forkCalls).toEqual(['previous-interaction-id']);
    expect(harness.clearStageCalls).toEqual([true]);
    expect(harness.setComposerTextCalls).toEqual(['Branch from this prompt']);
    expect(harness.getComposerResizeCount()).toBe(1);
    expect(harness.historySetOpenCalls).toEqual([false]);
    expect(harness.getComposerFocusCount()).toBe(1);
    expect(harness.getHistoryReloadCount()).toBe(1);
    expect(harness.localErrors).toEqual([]);
    expect(harness.busyTransitions).toEqual([true, false]);
  });

  test('switch branch ignores blank ids and refreshes for valid ids', async () => {
    const harness = createHarness();

    await harness.flow.switchAssistantBranch('   ');
    expect(harness.switchCalls).toHaveLength(0);
    expect(harness.busyTransitions).toEqual([]);

    await harness.flow.switchAssistantBranch(' interaction-id ');
    expect(harness.switchCalls).toEqual(['interaction-id']);
    expect(harness.getHistoryReloadCount()).toBe(1);
    expect(harness.historySetOpenCalls).toEqual([false]);
    expect(harness.getComposerFocusCount()).toBe(1);
    expect(harness.busyTransitions).toEqual([true, false]);
  });
});
