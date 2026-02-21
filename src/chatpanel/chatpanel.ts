import { createNewChat, loadChatMessages, sendMessage } from '../shared/chat';
import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
} from '../shared/settings';
import { isRecord } from '../shared/utils';
import { queryRequiredElement } from './dom';
import { appendMessage, createWelcomeMessage, renderAll, toErrorMessage } from './messages';
import { requestOpenSettings } from './runtime';
import { getChatPanelTemplate } from './template';

const ROOT_HOST_ID = 'speakeasy-overlay-root';
const PANEL_MARGIN_PX = 12;
const DEFAULT_RIGHT_GAP_PX = 50;
const MIN_PANEL_WIDTH_PX = 320;
const MIN_PANEL_HEIGHT_PX = 260;
const DEFAULT_PANEL_WIDTH_PX = 390;
const DEFAULT_PANEL_HEIGHT_RATIO = 0.8;

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
  const messageList = queryRequiredElement<HTMLOListElement>(shadowRoot, '#speakeasy-messages');
  const modelDropup = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-model-dropup');
  const modelTrigger = queryRequiredElement<HTMLButtonElement>(modelDropup, '.dropup-trigger');
  const modelMenu = queryRequiredElement<HTMLElement>(modelDropup, '.dropup-menu');
  const thinkingDropup = queryRequiredElement<HTMLElement>(
    shadowRoot,
    '#speakeasy-thinking-dropup',
  );
  const thinkingTrigger = queryRequiredElement<HTMLButtonElement>(
    thinkingDropup,
    '.dropup-trigger',
  );
  const thinkingMenu = queryRequiredElement<HTMLElement>(thinkingDropup, '.dropup-menu');
  if (resizeHandles.length === 0) {
    throw new Error('Missing resize zones in chat panel template.');
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isBusy && input.value.trim()) {
        form.requestSubmit();
      }
    }
  });

  const MODEL_ALIASES: Record<string, string> = {
    'gemini-3-flash-preview': 'Flash',
    'gemini-3.1-pro-preview': 'Pro',
  };
  const BUILTIN_THINKING_LEVELS: Record<string, string[]> = {
    'gemini-3-flash-preview': ['minimal', 'low', 'medium', 'high'],
    'gemini-3.1-pro-preview': ['low', 'medium', 'high'],
  };
  const DEFAULT_THINKING_DEFAULTS: Record<string, string> = {
    'gemini-3-flash-preview': 'minimal',
    'gemini-3.1-pro-preview': 'high',
  };
  const DEFAULT_THINKING_LEVELS = ['low', 'medium', 'high'];
  const THINKING_LABELS: Record<string, string> = {
    high: 'High',
    medium: 'Med',
    low: 'Low',
    minimal: 'Min',
  };

  function closeAllDropups(): void {
    modelDropup.classList.remove('open');
    thinkingDropup.classList.remove('open');
  }

  function selectDropupItem(
    dropup: HTMLElement,
    trigger: HTMLButtonElement,
    value: string,
    label: string,
  ): void {
    trigger.dataset.value = value;
    trigger.textContent = label;
    const menu = dropup.querySelector('.dropup-menu');
    if (menu) {
      for (const item of Array.from(menu.querySelectorAll('.dropup-item'))) {
        item.setAttribute(
          'aria-selected',
          item.getAttribute('data-value') === value ? 'true' : 'false',
        );
      }
    }
  }

  modelTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = modelDropup.classList.contains('open');
    closeAllDropups();
    if (!wasOpen) modelDropup.classList.add('open');
  });

  thinkingTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = thinkingDropup.classList.contains('open');
    closeAllDropups();
    if (!wasOpen) thinkingDropup.classList.add('open');
  });

  modelMenu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest('.dropup-item') as HTMLElement | null;
    if (!item) return;
    const value = item.dataset.value ?? '';
    const label = item.textContent ?? value;
    selectDropupItem(modelDropup, modelTrigger, value, label);
    closeAllDropups();
    updateThinkingOptions(value);
  });

  thinkingMenu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest('.dropup-item') as HTMLElement | null;
    if (!item) return;
    const value = item.dataset.value ?? '';
    const label = item.textContent ?? value;
    selectDropupItem(thinkingDropup, thinkingTrigger, value, label);
    closeAllDropups();
  });

  shadowRoot.addEventListener('click', () => {
    closeAllDropups();
  });

  function updateThinkingOptions(model: string): void {
    const levels = BUILTIN_THINKING_LEVELS[model] ?? DEFAULT_THINKING_LEVELS;
    const defaultLevel = DEFAULT_THINKING_DEFAULTS[model] ?? 'high';
    thinkingMenu.innerHTML = '';
    for (const level of [...levels].reverse()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dropup-item';
      btn.dataset.value = level;
      btn.textContent = THINKING_LABELS[level] ?? level;
      btn.setAttribute('aria-selected', level === defaultLevel ? 'true' : 'false');
      thinkingMenu.appendChild(btn);
    }
    selectDropupItem(
      thinkingDropup,
      thinkingTrigger,
      defaultLevel,
      THINKING_LABELS[defaultLevel] ?? defaultLevel,
    );
  }

  function applyCustomModels(customModels: string[]): void {
    const existing = new Set<string>();
    for (const item of Array.from(modelMenu.querySelectorAll('.dropup-item'))) {
      if ((item as HTMLElement).dataset.custom) {
        item.remove();
      } else {
        existing.add(item.getAttribute('data-value') ?? '');
      }
    }
    for (const model of customModels) {
      if (!existing.has(model)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropup-item';
        btn.dataset.value = model;
        btn.dataset.custom = '1';
        btn.textContent = MODEL_ALIASES[model] ?? model;
        modelMenu.appendChild(btn);
      }
    }
  }

  void chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY).then((stored) => {
    const settings = normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
    applyCustomModels(settings.customModels);
  });

  chrome.storage.onChanged.addListener((changes) => {
    const settingsChange = changes[GEMINI_SETTINGS_STORAGE_KEY];
    if (!settingsChange) {
      return;
    }
    const settings = normalizeGeminiSettings(settingsChange.newValue);
    applyCustomModels(settings.customModels);
  });

  let isPanelOpen = false;
  let isBusy = false;
  let hasLoadedHistory = false;
  let panelLayout = createDefaultLayout();
  let interactionState: InteractionState | null = null;
  let previousUserSelect = '';
  let hasUserSelectOverride = false;

  applyPanelLayout(shell, panelLayout);

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
    if (!userText) {
      return;
    }

    appendMessage(
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: userText,
      },
      messageList,
    );

    input.value = '';
    input.style.height = 'auto';
    setBusyState(true);

    try {
      const selectedModel = modelTrigger.dataset.value ?? 'gemini-3-flash-preview';
      const selectedThinking = thinkingTrigger.dataset.value ?? 'minimal';
      const assistantMessage = await sendMessage(userText, selectedModel, selectedThinking);
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
