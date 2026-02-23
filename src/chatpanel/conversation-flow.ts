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
    'getStaged' | 'hasUploadingFiles' | 'hasFailedFiles' | 'getUploadedAttachments' | 'clearStage'
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
  handleMessageAction(action: MessageAction, message: ChatMessage): Promise<void>;
  switchAssistantBranch(interactionId: string): Promise<void>;
  applyStreamDelta(requestId: string, textDelta?: string, thinkingDelta?: string): void;
  dispose(): void;
}

export function createConversationFlowController(
  deps: ConversationFlowDeps,
): ConversationFlowController {
  const activeStreamDrafts = new Map<string, ActiveStreamDraft>();

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

    const userText = deps.composer.getText().trim();
    const stagedFiles = deps.attachmentManager.getStaged();
    if (!canSubmitMessage(userText, stagedFiles.length)) {
      return;
    }

    if (deps.attachmentManager.hasUploadingFiles()) {
      deps.appendLocalError('Please wait for file uploads to finish before sending.');
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

    let optimisticUserMessageId: string | undefined;
    let assistantPlaceholderId: string | undefined;
    let streamRequestId: string | undefined;
    deps.busyState.setBusy(true);

    try {
      const selectedModel = deps.toolbar.selectedModel();
      const selectedThinking = deps.toolbar.selectedThinkingLevel();
      streamRequestId = crypto.randomUUID();
      const optimisticUserMessage = buildOptimisticUserMessage(
        userText,
        stagedSnapshot,
        deps.interactions.getLastAssistantInteractionId(),
        attachmentsForSend,
      );
      deps.previews.rememberLocalAttachmentPreviews(optimisticUserMessage);
      optimisticUserMessageId = optimisticUserMessage.id;
      assistantPlaceholderId = crypto.randomUUID();
      deps.render.appendMessage(optimisticUserMessage);
      deps.render.appendMessage({
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '',
      });

      deps.composer.setText('');
      deps.attachmentManager.clearStage(true);
      deps.composer.resize();

      activeStreamDrafts.set(streamRequestId, {
        assistantMessageId: assistantPlaceholderId,
        text: '',
        thinkingSummary: '',
      });

      const assistantMessage = await deps.runtime.sendMessage(
        userText,
        selectedModel,
        selectedThinking,
        attachmentsForSend,
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
