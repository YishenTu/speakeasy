import type { ChatMessage } from '../shared/chat';
import type { FileDataAttachmentPayload } from '../shared/runtime';
import type { AttachmentManager } from './attachment-manager';
import { toErrorMessage } from './message-renderer';
import { buildOptimisticUserMessage } from './optimistic-message';

type ActiveStreamDraft = {
  assistantMessageId: string;
  text: string;
  thinkingSummary: string;
};

type QueuedSendDraft = {
  userText: string;
  optimisticUserMessageId: string;
  previousInteractionId: string | undefined;
};

type StagedAttachmentFile = ReturnType<AttachmentManager['getStaged']>[number];

type DispatchSendInput = {
  userText: string;
  stagedSnapshot: readonly StagedAttachmentFile[];
  attachmentsForSend: readonly FileDataAttachmentPayload[];
  previousInteractionId: string | undefined;
  optimisticUserMessageId?: string;
  shouldResetComposerText: boolean;
};

type MessageAction = 'regen' | 'fork';

type RuntimeDeps = {
  sendMessage: (
    userInput: string,
    model: string,
    thinkingLevel?: string,
    attachments?: FileDataAttachmentPayload[],
    streamRequestId?: string,
  ) => Promise<ChatMessage>;
  regenerateAssistantMessage: (
    previousInteractionId: string,
    model: string,
    thinkingLevel?: string,
    streamRequestId?: string,
  ) => Promise<ChatMessage>;
  forkChat: (previousInteractionId: string) => Promise<string>;
  switchAssistantBranch: (interactionId: string) => Promise<string>;
};

type ToolbarDeps = {
  selectedModel: () => string;
  selectedThinkingLevel: () => string;
};

type ComposerDeps = {
  getText: () => string;
  setText: (text: string) => void;
  resize: () => void;
  focus: () => void;
};

type HistoryDeps = {
  reloadActive: () => Promise<void>;
  setOpen: (open: boolean) => void;
};

type RenderDeps = {
  appendMessage: (message: ChatMessage) => void;
  replaceMessageById: (messageId: string, message: ChatMessage) => void;
  removeMessageById: (messageId: string) => void;
};

type BusyStateDeps = {
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
};

type InteractionDeps = {
  getLastAssistantInteractionId: () => string | undefined;
};

type PreviewDeps = {
  rememberLocalAttachmentPreviews: (message: ChatMessage) => void;
};

export interface ConversationFlowDeps {
  runtime: RuntimeDeps;
  attachmentManager: Pick<
    AttachmentManager,
    | 'getStaged'
    | 'setStagedPreviewsHidden'
    | 'hasUploadingFiles'
    | 'hasFailedFiles'
    | 'getUploadedAttachments'
    | 'clearStage'
  >;
  toolbar: ToolbarDeps;
  composer: ComposerDeps;
  history: HistoryDeps;
  render: RenderDeps;
  busyState: BusyStateDeps;
  interactions: InteractionDeps;
  previews: PreviewDeps;
  appendLocalError: (message: string) => void;
}

export interface ConversationFlowController {
  send(): Promise<void>;
  onAttachmentStateChange(): Promise<void>;
  handleMessageAction(action: MessageAction, message: ChatMessage): Promise<void>;
  switchAssistantBranch(interactionId: string): Promise<void>;
  applyStreamDelta(requestId: string, textDelta?: string, thinkingDelta?: string): void;
  dispose(): void;
}

export function createConversationFlowController(
  deps: ConversationFlowDeps,
): ConversationFlowController {
  const activeStreamDrafts = new Map<string, ActiveStreamDraft>();
  let queuedSendDraft: QueuedSendDraft | undefined;

  function applyStreamDelta(requestId: string, textDelta?: string, thinkingDelta?: string): void {
    const draft = activeStreamDrafts.get(requestId);
    if (!draft) {
      return;
    }

    if (textDelta) {
      draft.text += textDelta;
    }
    if (thinkingDelta) {
      draft.thinkingSummary += thinkingDelta;
    }

    const streamMessage: ChatMessage = {
      id: draft.assistantMessageId,
      role: 'assistant',
      content: draft.text,
    };
    if (draft.thinkingSummary) {
      streamMessage.thinkingSummary = draft.thinkingSummary;
    }
    deps.render.replaceMessageById(draft.assistantMessageId, streamMessage);
  }

  async function send(): Promise<void> {
    if (deps.busyState.isBusy()) {
      return;
    }

    if (queuedSendDraft) {
      await flushQueuedSendIfReady();
      return;
    }

    const userText = deps.composer.getText().trim();
    const stagedFiles = deps.attachmentManager.getStaged();
    if (!canSubmitMessage(userText, stagedFiles.length)) {
      return;
    }

    if (deps.attachmentManager.hasUploadingFiles()) {
      queueSend(userText, stagedFiles);
      return;
    }

    if (deps.attachmentManager.hasFailedFiles()) {
      deps.appendLocalError('Remove failed uploads before sending.');
      return;
    }

    const stagedSnapshot = [...stagedFiles];
    const attachmentsForSend = deps.attachmentManager.getUploadedAttachments();
    if (attachmentsForSend.length !== stagedSnapshot.length) {
      const notReady = stagedSnapshot.find((staged) => !staged.uploadedAttachment);
      if (notReady) {
        deps.appendLocalError(`"${notReady.name}" is not ready to send yet.`);
      }
      return;
    }

    await dispatchSend({
      userText,
      stagedSnapshot,
      attachmentsForSend,
      previousInteractionId: deps.interactions.getLastAssistantInteractionId(),
      shouldResetComposerText: true,
    });
  }

  function queueSend(userText: string, stagedFiles: readonly StagedAttachmentFile[]): void {
    const stagedSnapshot = [...stagedFiles];
    const previousInteractionId = deps.interactions.getLastAssistantInteractionId();
    const queuedMessage = buildOptimisticUserMessage(
      userText,
      stagedSnapshot,
      previousInteractionId,
    );
    deps.previews.rememberLocalAttachmentPreviews(queuedMessage);
    deps.render.appendMessage(queuedMessage);
    queuedSendDraft = {
      userText,
      optimisticUserMessageId: queuedMessage.id,
      previousInteractionId: queuedMessage.previousInteractionId,
    };
    deps.attachmentManager.setStagedPreviewsHidden(true);
    deps.composer.setText('');
    deps.composer.resize();
    deps.composer.focus();
  }

  async function flushQueuedSendIfReady(): Promise<void> {
    const queued = queuedSendDraft;
    if (!queued) {
      return;
    }

    if (deps.busyState.isBusy() || deps.attachmentManager.hasUploadingFiles()) {
      return;
    }

    if (deps.attachmentManager.hasFailedFiles()) {
      deps.attachmentManager.setStagedPreviewsHidden(false);
      deps.render.removeMessageById(queued.optimisticUserMessageId);
      if (!deps.composer.getText().trim() && queued.userText) {
        deps.composer.setText(queued.userText);
        deps.composer.resize();
      }
      queuedSendDraft = undefined;
      return;
    }

    const stagedSnapshot = [...deps.attachmentManager.getStaged()];
    if (!canSubmitMessage(queued.userText, stagedSnapshot.length)) {
      deps.attachmentManager.setStagedPreviewsHidden(false);
      deps.render.removeMessageById(queued.optimisticUserMessageId);
      queuedSendDraft = undefined;
      return;
    }

    const attachmentsForSend = deps.attachmentManager.getUploadedAttachments();
    if (attachmentsForSend.length !== stagedSnapshot.length) {
      const notReady = stagedSnapshot.find((staged) => !staged.uploadedAttachment);
      if (notReady) {
        deps.appendLocalError(`"${notReady.name}" is not ready to send yet.`);
      }
      return;
    }

    queuedSendDraft = undefined;
    await dispatchSend({
      userText: queued.userText,
      stagedSnapshot,
      attachmentsForSend,
      previousInteractionId: queued.previousInteractionId,
      optimisticUserMessageId: queued.optimisticUserMessageId,
      shouldResetComposerText: false,
    });
  }

  async function dispatchSend(input: DispatchSendInput): Promise<void> {
    let optimisticUserMessageId: string | undefined = input.optimisticUserMessageId;
    let assistantPlaceholderId: string | undefined;
    let streamRequestId: string | undefined;
    deps.busyState.setBusy(true);

    try {
      const selectedModel = deps.toolbar.selectedModel();
      const selectedThinking = deps.toolbar.selectedThinkingLevel();
      streamRequestId = crypto.randomUUID();
      const optimisticUserMessage = buildOptimisticUserMessage(
        input.userText,
        input.stagedSnapshot,
        input.previousInteractionId,
        input.attachmentsForSend,
      );
      deps.previews.rememberLocalAttachmentPreviews(optimisticUserMessage);
      if (optimisticUserMessageId) {
        deps.render.replaceMessageById(optimisticUserMessageId, {
          ...optimisticUserMessage,
          id: optimisticUserMessageId,
        });
      } else {
        optimisticUserMessageId = optimisticUserMessage.id;
        deps.render.appendMessage(optimisticUserMessage);
      }
      assistantPlaceholderId = crypto.randomUUID();
      deps.render.appendMessage({
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '',
      });

      if (input.shouldResetComposerText) {
        deps.composer.setText('');
      }
      deps.attachmentManager.clearStage(true);
      deps.composer.resize();

      activeStreamDrafts.set(streamRequestId, {
        assistantMessageId: assistantPlaceholderId,
        text: '',
        thinkingSummary: '',
      });

      const assistantMessage = await deps.runtime.sendMessage(
        input.userText,
        selectedModel,
        selectedThinking,
        [...input.attachmentsForSend],
        streamRequestId,
      );
      activeStreamDrafts.delete(streamRequestId);
      deps.render.replaceMessageById(assistantPlaceholderId, assistantMessage);
      await deps.history.reloadActive();
    } catch (error: unknown) {
      if (streamRequestId) {
        activeStreamDrafts.delete(streamRequestId);
      }
      if (assistantPlaceholderId) {
        deps.render.removeMessageById(assistantPlaceholderId);
      }
      if (optimisticUserMessageId) {
        deps.render.removeMessageById(optimisticUserMessageId);
      }
      deps.appendLocalError(toErrorMessage(error));
    } finally {
      deps.busyState.setBusy(false);
      deps.composer.focus();
    }
  }

  async function onAttachmentStateChange(): Promise<void> {
    await flushQueuedSendIfReady();
  }

  async function handleMessageAction(action: MessageAction, message: ChatMessage): Promise<void> {
    if (deps.busyState.isBusy()) {
      return;
    }

    const previousInteractionId = message.previousInteractionId?.trim();
    const interactionId = message.interactionId?.trim();
    let regenPlaceholderMessageId: string | undefined;
    let regenStreamRequestId: string | undefined;

    deps.busyState.setBusy(true);
    try {
      if (action === 'fork') {
        if (message.role !== 'user' || !previousInteractionId) {
          return;
        }
        await deps.runtime.forkChat(previousInteractionId);
        deps.attachmentManager.clearStage(true);
        deps.composer.setText(message.content);
        deps.composer.resize();
      } else {
        if (message.role !== 'assistant' || !interactionId) {
          return;
        }
        const selectedModel = deps.toolbar.selectedModel();
        const selectedThinking = deps.toolbar.selectedThinkingLevel();
        regenPlaceholderMessageId = message.id;
        deps.render.replaceMessageById(regenPlaceholderMessageId, {
          id: regenPlaceholderMessageId,
          role: 'assistant',
          content: '',
        });

        regenStreamRequestId = crypto.randomUUID();
        activeStreamDrafts.set(regenStreamRequestId, {
          assistantMessageId: regenPlaceholderMessageId,
          text: '',
          thinkingSummary: '',
        });

        const assistantMessage = await deps.runtime.regenerateAssistantMessage(
          interactionId,
          selectedModel,
          selectedThinking,
          regenStreamRequestId,
        );
        activeStreamDrafts.delete(regenStreamRequestId);
        regenStreamRequestId = undefined;
        deps.render.replaceMessageById(regenPlaceholderMessageId, assistantMessage);
        regenPlaceholderMessageId = undefined;
      }

      await deps.history.reloadActive();
      deps.history.setOpen(false);
      deps.composer.focus();
    } catch (error: unknown) {
      if (regenStreamRequestId) {
        activeStreamDrafts.delete(regenStreamRequestId);
      }
      if (regenPlaceholderMessageId) {
        deps.render.replaceMessageById(regenPlaceholderMessageId, message);
      }
      deps.appendLocalError(toErrorMessage(error));
    } finally {
      deps.busyState.setBusy(false);
    }
  }

  async function switchAssistantBranch(interactionId: string): Promise<void> {
    if (deps.busyState.isBusy()) {
      return;
    }

    const normalizedInteractionId = interactionId.trim();
    if (!normalizedInteractionId) {
      return;
    }

    deps.busyState.setBusy(true);
    try {
      await deps.runtime.switchAssistantBranch(normalizedInteractionId);
      await deps.history.reloadActive();
      deps.history.setOpen(false);
      deps.composer.focus();
    } catch (error: unknown) {
      deps.appendLocalError(toErrorMessage(error));
    } finally {
      deps.busyState.setBusy(false);
    }
  }

  return {
    send,
    onAttachmentStateChange,
    handleMessageAction,
    switchAssistantBranch,
    applyStreamDelta,
    dispose(): void {
      activeStreamDrafts.clear();
    },
  };
}

export function canSubmitMessage(userText: string, stagedFileCount: number): boolean {
  return userText.length > 0 || stagedFileCount > 0;
}
