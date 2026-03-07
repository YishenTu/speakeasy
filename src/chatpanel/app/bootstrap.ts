import {
  type ChatMessage,
  type ChatTabContext,
  captureTabFullPageScreenshotById,
  createNewChat,
  extractTabTextById,
  forkChat,
  listOpenTabsForMention,
  loadChatMessages,
  regenerateAssistantMessage,
  resolveChatTabContext,
  sendMessage,
  switchAssistantBranch,
} from '../../shared/chat';
import type { RuntimeResponse, TabExtractTextPayload } from '../../shared/runtime';
import { requestOpenOptionsPage } from '../../shared/runtime-client';
import {
  DEFAULT_PAGE_TEXT_EXTRACTION_ENGINE,
  GEMINI_SETTINGS_STORAGE_KEY,
  type PageTextExtractionEngine,
  normalizeGeminiSettings,
} from '../../shared/settings';
import { isTabExtractTextMessageRequest } from '../../shared/tab-text-extraction-message';
import { isRecord } from '../../shared/utils';
import { queryRequiredElement } from '../core/dom';
import { getYouTubeUrlForPrompt } from '../core/youtube-url';
import {
  createAttachmentManager,
  extractFilesFromDataTransfer,
  hasFileDataTransfer,
} from '../features/attachments/attachment-manager';
import {
  captureAndStageFullPageScreenshot,
  toScreenshotFile,
} from '../features/attachments/full-page-screenshot';
import {
  extractAndStageCurrentTabText,
  extractCurrentTabTextWithPlugins,
  toExtractedTextFile,
} from '../features/attachments/page-text-extraction';
import { readAttachedTextPreview } from '../features/attachments/text-preview';
import { createInputToolbar } from '../features/composer/input-toolbar';
import { createSlashCommandMenuController } from '../features/composer/slash-command-menu';
import {
  canSubmitMessage,
  createConversationFlowController,
} from '../features/conversation/conversation-flow';
import { createDeleteSessionConfirmation } from '../features/history/delete-confirmation';
import { createHistoryDropdownController } from '../features/history/history-dropdown';
import { createPanelLayoutController } from '../features/layout/panel-layout';
import {
  type MentionTabAction,
  type MentionTokenRange,
  type MentionableTab,
  createTabMentionController,
  removeMentionTokenFromInputText,
} from '../features/mentions/tab-mention';
import {
  type MessageRenderOptions,
  appendMessage,
  removeMessageById,
  renderAll,
  replaceMessageById,
  toErrorMessage,
} from '../features/messages/message-renderer';
import { findLatestAssistantInteractionId } from '../features/messages/optimistic-message';
import { createMessageListAutoScrollState } from '../features/messages/scroll-follow-state';
import { createLocalAttachmentPreviewCache } from '../features/preview/local-preview-cache';
import { getChatPanelTemplate } from '../template';
import { createPanelVisibilityController } from './panel-visibility';

const ROOT_HOST_ID = 'speakeasy-overlay-root';
const INPUT_MAX_PANEL_HEIGHT_RATIO = 1 / 3;
const BRAND_LOGO_ASSET_PATH = 'icons/gemini-logo.svg';
const VIDEO_URL_PROMPT_PREFIX = 'Video URL: ';

export function mountChatPanel(): void {
  if (document.getElementById(ROOT_HOST_ID)) {
    return;
  }

  const host = document.createElement('div');
  host.id = ROOT_HOST_ID;
  document.documentElement.append(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = getChatPanelTemplate(resolveExtensionAssetUrl(BRAND_LOGO_ASSET_PATH));

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
  const slashCommandMenu = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-slash-command-menu',
  );
  const slashCommandList = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-slash-command-list',
  );
  const slashCommandEmpty = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-slash-command-empty',
  );
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
  const textPreviewView = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-text-preview-view',
  );
  const textPreviewTitle = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-text-preview-title',
  );
  const textPreviewContent = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-text-preview-content',
  );
  const textPreviewCloseButton = queryRequiredElement<HTMLButtonElement>(
    shadowRoot,
    '#speakeasy-text-preview-close',
  );
  const toolbar = createInputToolbar(shadowRoot);
  const initialYouTubeUrl = getYouTubeUrlForPrompt(window.location.href);
  const isYouTubeTabContext = initialYouTubeUrl !== null;
  const deleteSessionConfirmation = createDeleteSessionConfirmation(shadowRoot);
  if (resizeHandles.length === 0) {
    throw new Error('Missing resize zones in chat panel template.');
  }

  function parseCssPixels(value: string, fallbackValue: number): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  }

  function getComposerInputMinimumHeight(): number {
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
  }

  function resizeComposerInput(): void {
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
  }

  const layoutController = createPanelLayoutController({
    shell,
    dragHandle,
    resizeHandles,
    onLayoutApplied: resizeComposerInput,
  });
  layoutController.clampAndSync();

  input.addEventListener('input', () => {
    resizeComposerInput();
    slashCommandController.onInputOrCaretChange();
    tabMentionController.onInputOrCaretChange();
  });
  input.addEventListener('click', () => {
    slashCommandController.onInputOrCaretChange();
    tabMentionController.onInputOrCaretChange();
  });
  input.addEventListener('keyup', () => {
    slashCommandController.onInputOrCaretChange();
    tabMentionController.onInputOrCaretChange();
  });
  const stopInputKeyboardPropagation = (event: KeyboardEvent) => {
    event.stopPropagation();
  };
  input.addEventListener('keydown', stopInputKeyboardPropagation);
  input.addEventListener('keyup', stopInputKeyboardPropagation);
  input.addEventListener('keypress', stopInputKeyboardPropagation);

  let isBusy = false;
  let isInputComposing = false;
  let isCapturingFullPageScreenshot = false;
  let isExtractingPageText = false;
  let isProcessingMentionAction = false;
  let isImagePreviewOpen = false;
  let isTextPreviewOpen = false;
  let dragEnterDepth = 0;
  let activeChatId: string | null = null;
  const chatTabContext: ChatTabContext = {};
  let hasResolvedChatTabContext = false;
  let lastAssistantInteractionId: string | undefined;
  const localAttachmentPreviewCache = createLocalAttachmentPreviewCache();
  let conversationFlow: ReturnType<typeof createConversationFlowController> | null = null;
  let pageTextExtractionEngine: PageTextExtractionEngine = DEFAULT_PAGE_TEXT_EXTRACTION_ENGINE;
  let hasLoadedPageTextExtractionEngine = false;
  const loadPageTextExtractionEnginePromise = loadPageTextExtractionEngine();
  const messageListAutoScrollState = createMessageListAutoScrollState();

  function syncMessageListAutoScrollState(): void {
    messageListAutoScrollState.updateFromScroll({
      scrollTop: messageList.scrollTop,
      clientHeight: messageList.clientHeight,
      scrollHeight: messageList.scrollHeight,
    });
  }

  function resumeMessageListAutoScroll(): void {
    messageListAutoScrollState.resumeAutoScroll();
    messageList.scrollTop = messageList.scrollHeight;
    syncMessageListAutoScrollState();
  }

  messageList.addEventListener('scroll', () => {
    syncMessageListAutoScrollState();
  });

  function applyPageTextExtractionEngine(rawSettings: unknown): void {
    pageTextExtractionEngine = normalizeGeminiSettings(rawSettings).pageTextExtractionEngine;
    hasLoadedPageTextExtractionEngine = true;
  }

  async function loadPageTextExtractionEngine(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
      applyPageTextExtractionEngine(stored[GEMINI_SETTINGS_STORAGE_KEY]);
    } catch {
      hasLoadedPageTextExtractionEngine = true;
    }
  }

  async function resolvePageTextExtractionEngine(): Promise<PageTextExtractionEngine> {
    if (!hasLoadedPageTextExtractionEngine) {
      await loadPageTextExtractionEnginePromise;
    }
    return pageTextExtractionEngine;
  }

  chrome.storage.onChanged.addListener((changes) => {
    const settingsChange = changes[GEMINI_SETTINGS_STORAGE_KEY];
    if (!settingsChange) {
      return;
    }
    applyPageTextExtractionEngine(settingsChange.newValue);
  });

  const messageRenderOptions: MessageRenderOptions = {
    shouldAutoScroll: () => messageListAutoScrollState.shouldAutoScroll(),
    onAutoScrollToBottom: () => {
      syncMessageListAutoScrollState();
    },
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
    localAttachmentPreviewUrls: localAttachmentPreviewCache.previewUrlsByFileUri,
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
    onSelectTabAction: handleMentionTabActionSelection,
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
    isBusy: () =>
      isBusy || isCapturingFullPageScreenshot || isExtractingPageText || isProcessingMentionAction,
  });
  const slashCommandController = createSlashCommandMenuController({
    input,
    menu: slashCommandMenu,
    list: slashCommandList,
    emptyState: slashCommandEmpty,
    isBusy: () =>
      isBusy || isCapturingFullPageScreenshot || isExtractingPageText || isProcessingMentionAction,
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
      rememberLocalAttachmentPreviews: localAttachmentPreviewCache.remember,
    },
    appendLocalError,
  });
  syncToolbarActionVisibility();

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
    if (isBusy || isCapturingFullPageScreenshot || isExtractingPageText) {
      return;
    }

    void captureFullPageScreenshotIntoAttachments();
  });

  toolbar.extractTextButton.addEventListener('click', () => {
    if (isBusy || isCapturingFullPageScreenshot || isExtractingPageText) {
      return;
    }

    void extractCurrentTabTextIntoAttachments();
  });

  toolbar.videoUrlButton.addEventListener('click', () => {
    if (
      isBusy ||
      isCapturingFullPageScreenshot ||
      isExtractingPageText ||
      isProcessingMentionAction
    ) {
      return;
    }

    attachCurrentTabYouTubeUrlToInput();
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
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (isInputComposing || event.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      if (!isBusy && canSubmitMessage(input.value.trim(), attachmentManager.getStaged().length)) {
        form.requestSubmit();
      }
    }
  });

  input.addEventListener('compositionstart', () => {
    isInputComposing = true;
  });

  input.addEventListener('compositionend', () => {
    isInputComposing = false;
  });

  input.addEventListener('blur', () => {
    isInputComposing = false;
    slashCommandController.close();
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

    if ((target as Element).closest('.file-preview-remove')) {
      return;
    }

    const image = (target as Element).closest<HTMLImageElement>(
      '[data-speakeasy-preview-image="true"]',
    );
    if (!image || imagePreviewView.contains(image)) {
      const textTarget = (target as Element).closest<HTMLElement>(
        '[data-speakeasy-preview-text="true"]',
      );
      if (!textTarget || textPreviewView.contains(textTarget)) {
        return;
      }

      const textPreview = readAttachedTextPreview(textTarget);
      if (!textPreview) {
        return;
      }

      openTextPreview(textPreview.title, textPreview.text);
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
      if (
        tabMentionController.onKeyDown(keyboardEvent) ||
        slashCommandController.onKeyDown(keyboardEvent)
      ) {
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
    const messagesWithPreviews = localAttachmentPreviewCache.apply(messages);
    renderAll(messagesWithPreviews, messageList, messageRenderOptions);
    lastAssistantInteractionId = findLatestAssistantInteractionId(messagesWithPreviews);
    localAttachmentPreviewCache.prune(messagesWithPreviews);
  }

  const panelVisibility = createPanelVisibilityController({
    shell,
    input,
    clampLayout: () => layoutController.clampAndSync(),
    cancelLayoutInteraction: () => layoutController.cancelInteraction(),
    onOpen: loadConversationHistory,
    onClose: () => {
      dragEnterDepth = 0;
      form.classList.remove('drop-active');
      slashCommandController.close();
      tabMentionController.close();
      closeImagePreview();
      closeTextPreview();
      historyDropdown.setOpen(false);
    },
  });

  closeButton.addEventListener('click', () => {
    panelVisibility.close();
  });

  imagePreviewCloseButton.addEventListener('click', () => {
    closeImagePreview();
  });

  textPreviewCloseButton.addEventListener('click', () => {
    closeTextPreview();
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

    resumeMessageListAutoScroll();
    await conversationFlow.send();
  });

  chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
    if (isTabExtractTextMessageRequest(request)) {
      void handleTabExtractTextMessage(sendResponse);

      return true;
    }

    if (!isRecord(request)) {
      return false;
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
        if (panelVisibility.isOpen() && shadowRoot.activeElement === input) {
          break;
        }
        void panelVisibility.toggle();
        break;
      case 'overlay/open':
        void panelVisibility.open();
        break;
      case 'overlay/close':
        panelVisibility.close();
        break;
    }

    return false;
  });

  async function handleTabExtractTextMessage(
    sendResponse: (
      response: RuntimeResponse<TabExtractTextPayload> | RuntimeResponse<never>,
    ) => void,
  ): Promise<void> {
    try {
      const extractionEngine = await resolvePageTextExtractionEngine();
      const payload = await extractCurrentTabTextWithPlugins({
        extractionEngine,
      });
      const response: RuntimeResponse<typeof payload> = {
        ok: true,
        payload,
      };
      sendResponse(response);
    } catch (error: unknown) {
      const response: RuntimeResponse<never> = {
        ok: false,
        error: toErrorMessage(error),
      };
      sendResponse(response);
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panelVisibility.isOpen()) {
      if (isImagePreviewOpen) {
        closeImagePreview();
        return;
      }
      if (isTextPreviewOpen) {
        closeTextPreview();
        return;
      }
      if (historyDropdown.isOpen()) {
        historyDropdown.setOpen(false);
        return;
      }
      panelVisibility.close();
    }
  });

  void loadConversationHistory();

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
      slashCommandController.close();
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
    const toolbarBusy =
      isBusy || isCapturingFullPageScreenshot || isExtractingPageText || isProcessingMentionAction;
    toolbar.attachButton.disabled = toolbarBusy;
    toolbar.captureButton.disabled = toolbarBusy;
    toolbar.extractTextButton.disabled = toolbarBusy;
    toolbar.videoUrlButton.disabled = toolbarBusy;
  }

  function syncToolbarActionVisibility(): void {
    toolbar.extractTextButton.hidden = isYouTubeTabContext;
    toolbar.captureButton.hidden = isYouTubeTabContext;
    toolbar.videoUrlButton.hidden = !isYouTubeTabContext;
  }

  function syncComposerDisabledState(): void {
    input.disabled = isBusy || isProcessingMentionAction;
    if (input.disabled) {
      slashCommandController.close();
    }
  }

  function openImagePreview(imageUrl: string, imageLabel: string): void {
    closeTextPreview();
    slashCommandController.close();
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

  function openTextPreview(title: string, text: string): void {
    closeImagePreview();
    slashCommandController.close();
    textPreviewTitle.textContent = title.trim() || 'Markdown preview';
    textPreviewContent.textContent = text;
    tabMentionController.close();
    textPreviewView.hidden = false;
    isTextPreviewOpen = true;
  }

  function closeTextPreview(): void {
    if (!isTextPreviewOpen && textPreviewView.hidden) {
      return;
    }

    textPreviewView.hidden = true;
    textPreviewTitle.textContent = '';
    textPreviewContent.textContent = '';
    isTextPreviewOpen = false;
    resizeComposerInput();
  }

  async function captureFullPageScreenshotIntoAttachments(): Promise<void> {
    isCapturingFullPageScreenshot = true;
    syncToolbarButtonState();

    const shouldRestoreShell = panelVisibility.isOpen() && !shell.hidden;
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
      if (shouldRestoreShell && panelVisibility.isOpen()) {
        shell.hidden = false;
        layoutController.clampAndSync();
        input.focus();
      }
      isCapturingFullPageScreenshot = false;
      syncToolbarButtonState();
    }
  }

  async function extractCurrentTabTextIntoAttachments(): Promise<void> {
    isExtractingPageText = true;
    syncToolbarButtonState();

    try {
      const extractionEngine = await resolvePageTextExtractionEngine();
      await extractAndStageCurrentTabText({
        stageFromFiles: (files) => attachmentManager.stageFromFiles(files),
        extractionEngine,
      });
    } catch (error: unknown) {
      appendLocalError(toErrorMessage(error));
    } finally {
      isExtractingPageText = false;
      syncToolbarButtonState();
    }
  }

  function attachCurrentTabYouTubeUrlToInput(): void {
    const videoUrl = getYouTubeUrlForPrompt(window.location.href) ?? initialYouTubeUrl;
    if (!videoUrl) {
      appendLocalError('Unable to attach the current YouTube URL.');
      return;
    }

    const nextValue = appendVideoUrlPrompt(input.value, videoUrl);
    if (nextValue === input.value) {
      input.focus();
      return;
    }

    input.value = nextValue;
    input.focus();
    input.setSelectionRange(nextValue.length, nextValue.length);
    resizeComposerInput();
  }

  async function handleMentionTabActionSelection(
    tab: MentionableTab,
    token: MentionTokenRange,
    action: MentionTabAction,
  ): Promise<void> {
    switch (action) {
      case 'extract-text':
        await extractMentionTabText(tab, token);
        return;
      case 'screenshot':
        await captureMentionTabScreenshot(tab, token);
        return;
      default: {
        const unsupportedAction: never = action;
        throw new Error(`Unsupported mention action: ${String(unsupportedAction)}`);
      }
    }
  }

  async function extractMentionTabText(
    tab: MentionableTab,
    token: MentionTokenRange,
  ): Promise<void> {
    await stageMentionAttachment(token, async () => {
      const extractedPayload = await extractTabTextById(tab.tabId);
      return toExtractedTextFile({
        markdown: extractedPayload.markdown,
        title: extractedPayload.title,
      });
    });
  }

  async function captureMentionTabScreenshot(
    tab: MentionableTab,
    token: MentionTokenRange,
  ): Promise<void> {
    await stageMentionAttachment(token, async () => {
      const screenshotPayload = await captureTabFullPageScreenshotById(tab.tabId);
      return toScreenshotFile(screenshotPayload);
    });
  }

  async function stageMentionAttachment(
    token: MentionTokenRange,
    resolveAttachmentFile: () => Promise<File>,
  ): Promise<void> {
    if (
      isBusy ||
      isCapturingFullPageScreenshot ||
      isExtractingPageText ||
      isProcessingMentionAction
    ) {
      return;
    }

    isProcessingMentionAction = true;
    syncComposerDisabledState();
    syncToolbarButtonState();

    const nextComposerState = removeMentionTokenFromInputText(input.value, token);
    try {
      const attachmentFile = await resolveAttachmentFile();
      attachmentManager.stageFromFiles([attachmentFile]);
      input.value = nextComposerState.text;
      input.focus();
      input.setSelectionRange(nextComposerState.caret, nextComposerState.caret);
      resizeComposerInput();
    } finally {
      isProcessingMentionAction = false;
      syncComposerDisabledState();
      syncToolbarButtonState();
    }
  }
}

function appendVideoUrlPrompt(inputValue: string, videoUrl: string): string {
  const promptLine = `${VIDEO_URL_PROMPT_PREFIX}${videoUrl}`;
  const lines = inputValue.split('\n');
  const existingPromptIndex = lines.findIndex((line) => line.startsWith(VIDEO_URL_PROMPT_PREFIX));
  if (existingPromptIndex >= 0) {
    if (lines[existingPromptIndex] === promptLine) {
      return inputValue;
    }

    lines[existingPromptIndex] = promptLine;
    return lines.join('\n');
  }

  const separator = !inputValue || inputValue.endsWith('\n') ? '' : '\n';
  return `${inputValue}${separator}${promptLine}`;
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function resolveExtensionAssetUrl(assetPath: string): string {
  return chrome.runtime?.getURL?.(assetPath) ?? assetPath;
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
