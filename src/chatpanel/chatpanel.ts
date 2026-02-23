import {
  type ChatMessage,
  type ChatTabContext,
  captureTabFullPageScreenshotById,
  createNewChat,
  forkChat,
  listOpenTabsForMention,
  loadChatMessages,
  regenerateAssistantMessage,
  resolveChatTabContext,
  sendMessage,
  switchAssistantBranch,
} from '../shared/chat';
import { requestOpenOptionsPage } from '../shared/runtime-client';
import { isRecord } from '../shared/utils';
import {
  createAttachmentManager,
  extractFilesFromDataTransfer,
  hasFileDataTransfer,
} from './attachment-manager';
import { canSubmitMessage, createConversationFlowController } from './conversation-flow';
import { createDeleteSessionConfirmation } from './delete-confirmation';
import { queryRequiredElement } from './dom';
import { captureAndStageFullPageScreenshot, toScreenshotFile } from './full-page-screenshot';
import { createHistoryDropdownController } from './history-dropdown';
import { createInputToolbar } from './input-toolbar';
import { isImageMimeType } from './media-helpers';
import {
  type MessageRenderOptions,
  appendMessage,
  removeMessageById,
  renderAll,
  replaceMessageById,
  toErrorMessage,
} from './message-renderer';
import { findLatestAssistantInteractionId } from './optimistic-message';
import { createPanelLayoutController } from './panel-layout';
import {
  type MentionTokenRange,
  type MentionableTab,
  createTabMentionController,
  removeMentionTokenFromInputText,
} from './tab-mention';
import { getChatPanelTemplate } from './template';

const ROOT_HOST_ID = 'speakeasy-overlay-root';
const INPUT_MAX_PANEL_HEIGHT_RATIO = 1 / 3;

if (window.top === window) {
  mountChatPanel();
}

function mountChatPanel(): void {
  if (document.getElementById(ROOT_HOST_ID)) {
    return;
  }

  const host = document.createElement('div');
  host.id = ROOT_HOST_ID;
  document.documentElement.append(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = getChatPanelTemplate();

  const shell = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-shell');
  const dragHandle = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-drag-handle');
  const resizeHandles = Array.from(shadowRoot.querySelectorAll<HTMLElement>('[data-resize]'));
  const closeButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-close');
  const settingsButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-settings');
  const newChatButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-new-chat');
  const historyControl = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-history-control',
  );
  const historyToggleButton = queryRequiredElement<HTMLButtonElement>(
    shadowRoot,
    '#speakeasy-history-toggle',
  );
  const historyMenu = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-history-menu');
  const form = queryRequiredElement<HTMLFormElement>(shadowRoot, '#speakeasy-form');
  const input = queryRequiredElement<HTMLTextAreaElement>(shadowRoot, '#speakeasy-input');
  const fileInput = queryRequiredElement<HTMLInputElement>(shadowRoot, '#speakeasy-file-input');
  const filePreviews = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-file-previews');
  const tabMentionMenu = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-tab-mention-menu',
  );
  const tabMentionList = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-tab-mention-list',
  );
  const tabMentionEmpty = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-tab-mention-empty',
  );
  const messageList = queryRequiredElement<HTMLOListElement>(shadowRoot, '#speakeasy-messages');
  const imagePreviewView = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-image-preview-view',
  );
  const imagePreviewElement = queryRequiredElement<HTMLImageElement>(
    shadowRoot,
    '#speakeasy-image-preview-image',
  );
  const imagePreviewCloseButton = queryRequiredElement<HTMLButtonElement>(
    shadowRoot,
    '#speakeasy-image-preview-close',
  );
  const toolbar = createInputToolbar(shadowRoot);
  const deleteSessionConfirmation = createDeleteSessionConfirmation(shadowRoot);
  if (resizeHandles.length === 0) {
    throw new Error('Missing resize zones in chat panel template.');
  }

  const parseCssPixels = (value: string, fallbackValue: number): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  };

  const getComposerInputMinimumHeight = (): number => {
    const computed = window.getComputedStyle(input);
    const declaredRows = Number.parseInt(input.getAttribute('rows') ?? '1', 10);
    const rows = Number.isFinite(declaredRows) && declaredRows > 0 ? declaredRows : 1;
    const fontSize = parseCssPixels(computed.fontSize, 13);
    const lineHeight = parseCssPixels(computed.lineHeight, fontSize * 1.4);
    const verticalPadding =
      parseCssPixels(computed.paddingTop, 0) + parseCssPixels(computed.paddingBottom, 0);
    const verticalBorder =
      parseCssPixels(computed.borderTopWidth, 0) + parseCssPixels(computed.borderBottomWidth, 0);

    return Math.max(1, Math.ceil(rows * lineHeight + verticalPadding + verticalBorder));
  };

  const resizeComposerInput = (): void => {
    const minInputHeight = getComposerInputMinimumHeight();
    const panelHeight = shell.clientHeight || layoutController.getLayout().height;
    const maxInputHeight = Math.max(
      minInputHeight,
      Math.floor(panelHeight * INPUT_MAX_PANEL_HEIGHT_RATIO),
    );
    input.style.minHeight = `${minInputHeight}px`;
    input.style.maxHeight = `${maxInputHeight}px`;
    input.style.height = 'auto';
    const nextHeight = Math.max(input.scrollHeight, minInputHeight);
    input.style.height = `${Math.min(nextHeight, maxInputHeight)}px`;
  };

  const layoutController = createPanelLayoutController({
    shell,
    dragHandle,
    resizeHandles,
    onLayoutApplied: resizeComposerInput,
  });
  layoutController.clampAndSync();

  input.addEventListener('input', () => {
    resizeComposerInput();
    tabMentionController.onInputOrCaretChange();
  });
  input.addEventListener('click', () => {
    tabMentionController.onInputOrCaretChange();
  });
  input.addEventListener('keyup', () => {
    tabMentionController.onInputOrCaretChange();
  });

  let isPanelOpen = false;
  let isBusy = false;
  let isCapturingFullPageScreenshot = false;
  let isCapturingMentionScreenshot = false;
  let isImagePreviewOpen = false;
  let dragEnterDepth = 0;
  let activeChatId: string | null = null;
  const chatTabContext: ChatTabContext = {};
  let hasResolvedChatTabContext = false;
  let lastAssistantInteractionId: string | undefined;
  const localAttachmentPreviewUrls = new Map<string, string>();
  let conversationFlow: ReturnType<typeof createConversationFlowController> | null = null;
  const messageRenderOptions: MessageRenderOptions = {
    onAssistantAction: (action, message) => {
      if (!conversationFlow) {
        return;
      }
      void conversationFlow.handleMessageAction(action, message);
    },
    onAssistantBranchSelect: (_message, interactionId) => {
      if (!conversationFlow) {
        return;
      }
      void conversationFlow.switchAssistantBranch(interactionId);
    },
    onUserAction: (action, message) => {
      if (!conversationFlow) {
        return;
      }
      void conversationFlow.handleMessageAction(action, message);
    },
  };

  const attachmentManager = createAttachmentManager({
    filePreviews,
    localAttachmentPreviewUrls,
    onResizeComposer: resizeComposerInput,
    onError: appendLocalError,
    onStagedFilesChanged: () => {
      if (!conversationFlow) {
        return;
      }

      void conversationFlow.onAttachmentStateChange();
    },
  });

  const tabMentionController = createTabMentionController({
    input,
    menu: tabMentionMenu,
    list: tabMentionList,
    emptyState: tabMentionEmpty,
    onSelectTab: captureMentionTabScreenshot,
    listTabs: async () => {
      const payload = await listOpenTabsForMention();
      return payload.tabs.map((tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        hostname: tab.hostname,
      }));
    },
    onError: appendLocalError,
    isBusy: () => isBusy || isCapturingFullPageScreenshot || isCapturingMentionScreenshot,
  });

  async function ensureChatTabContext(): Promise<ChatTabContext> {
    if (hasResolvedChatTabContext) {
      return chatTabContext;
    }

    const resolved = await resolveChatTabContext();
    if (
      typeof resolved.tabId === 'number' &&
      Number.isInteger(resolved.tabId) &&
      resolved.tabId > 0
    ) {
      chatTabContext.tabId = resolved.tabId;
    } else {
      chatTabContext.tabId = null;
    }
    hasResolvedChatTabContext = true;
    return chatTabContext;
  }

  const historyDropdown = createHistoryDropdownController({
    historyControl,
    historyToggleButton,
    historyMenu,
    deleteSessionConfirmation,
    isBusy: () => isBusy,
    setBusy: (busy) => setBusyState(busy),
    getChatTabContext: ensureChatTabContext,
    getActiveChatId: () => activeChatId,
    setActiveChatId: (id) => {
      activeChatId = id;
    },
    clearStagedFiles: () => attachmentManager.clearStage(true),
    cancelQueuedSend: () => {
      conversationFlow?.cancelQueuedSend();
    },
    renderMessages,
    appendLocalError,
    focusInput: () => input.focus(),
  });

  conversationFlow = createConversationFlowController({
    runtime: {
      sendMessage: async (userInput, model, thinkingLevel, attachments, streamRequestId) =>
        sendMessage(
          userInput,
          model,
          thinkingLevel,
          attachments,
          streamRequestId,
          await ensureChatTabContext(),
        ),
      regenerateAssistantMessage: async (
        previousInteractionId,
        model,
        thinkingLevel,
        streamRequestId,
      ) =>
        regenerateAssistantMessage(
          previousInteractionId,
          model,
          thinkingLevel,
          streamRequestId,
          await ensureChatTabContext(),
        ),
      forkChat: async (previousInteractionId) =>
        forkChat(previousInteractionId, await ensureChatTabContext()),
      switchAssistantBranch: async (interactionId) =>
        switchAssistantBranch(interactionId, await ensureChatTabContext()),
    },
    attachmentManager,
    toolbar,
    composer: {
      getText: () => input.value,
      setText: (text) => {
        input.value = text;
      },
      resize: resizeComposerInput,
      focus: () => input.focus(),
    },
    history: {
      reloadActive: () => historyDropdown.reloadActive(),
      setOpen: (open) => historyDropdown.setOpen(open),
    },
    render: {
      appendMessage: (message) => {
        appendMessage(message, messageList, messageRenderOptions);
      },
      replaceMessageById: (messageId, message) => {
        replaceMessageById(messageId, message, messageList, messageRenderOptions);
      },
      removeMessageById: (messageId) => {
        removeMessageById(messageId, messageList);
      },
    },
    busyState: {
      isBusy: () => isBusy,
      setBusy: (busy) => setBusyState(busy),
    },
    interactions: {
      getLastAssistantInteractionId: () => lastAssistantInteractionId,
    },
    previews: {
      rememberLocalAttachmentPreviews,
    },
    appendLocalError,
  });

  input.addEventListener('paste', (event) => {
    if (isBusy) {
      return;
    }

    const files = extractFilesFromDataTransfer(event.clipboardData);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    attachmentManager.stageFromFiles(files);
  });

  toolbar.attachButton.addEventListener('click', () => {
    if (isBusy) {
      return;
    }
    fileInput.click();
  });

  toolbar.captureButton.addEventListener('click', () => {
    if (isBusy || isCapturingFullPageScreenshot) {
      return;
    }

    void captureFullPageScreenshotIntoAttachments();
  });

  fileInput.addEventListener('change', () => {
    if (isBusy) {
      fileInput.value = '';
      return;
    }
    attachmentManager.stageFromFiles(Array.from(fileInput.files ?? []));
    fileInput.value = '';
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isBusy && canSubmitMessage(input.value.trim(), attachmentManager.getStaged().length)) {
        form.requestSubmit();
      }
    }
  });

  shell.addEventListener('dragenter', (event) => {
    if (!hasFileDataTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragEnterDepth += 1;
    if (!isBusy) {
      form.classList.add('drop-active');
    }
  });

  shell.addEventListener('dragover', (event) => {
    if (!hasFileDataTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  });

  shell.addEventListener('dragleave', (event) => {
    if (!hasFileDataTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragEnterDepth = Math.max(0, dragEnterDepth - 1);
    if (dragEnterDepth === 0) {
      form.classList.remove('drop-active');
    }
  });

  shell.addEventListener('drop', (event) => {
    if (!hasFileDataTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragEnterDepth = 0;
    form.classList.remove('drop-active');
    if (isBusy) {
      return;
    }

    attachmentManager.stageFromFiles(extractFilesFromDataTransfer(event.dataTransfer));
    input.focus();
  });

  shadowRoot.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || typeof (target as Element).closest !== 'function') {
      return;
    }

    const image = (target as Element).closest<HTMLImageElement>(
      '[data-speakeasy-preview-image="true"]',
    );
    if (!image || imagePreviewView.contains(image)) {
      return;
    }

    const previewUrl = image.src.trim();
    if (!previewUrl) {
      return;
    }

    const imageLabel = image.alt?.trim() ?? '';
    openImagePreview(previewUrl, imageLabel);
  });

  shadowRoot.addEventListener(
    'keydown',
    (event) => {
      if (!('key' in event)) {
        return;
      }

      const keyboardEvent = event as KeyboardEvent;
      if (tabMentionController.onKeyDown(keyboardEvent)) {
        keyboardEvent.stopPropagation();
      }
    },
    true,
  );

  function appendLocalError(message: string): void {
    appendMessage(
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: message,
      },
      messageList,
      messageRenderOptions,
    );
  }

  function renderMessages(messages: ChatMessage[]): void {
    const messagesWithPreviews = applyLocalAttachmentPreviews(messages);
    renderAll(messagesWithPreviews, messageList, messageRenderOptions);
    lastAssistantInteractionId = findLatestAssistantInteractionId(messagesWithPreviews);
    pruneLocalAttachmentPreviews(messagesWithPreviews);
  }

  closeButton.addEventListener('click', () => {
    closePanel();
  });

  imagePreviewCloseButton.addEventListener('click', () => {
    closeImagePreview();
  });

  settingsButton.addEventListener('click', () => {
    void openSettings(messageList, messageRenderOptions);
  });

  newChatButton.addEventListener('click', async () => {
    if (isBusy) {
      return;
    }

    conversationFlow?.cancelQueuedSend();
    setBusyState(true);
    try {
      const chatId = await createNewChat(await ensureChatTabContext());
      activeChatId = chatId;
      attachmentManager.clearStage(true);
      renderMessages([]);
      await historyDropdown.refresh();
      historyDropdown.setOpen(false);
      input.focus();
    } catch (error: unknown) {
      appendMessage(
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: toErrorMessage(error),
        },
        messageList,
        messageRenderOptions,
      );
    } finally {
      setBusyState(false);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!conversationFlow) {
      return;
    }

    await conversationFlow.send();
  });

  chrome.runtime.onMessage.addListener((request: unknown) => {
    if (!isRecord(request)) {
      return;
    }

    switch (request.type) {
      case 'chat/stream-delta': {
        const rid = typeof request.requestId === 'string' ? request.requestId.trim() : '';
        if (rid && conversationFlow) {
          conversationFlow.applyStreamDelta(
            rid,
            typeof request.textDelta === 'string' ? request.textDelta : undefined,
            typeof request.thinkingDelta === 'string' ? request.thinkingDelta : undefined,
          );
        }
        break;
      }
      case 'overlay/toggle':
        void togglePanel();
        break;
      case 'overlay/open':
        void openPanel();
        break;
      case 'overlay/close':
        closePanel();
        break;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isPanelOpen) {
      if (isImagePreviewOpen) {
        closeImagePreview();
        return;
      }
      if (historyDropdown.isOpen()) {
        historyDropdown.setOpen(false);
        return;
      }
      closePanel();
    }
  });

  void loadConversationHistory();

  async function togglePanel(): Promise<void> {
    if (isPanelOpen) {
      closePanel();
      return;
    }

    await openPanel();
  }

  async function openPanel(): Promise<void> {
    isPanelOpen = true;
    shell.hidden = false;
    layoutController.clampAndSync();
    await loadConversationHistory();

    input.focus();
  }

  function closePanel(): void {
    layoutController.cancelInteraction();
    dragEnterDepth = 0;
    form.classList.remove('drop-active');
    tabMentionController.close();
    closeImagePreview();
    historyDropdown.setOpen(false);
    isPanelOpen = false;
    shell.hidden = true;
  }

  async function loadConversationHistory(): Promise<void> {
    try {
      const history = await loadChatMessages(await ensureChatTabContext());
      activeChatId = history.chatId;
      renderMessages(history.messages);
      await historyDropdown.refresh();
    } catch (error: unknown) {
      renderMessages([
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: toErrorMessage(error),
        },
      ]);
      activeChatId = null;
    }
  }

  function setBusyState(nextBusy: boolean): void {
    const wasBusy = isBusy;
    isBusy = nextBusy;
    syncComposerDisabledState();
    if (nextBusy) {
      tabMentionController.close();
    }
    syncToolbarButtonState();
    newChatButton.disabled = nextBusy;
    historyToggleButton.disabled = nextBusy;
    form.toggleAttribute('aria-busy', nextBusy);
    historyDropdown.syncMenuState();
    if (wasBusy && !nextBusy && conversationFlow) {
      void conversationFlow.onAttachmentStateChange();
    }
  }

  function syncToolbarButtonState(): void {
    const toolbarBusy = isBusy || isCapturingFullPageScreenshot || isCapturingMentionScreenshot;
    toolbar.attachButton.disabled = toolbarBusy;
    toolbar.captureButton.disabled = toolbarBusy;
  }

  function syncComposerDisabledState(): void {
    input.disabled = isBusy || isCapturingMentionScreenshot;
  }

  function openImagePreview(imageUrl: string, imageLabel: string): void {
    imagePreviewElement.src = imageUrl;
    imagePreviewElement.alt = imageLabel || 'Image preview';
    tabMentionController.close();
    imagePreviewView.hidden = false;
    isImagePreviewOpen = true;
  }

  function closeImagePreview(): void {
    if (!isImagePreviewOpen && imagePreviewView.hidden) {
      return;
    }

    imagePreviewView.hidden = true;
    imagePreviewElement.removeAttribute('src');
    imagePreviewElement.alt = '';
    isImagePreviewOpen = false;
    resizeComposerInput();
  }

  async function captureFullPageScreenshotIntoAttachments(): Promise<void> {
    isCapturingFullPageScreenshot = true;
    syncToolbarButtonState();

    const shouldRestoreShell = isPanelOpen && !shell.hidden;
    if (shouldRestoreShell) {
      shell.hidden = true;
      await waitForNextPaint();
    }

    try {
      await captureAndStageFullPageScreenshot({
        stageFromFiles: (files) => attachmentManager.stageFromFiles(files),
      });
    } catch (error: unknown) {
      appendLocalError(toErrorMessage(error));
    } finally {
      if (shouldRestoreShell && isPanelOpen) {
        shell.hidden = false;
        layoutController.clampAndSync();
        input.focus();
      }
      isCapturingFullPageScreenshot = false;
      syncToolbarButtonState();
    }
  }

  async function captureMentionTabScreenshot(
    tab: MentionableTab,
    token: MentionTokenRange,
  ): Promise<void> {
    if (isBusy || isCapturingFullPageScreenshot || isCapturingMentionScreenshot) {
      return;
    }

    isCapturingMentionScreenshot = true;
    syncComposerDisabledState();
    syncToolbarButtonState();

    const nextComposerState = removeMentionTokenFromInputText(input.value, token);
    try {
      const screenshotPayload = await captureTabFullPageScreenshotById(tab.tabId);
      const screenshotFile = toScreenshotFile(screenshotPayload);
      attachmentManager.stageFromFiles([screenshotFile]);
      input.value = nextComposerState.text;
      input.focus();
      input.setSelectionRange(nextComposerState.caret, nextComposerState.caret);
      resizeComposerInput();
    } finally {
      isCapturingMentionScreenshot = false;
      syncComposerDisabledState();
      syncToolbarButtonState();
    }
  }

  function rememberLocalAttachmentPreviews(message: ChatMessage): void {
    for (const attachment of message.attachments ?? []) {
      const fileUri = attachment.fileUri?.trim() ?? '';
      const previewUrl = attachment.previewUrl?.trim() ?? '';
      if (!fileUri || !previewUrl || !isImageMimeType(attachment.mimeType)) {
        continue;
      }

      const existing = localAttachmentPreviewUrls.get(fileUri);
      if (existing) {
        if (existing === previewUrl) {
          continue;
        }

        // Keep local blob previews because they preserve original fidelity for in-session rehydration.
        if (isBlobObjectUrl(existing) && !isBlobObjectUrl(previewUrl)) {
          continue;
        }

        if (isBlobObjectUrl(existing)) {
          URL.revokeObjectURL(existing);
        }
      }
      localAttachmentPreviewUrls.set(fileUri, previewUrl);
    }
  }

  function applyLocalAttachmentPreviews(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((message) => {
      const attachments = message.attachments;
      if (!attachments || attachments.length === 0) {
        return message;
      }

      let changed = false;
      const nextAttachments = attachments.map((attachment) => {
        if (!isImageMimeType(attachment.mimeType)) {
          return attachment;
        }
        const fileUri = attachment.fileUri?.trim() ?? '';
        if (!fileUri) {
          return attachment;
        }

        const localPreviewUrl = localAttachmentPreviewUrls.get(fileUri);
        if (!localPreviewUrl) {
          return attachment;
        }

        const currentPreviewUrl = attachment.previewUrl?.trim() ?? '';
        if (currentPreviewUrl === localPreviewUrl) {
          return attachment;
        }

        changed = true;
        return {
          ...attachment,
          previewUrl: localPreviewUrl,
        };
      });

      if (!changed) {
        return message;
      }

      return {
        ...message,
        attachments: nextAttachments,
      };
    });
  }

  function pruneLocalAttachmentPreviews(messages: ChatMessage[]): void {
    const previewByUri = new Map<string, string>();
    for (const message of messages) {
      for (const attachment of message.attachments ?? []) {
        const fileUri = attachment.fileUri?.trim() ?? '';
        if (!fileUri || !isImageMimeType(attachment.mimeType)) {
          continue;
        }

        const previewUrl = attachment.previewUrl?.trim() ?? '';
        previewByUri.set(fileUri, previewUrl);
      }
    }

    for (const [fileUri, previewUrl] of localAttachmentPreviewUrls) {
      const renderedPreviewUrl = previewByUri.get(fileUri);
      if (renderedPreviewUrl && renderedPreviewUrl === previewUrl) {
        continue;
      }
      if (isBlobObjectUrl(previewUrl)) {
        URL.revokeObjectURL(previewUrl);
      }
      localAttachmentPreviewUrls.delete(fileUri);
    }
  }
}

function isBlobObjectUrl(value: string): boolean {
  return value.startsWith('blob:');
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function openSettings(
  messageList: HTMLOListElement,
  options: MessageRenderOptions = {},
): Promise<void> {
  const error = await requestOpenOptionsPage();
  if (!error) {
    return;
  }

  appendMessage(
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: error,
    },
    messageList,
    options,
  );
}
