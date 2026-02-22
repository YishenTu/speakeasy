import {
  type ChatMessage,
  createNewChat,
  deleteChatById,
  forkChat,
  getActiveChatId,
  listChatSessions,
  loadChatMessages,
  loadChatMessagesById,
  regenerateAssistantMessage,
  sendMessage,
  switchAssistantBranch,
} from '../shared/chat';
import type { ChatSessionSummary } from '../shared/runtime';
import { isRecord } from '../shared/utils';
import { createDeleteSessionConfirmation } from './delete-confirmation';
import { queryRequiredElement } from './dom';
import { createInputToolbar } from './input-toolbar';
import {
  type MessageRenderOptions,
  appendMessage,
  removeMessageById,
  renderAll,
  replaceMessageById,
  toErrorMessage,
} from './messages';
import { buildOptimisticUserMessage, findLatestAssistantInteractionId } from './optimistic-message';
import { requestOpenSettings } from './runtime';
import { runWithSuccessCommit } from './success-commit';
import { getChatPanelTemplate } from './template';
import { uploadFilesToGemini } from './uploads';

const ROOT_HOST_ID = 'speakeasy-overlay-root';
const PANEL_MARGIN_PX = 12;
const DEFAULT_RIGHT_GAP_PX = 50;
const MIN_PANEL_WIDTH_PX = 320;
const MIN_PANEL_HEIGHT_PX = 260;
const DEFAULT_PANEL_WIDTH_PX = 430;
const DEFAULT_PANEL_HEIGHT_RATIO = 0.8;
const MAX_STAGED_FILES = 5;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

type PanelLayout = {
  width: number;
  height: number;
  left: number;
  top: number;
};

type DragInteraction = {
  kind: 'drag';
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
};

type ResizeInteraction = {
  kind: 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  direction: ResizeDirection;
};

type InteractionState = DragInteraction | ResizeInteraction;

type ResizeDirection = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

type StagedFile = {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  previewUrl?: string;
};

type ActiveStreamDraft = {
  assistantMessageId: string;
  text: string;
  thinkingSummary: string;
};

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
  const messageList = queryRequiredElement<HTMLOListElement>(shadowRoot, '#speakeasy-messages');
  const toolbar = createInputToolbar(shadowRoot);
  const deleteSessionConfirmation = createDeleteSessionConfirmation(shadowRoot);
  if (resizeHandles.length === 0) {
    throw new Error('Missing resize zones in chat panel template.');
  }

  const resizeComposerInput = (): void => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  input.addEventListener('input', resizeComposerInput);

  let isPanelOpen = false;
  let isBusy = false;
  let hasLoadedHistory = false;
  let panelLayout = createDefaultLayout();
  let interactionState: InteractionState | null = null;
  let previousUserSelect = '';
  let hasUserSelectOverride = false;
  let stagedFiles: StagedFile[] = [];
  let dragEnterDepth = 0;
  let activeChatId: string | null = null;
  let lastAssistantInteractionId: string | undefined;
  let historySessions: ChatSessionSummary[] = [];
  let isHistoryMenuOpen = false;
  const activeStreamDrafts = new Map<string, ActiveStreamDraft>();
  const messageRenderOptions: MessageRenderOptions = {
    onAssistantAction: (action, message) => {
      void handleMessageAction(action, message);
    },
    onAssistantBranchSelect: (message, interactionId) => {
      void handleAssistantBranchSelect(message, interactionId);
    },
    onUserAction: (action, message) => {
      void handleMessageAction(action, message);
    },
  };

  applyPanelLayout(shell, panelLayout);
  historyToggleButton.setAttribute('aria-expanded', 'false');

  input.addEventListener('paste', (event) => {
    if (isBusy) {
      return;
    }

    const files = extractFilesFromDataTransfer(event.clipboardData);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    stageSelectedFiles(files);
  });

  toolbar.attachButton.addEventListener('click', () => {
    if (isBusy) {
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (isBusy) {
      fileInput.value = '';
      return;
    }
    stageSelectedFiles(Array.from(fileInput.files ?? []));
    fileInput.value = '';
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isBusy && canSubmitMessage(input.value.trim(), stagedFiles.length)) {
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

    stageSelectedFiles(extractFilesFromDataTransfer(event.dataTransfer));
    input.focus();
  });

  function stageSelectedFiles(files: File[]): void {
    if (files.length === 0) {
      return;
    }

    const nextFiles: StagedFile[] = [];
    const availableSlots = MAX_STAGED_FILES - stagedFiles.length;
    if (availableSlots <= 0) {
      appendLocalError(`You can attach up to ${MAX_STAGED_FILES} files per message.`);
      return;
    }

    for (const file of files.slice(0, availableSlots)) {
      if (!isAcceptedMimeType(file.type)) {
        appendLocalError(`Unsupported file type for "${file.name}".`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        appendLocalError(
          `"${file.name}" exceeds the ${formatByteSize(MAX_FILE_SIZE_BYTES)} file size limit.`,
        );
        continue;
      }

      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      nextFiles.push({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        ...(previewUrl ? { previewUrl } : {}),
      });
    }

    stagedFiles = [...stagedFiles, ...nextFiles];
    if (files.length > availableSlots) {
      appendLocalError(`Only ${availableSlots} additional file(s) were staged.`);
    }
    renderStagedFiles();
  }

  function renderStagedFiles(): void {
    const fragment = document.createDocumentFragment();

    for (const staged of stagedFiles) {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.dataset.fileId = staged.id;

      const label = document.createElement('span');
      label.className = 'file-chip-label';
      label.textContent = `${staged.name} (${staged.mimeType})`;

      const removeButton = document.createElement('button');
      removeButton.className = 'file-chip-remove';
      removeButton.type = 'button';
      removeButton.textContent = '×';
      removeButton.setAttribute('aria-label', `Remove ${staged.name}`);
      removeButton.addEventListener('click', () => {
        removeStagedFile(staged.id);
      });

      chip.append(label, removeButton);
      fragment.append(chip);
    }

    filePreviews.replaceChildren(fragment);
  }

  function removeStagedFile(fileId: string): void {
    const target = stagedFiles.find((staged) => staged.id === fileId);
    if (!target) {
      return;
    }

    if (target.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    stagedFiles = stagedFiles.filter((staged) => staged.id !== fileId);
    renderStagedFiles();
  }

  function clearStagedFiles(revokePreviews: boolean): void {
    if (revokePreviews) {
      for (const staged of stagedFiles) {
        if (staged.previewUrl) {
          URL.revokeObjectURL(staged.previewUrl);
        }
      }
    }
    stagedFiles = [];
    renderStagedFiles();
  }

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

    replaceMessageById(
      draft.assistantMessageId,
      {
        id: draft.assistantMessageId,
        role: 'assistant',
        content: draft.text,
        ...(draft.thinkingSummary ? { thinkingSummary: draft.thinkingSummary } : {}),
      },
      messageList,
      messageRenderOptions,
    );
  }

  function formatHistoryTimestamp(updatedAt: string): string {
    const timestamp = Date.parse(updatedAt);
    if (Number.isNaN(timestamp)) {
      return updatedAt.replace('T', ' ').slice(0, 16);
    }

    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatHistoryMeta(session: ChatSessionSummary): string {
    const timestamp = formatHistoryTimestamp(session.updatedAt);
    return session.parentChatId ? `Branch · ${timestamp}` : timestamp;
  }

  function setHistoryMenuOpen(nextOpen: boolean): void {
    isHistoryMenuOpen = nextOpen;
    historyControl.classList.toggle('open', nextOpen);
    historyToggleButton.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  }

  function renderHistoryMenu(): void {
    const fragment = document.createDocumentFragment();

    if (historySessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No previous chats.';
      empty.setAttribute('role', 'presentation');
      fragment.append(empty);
      historyMenu.replaceChildren(fragment);
      return;
    }

    for (const session of historySessions) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.setAttribute('role', 'none');

      const openButton = document.createElement('button');
      openButton.className = 'history-item-main';
      openButton.type = 'button';
      openButton.setAttribute('role', 'menuitem');
      openButton.disabled = isBusy;
      if (session.chatId === activeChatId) {
        openButton.classList.add('history-item-active');
      }

      const title = document.createElement('span');
      title.className = 'history-item-title';
      title.textContent = session.title;

      const meta = document.createElement('span');
      meta.className = 'history-item-meta';
      meta.textContent = formatHistoryMeta(session);

      openButton.append(title, meta);
      openButton.addEventListener('click', async () => {
        if (isBusy || session.chatId === activeChatId) {
          return;
        }

        setBusyState(true);
        try {
          await loadChatFromHistory(session.chatId);
          setHistoryMenuOpen(false);
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

      const deleteButton = document.createElement('button');
      deleteButton.className = 'history-item-delete';
      deleteButton.type = 'button';
      deleteButton.setAttribute('aria-label', `Delete ${session.title}`);
      deleteButton.setAttribute('role', 'menuitem');
      deleteButton.textContent = '×';
      deleteButton.disabled = isBusy;
      deleteButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isBusy) {
          return;
        }

        if (!(await deleteSessionConfirmation.confirm(session.title))) {
          return;
        }

        setBusyState(true);
        try {
          const deleted = await deleteChatById(session.chatId);
          if (deleted && activeChatId === session.chatId) {
            activeChatId = (await getActiveChatId()) ?? null;
            clearStagedFiles(true);
            renderMessages([]);
          }
          await refreshHistoryDropdown();
          if (historySessions.length === 0) {
            setHistoryMenuOpen(false);
          }
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

      item.append(openButton, deleteButton);
      fragment.append(item);
    }

    historyMenu.replaceChildren(fragment);
  }

  async function refreshHistoryDropdown(): Promise<void> {
    historySessions = await listChatSessions();
    renderHistoryMenu();
  }

  async function loadChatFromHistory(chatId: string): Promise<void> {
    const payload = await loadChatMessagesById(chatId);
    activeChatId = payload.chatId;
    renderMessages(payload.messages);
    await refreshHistoryDropdown();
  }

  async function reloadActiveChat(): Promise<void> {
    const payload = await loadChatMessages();
    activeChatId = payload.chatId;
    renderMessages(payload.messages);
    await refreshHistoryDropdown();
  }

  function renderMessages(messages: ChatMessage[]): void {
    renderAll(messages, messageList, messageRenderOptions);
    lastAssistantInteractionId = findLatestAssistantInteractionId(messages);
  }

  async function handleMessageAction(
    action: 'regen' | 'fork',
    message: ChatMessage,
  ): Promise<void> {
    if (isBusy) {
      return;
    }

    const previousInteractionId = message.previousInteractionId?.trim();
    const interactionId = message.interactionId?.trim();
    let regenPlaceholderMessageId: string | undefined;
    let regenStreamRequestId: string | undefined;

    setBusyState(true);
    try {
      if (action === 'fork') {
        if (message.role !== 'user' || !previousInteractionId) {
          return;
        }
        await forkChat(previousInteractionId);
        clearStagedFiles(true);
        input.value = message.content;
        resizeComposerInput();
      } else {
        if (message.role !== 'assistant' || !interactionId) {
          return;
        }
        const selectedModel = toolbar.selectedModel();
        const selectedThinking = toolbar.selectedThinkingLevel();
        regenPlaceholderMessageId = message.id;
        replaceMessageById(
          regenPlaceholderMessageId,
          {
            id: regenPlaceholderMessageId,
            role: 'assistant',
            content: '',
          },
          messageList,
          messageRenderOptions,
        );

        regenStreamRequestId = crypto.randomUUID();
        activeStreamDrafts.set(regenStreamRequestId, {
          assistantMessageId: regenPlaceholderMessageId,
          text: '',
          thinkingSummary: '',
        });

        const assistantMessage = await regenerateAssistantMessage(
          interactionId,
          selectedModel,
          selectedThinking,
          regenStreamRequestId,
        );
        activeStreamDrafts.delete(regenStreamRequestId);
        regenStreamRequestId = undefined;
        replaceMessageById(
          regenPlaceholderMessageId,
          assistantMessage,
          messageList,
          messageRenderOptions,
        );
        regenPlaceholderMessageId = undefined;
      }

      await reloadActiveChat();
      setHistoryMenuOpen(false);
      input.focus();
    } catch (error: unknown) {
      if (regenStreamRequestId) {
        activeStreamDrafts.delete(regenStreamRequestId);
      }
      if (regenPlaceholderMessageId) {
        replaceMessageById(regenPlaceholderMessageId, message, messageList, messageRenderOptions);
      }
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
  }

  async function handleAssistantBranchSelect(
    _message: ChatMessage,
    interactionId: string,
  ): Promise<void> {
    if (isBusy) {
      return;
    }

    const normalizedInteractionId = interactionId.trim();
    if (!normalizedInteractionId) {
      return;
    }

    setBusyState(true);
    try {
      await switchAssistantBranch(normalizedInteractionId);
      await reloadActiveChat();
      setHistoryMenuOpen(false);
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
  }

  function startInteractionLock(): void {
    if (!hasUserSelectOverride) {
      previousUserSelect = document.documentElement.style.userSelect;
      hasUserSelectOverride = true;
    }
    document.documentElement.style.userSelect = 'none';
  }

  function endInteractionLock(pointerId: number): void {
    if (shell.hasPointerCapture(pointerId)) {
      shell.releasePointerCapture(pointerId);
    }

    if (hasUserSelectOverride) {
      document.documentElement.style.userSelect = previousUserSelect;
      hasUserSelectOverride = false;
    }
  }

  window.addEventListener('resize', () => {
    panelLayout = clampPanelLayout(panelLayout);
    applyPanelLayout(shell, panelLayout);
  });

  dragHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    if (event.target instanceof Element && event.target.closest('button')) {
      return;
    }

    event.preventDefault();
    interactionState = {
      kind: 'drag',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panelLayout.left,
      startTop: panelLayout.top,
    };
    shell.setPointerCapture(event.pointerId);
    startInteractionLock();
  });

  for (const resizeHandle of resizeHandles) {
    resizeHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      const resizeValue = resizeHandle.dataset.resize;
      if (!resizeValue) {
        return;
      }

      event.preventDefault();
      interactionState = {
        kind: 'resize',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: panelLayout.left,
        startTop: panelLayout.top,
        startWidth: panelLayout.width,
        startHeight: panelLayout.height,
        direction: parseResizeDirection(resizeValue),
      };
      shell.setPointerCapture(event.pointerId);
      startInteractionLock();
    });
  }

  shell.addEventListener('pointermove', (event) => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    if (interactionState.kind === 'drag') {
      panelLayout = clampPanelLayout({
        ...panelLayout,
        left: interactionState.startLeft + (event.clientX - interactionState.startX),
        top: interactionState.startTop + (event.clientY - interactionState.startY),
      });
    } else {
      panelLayout = calculateResizedLayout(
        interactionState,
        event.clientX - interactionState.startX,
        event.clientY - interactionState.startY,
      );
    }

    applyPanelLayout(shell, panelLayout);
  });

  shell.addEventListener('pointerup', (event) => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    endInteractionLock(interactionState.pointerId);
    interactionState = null;
  });

  shell.addEventListener('pointercancel', (event) => {
    if (!interactionState || event.pointerId !== interactionState.pointerId) {
      return;
    }

    endInteractionLock(interactionState.pointerId);
    interactionState = null;
  });

  closeButton.addEventListener('click', () => {
    closePanel();
  });

  settingsButton.addEventListener('click', () => {
    void openSettings(messageList, messageRenderOptions);
  });

  newChatButton.addEventListener('click', async () => {
    if (isBusy) {
      return;
    }

    setBusyState(true);
    try {
      const chatId = await createNewChat();
      activeChatId = chatId;
      clearStagedFiles(true);
      renderMessages([]);
      await refreshHistoryDropdown();
      setHistoryMenuOpen(false);
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

  historyToggleButton.addEventListener('click', async () => {
    if (isBusy) {
      return;
    }

    if (isHistoryMenuOpen) {
      setHistoryMenuOpen(false);
      return;
    }

    setBusyState(true);
    try {
      await refreshHistoryDropdown();
      setHistoryMenuOpen(true);
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

  document.addEventListener('pointerdown', (event) => {
    if (!isHistoryMenuOpen) {
      return;
    }

    if (event.composedPath().includes(historyControl)) {
      return;
    }

    setHistoryMenuOpen(false);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (isBusy) {
      return;
    }

    const userText = input.value.trim();
    if (!canSubmitMessage(userText, stagedFiles.length)) {
      return;
    }

    const stagedSnapshot = [...stagedFiles];
    let optimisticUserMessageId: string | undefined;
    let assistantPlaceholderId: string | undefined;
    let streamRequestId: string | undefined;
    setBusyState(true);

    try {
      const selectedModel = toolbar.selectedModel();
      const selectedThinking = toolbar.selectedThinkingLevel();
      const uploadedAttachments = await uploadFilesToGemini(
        stagedSnapshot.map((staged) => staged.file),
      );
      streamRequestId = crypto.randomUUID();
      const optimisticUserMessage = buildOptimisticUserMessage(
        userText,
        stagedSnapshot,
        lastAssistantInteractionId,
      );
      optimisticUserMessageId = optimisticUserMessage.id;
      assistantPlaceholderId = crypto.randomUUID();
      appendMessage(optimisticUserMessage, messageList, messageRenderOptions);
      appendMessage(
        {
          id: assistantPlaceholderId,
          role: 'assistant',
          content: '',
        },
        messageList,
        messageRenderOptions,
      );

      input.value = '';
      input.style.height = 'auto';
      clearStagedFiles(true);

      activeStreamDrafts.set(streamRequestId, {
        assistantMessageId: assistantPlaceholderId,
        text: '',
        thinkingSummary: '',
      });

      const assistantMessage = await sendMessage(
        userText,
        selectedModel,
        selectedThinking,
        uploadedAttachments,
        streamRequestId,
      );
      activeStreamDrafts.delete(streamRequestId);
      replaceMessageById(
        assistantPlaceholderId,
        assistantMessage,
        messageList,
        messageRenderOptions,
      );
      await reloadActiveChat();
    } catch (error: unknown) {
      if (streamRequestId) {
        activeStreamDrafts.delete(streamRequestId);
      }
      if (assistantPlaceholderId) {
        removeMessageById(assistantPlaceholderId, messageList);
      }
      if (optimisticUserMessageId) {
        removeMessageById(optimisticUserMessageId, messageList);
      }
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
      input.focus();
    }
  });

  chrome.runtime.onMessage.addListener((request: unknown) => {
    if (!isRecord(request)) {
      return;
    }

    switch (request.type) {
      case 'chat/stream-delta': {
        const rid = typeof request.requestId === 'string' ? request.requestId.trim() : '';
        if (rid) {
          applyStreamDelta(
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
      if (isHistoryMenuOpen) {
        setHistoryMenuOpen(false);
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
    panelLayout = clampPanelLayout(panelLayout);
    applyPanelLayout(shell, panelLayout);
    shell.hidden = false;

    if (!hasLoadedHistory) {
      await loadConversationHistory();
    }

    input.focus();
  }

  function closePanel(): void {
    if (interactionState) {
      endInteractionLock(interactionState.pointerId);
      interactionState = null;
    }

    dragEnterDepth = 0;
    form.classList.remove('drop-active');
    setHistoryMenuOpen(false);
    isPanelOpen = false;
    shell.hidden = true;
  }

  async function loadConversationHistory(): Promise<void> {
    try {
      await runWithSuccessCommit(
        async () => {
          const history = await loadChatMessages();
          activeChatId = history.chatId;
          renderMessages(history.messages);
          await refreshHistoryDropdown();
        },
        () => {
          hasLoadedHistory = true;
        },
      );
    } catch (error: unknown) {
      renderMessages([
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: toErrorMessage(error),
        },
      ]);
      hasLoadedHistory = false;
      activeChatId = null;
      historySessions = [];
      renderHistoryMenu();
    }
  }

  function setBusyState(nextBusy: boolean): void {
    isBusy = nextBusy;
    input.disabled = nextBusy;
    toolbar.attachButton.disabled = nextBusy;
    newChatButton.disabled = nextBusy;
    historyToggleButton.disabled = nextBusy;
    renderHistoryMenu();
    form.toggleAttribute('aria-busy', nextBusy);
  }
}

function createDefaultLayout(): PanelLayout {
  const bounds = getViewportBounds();
  const width = clampNumber(DEFAULT_PANEL_WIDTH_PX, bounds.minWidth, bounds.maxWidth);
  const height = clampNumber(
    Math.round(window.innerHeight * DEFAULT_PANEL_HEIGHT_RATIO),
    bounds.minHeight,
    bounds.maxHeight,
  );

  return clampPanelLayout({
    width,
    height,
    left: window.innerWidth - width - DEFAULT_RIGHT_GAP_PX,
    top: Math.round((window.innerHeight - height) / 2),
  });
}

function parseResizeDirection(value: string): ResizeDirection {
  const parts = value.split('-');
  return {
    top: parts.includes('top'),
    right: parts.includes('right'),
    bottom: parts.includes('bottom'),
    left: parts.includes('left'),
  };
}

function calculateResizedLayout(
  interaction: ResizeInteraction,
  deltaX: number,
  deltaY: number,
): PanelLayout {
  const bounds = getViewportBounds();
  const minX = PANEL_MARGIN_PX;
  const maxX = window.innerWidth - PANEL_MARGIN_PX;
  const minY = PANEL_MARGIN_PX;
  const maxY = window.innerHeight - PANEL_MARGIN_PX;
  const startRight = interaction.startLeft + interaction.startWidth;
  const startBottom = interaction.startTop + interaction.startHeight;

  let left = interaction.startLeft;
  let width = interaction.startWidth;
  let top = interaction.startTop;
  let height = interaction.startHeight;

  if (interaction.direction.left) {
    const minLeft = Math.max(minX, startRight - bounds.maxWidth);
    const maxLeft = Math.min(startRight - bounds.minWidth, maxX - bounds.minWidth);
    left = clampNumber(interaction.startLeft + deltaX, minLeft, maxLeft);
    width = startRight - left;
  } else if (interaction.direction.right) {
    const minRight = Math.max(interaction.startLeft + bounds.minWidth, minX + bounds.minWidth);
    const maxRight = Math.min(interaction.startLeft + bounds.maxWidth, maxX);
    const right = clampNumber(startRight + deltaX, minRight, maxRight);
    width = right - interaction.startLeft;
  }

  if (interaction.direction.top) {
    const minTop = Math.max(minY, startBottom - bounds.maxHeight);
    const maxTop = Math.min(startBottom - bounds.minHeight, maxY - bounds.minHeight);
    top = clampNumber(interaction.startTop + deltaY, minTop, maxTop);
    height = startBottom - top;
  } else if (interaction.direction.bottom) {
    const minBottom = Math.max(interaction.startTop + bounds.minHeight, minY + bounds.minHeight);
    const maxBottom = Math.min(interaction.startTop + bounds.maxHeight, maxY);
    const bottom = clampNumber(startBottom + deltaY, minBottom, maxBottom);
    height = bottom - interaction.startTop;
  }

  return clampPanelLayout({
    left,
    top,
    width,
    height,
  });
}

function clampPanelLayout(nextLayout: PanelLayout): PanelLayout {
  const bounds = getViewportBounds();
  const width = clampNumber(nextLayout.width, bounds.minWidth, bounds.maxWidth);
  const height = clampNumber(nextLayout.height, bounds.minHeight, bounds.maxHeight);
  const maxLeft = window.innerWidth - width - PANEL_MARGIN_PX;
  const maxTop = window.innerHeight - height - PANEL_MARGIN_PX;

  return {
    width,
    height,
    left: clampNumber(nextLayout.left, PANEL_MARGIN_PX, maxLeft),
    top: clampNumber(nextLayout.top, PANEL_MARGIN_PX, maxTop),
  };
}

function applyPanelLayout(shell: HTMLElement, layout: PanelLayout): void {
  shell.style.width = `${layout.width}px`;
  shell.style.height = `${layout.height}px`;
  shell.style.left = `${layout.left}px`;
  shell.style.top = `${layout.top}px`;
}

function getViewportBounds(): {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
} {
  const maxWidth = Math.max(1, window.innerWidth - PANEL_MARGIN_PX * 2);
  const maxHeight = Math.max(1, window.innerHeight - PANEL_MARGIN_PX * 2);

  return {
    minWidth: Math.min(MIN_PANEL_WIDTH_PX, maxWidth),
    maxWidth,
    minHeight: Math.min(MIN_PANEL_HEIGHT_PX, maxHeight),
    maxHeight,
  };
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue);
}

function canSubmitMessage(userText: string, stagedFileCount: number): boolean {
  return userText.length > 0 || stagedFileCount > 0;
}

function isAcceptedMimeType(mimeType: string): boolean {
  return ACCEPTED_MIME_TYPES.has(mimeType.toLowerCase());
}

function hasFileDataTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types).includes('Files')) {
    return true;
  }

  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file') {
        return true;
      }
    }
  }

  return dataTransfer.files.length > 0;
}

function extractFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  const filesFromItems: File[] = [];
  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') {
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        filesFromItems.push(file);
      }
    }
  }
  if (filesFromItems.length > 0) {
    return filesFromItems;
  }

  return Array.from(dataTransfer.files);
}

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }
  return `${bytes} B`;
}

async function openSettings(
  messageList: HTMLOListElement,
  options: MessageRenderOptions = {},
): Promise<void> {
  const error = await requestOpenSettings();
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
