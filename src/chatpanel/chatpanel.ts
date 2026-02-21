import { createNewChat, loadChatMessages, sendMessage } from '../shared/chat';
import type { ChatAttachment } from '../shared/messages';
import { isRecord } from '../shared/utils';
import { queryRequiredElement } from './dom';
import { createInputToolbar } from './input-toolbar';
import { appendMessage, createWelcomeMessage, renderAll, toErrorMessage } from './messages';
import { requestOpenSettings } from './runtime';
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
  const form = queryRequiredElement<HTMLFormElement>(shadowRoot, '#speakeasy-form');
  const input = queryRequiredElement<HTMLTextAreaElement>(shadowRoot, '#speakeasy-input');
  const fileInput = queryRequiredElement<HTMLInputElement>(shadowRoot, '#speakeasy-file-input');
  const filePreviews = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-file-previews');
  const messageList = queryRequiredElement<HTMLOListElement>(shadowRoot, '#speakeasy-messages');
  const toolbar = createInputToolbar(shadowRoot);
  if (resizeHandles.length === 0) {
    throw new Error('Missing resize zones in chat panel template.');
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  });

  let isPanelOpen = false;
  let isBusy = false;
  let hasLoadedHistory = false;
  let panelLayout = createDefaultLayout();
  let interactionState: InteractionState | null = null;
  let previousUserSelect = '';
  let hasUserSelectOverride = false;
  let stagedFiles: StagedFile[] = [];
  let dragEnterDepth = 0;

  applyPanelLayout(shell, panelLayout);

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
    );
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
    void openSettings(messageList);
  });

  newChatButton.addEventListener('click', async () => {
    if (isBusy) {
      return;
    }

    setBusyState(true);
    try {
      await createNewChat();
      clearStagedFiles(true);
      renderAll([createWelcomeMessage()], messageList);
      input.focus();
    } catch (error: unknown) {
      appendMessage(
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: toErrorMessage(error),
        },
        messageList,
      );
    } finally {
      setBusyState(false);
    }
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
    setBusyState(true);

    try {
      const uploadedAttachments = await uploadFilesToGemini(
        stagedSnapshot.map((staged) => staged.file),
      );
      const userMessageAttachments: ChatAttachment[] = uploadedAttachments.map(
        (attachment, index) => {
          const staged = stagedSnapshot[index];
          let previewUrl: string | undefined;
          if (staged?.mimeType.startsWith('image/')) {
            previewUrl = URL.createObjectURL(staged.file);
          }

          return {
            name: attachment.name,
            mimeType: attachment.mimeType,
            fileUri: attachment.fileUri,
            ...(previewUrl ? { previewUrl } : {}),
          };
        },
      );

      appendMessage(
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: userText,
          ...(userMessageAttachments.length > 0 ? { attachments: userMessageAttachments } : {}),
        },
        messageList,
      );

      input.value = '';
      input.style.height = 'auto';
      clearStagedFiles(true);

      const selectedModel = toolbar.selectedModel();
      const selectedThinking = toolbar.selectedThinkingLevel();
      const assistantMessage = await sendMessage(
        userText,
        selectedModel,
        selectedThinking,
        uploadedAttachments,
      );
      appendMessage(assistantMessage, messageList);
    } catch (error: unknown) {
      appendMessage(
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: toErrorMessage(error),
        },
        messageList,
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
    isPanelOpen = false;
    shell.hidden = true;
  }

  async function loadConversationHistory(): Promise<void> {
    hasLoadedHistory = true;

    try {
      const history = await loadChatMessages();
      if (history.messages.length > 0) {
        renderAll(history.messages, messageList);
        return;
      }

      renderAll([createWelcomeMessage()], messageList);
    } catch (error: unknown) {
      renderAll(
        [
          createWelcomeMessage(),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: toErrorMessage(error),
          },
        ],
        messageList,
      );
    }
  }

  function setBusyState(nextBusy: boolean): void {
    isBusy = nextBusy;
    input.disabled = nextBusy;
    toolbar.attachButton.disabled = nextBusy;
    newChatButton.disabled = nextBusy;
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

async function openSettings(messageList: HTMLOListElement): Promise<void> {
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
  );
}
