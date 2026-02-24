import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_SETTINGS_STORAGE_KEY,
  getModelDisplayLabel,
  getModelThinkingLevels,
  normalizeGeminiSettings,
} from '../../../shared/settings';
import { queryRequiredElement } from '../../core/dom';
import { createMenuController } from '../../core/menu-controller';

export interface InputToolbar {
  selectedModel(): string;
  selectedThinkingLevel(): string;
  captureButton: HTMLButtonElement;
  extractTextButton: HTMLButtonElement;
  attachButton: HTMLButtonElement;
}

const THINKING_LABELS: Record<string, string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
  minimal: 'Min',
};

export function createInputToolbar(shadowRoot: ShadowRoot): InputToolbar {
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
  const captureButton = queryRequiredElement<HTMLButtonElement>(
    shadowRoot,
    '#speakeasy-capture-full-page',
  );
  const extractTextButton = queryRequiredElement<HTMLButtonElement>(
    shadowRoot,
    '#speakeasy-extract-page-text',
  );
  const attachButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-attach');
  const modelMenuController = createMenuController({ container: modelDropup });
  const thinkingMenuController = createMenuController({ container: thinkingDropup });
  let modelThinkingLevelMap = normalizeGeminiSettings(undefined).modelThinkingLevelMap;

  function closeAllDropups(): void {
    modelMenuController.setOpen(false);
    thinkingMenuController.setOpen(false);
  }

  function selectedModelValue(): string {
    return modelTrigger.dataset.value ?? DEFAULT_GEMINI_MODEL;
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

  function resolveThinkingLevel(model: string, preferred?: string): string {
    const levels: readonly string[] = getModelThinkingLevels(model);
    if (preferred && levels.includes(preferred)) {
      return preferred;
    }
    const mapped = modelThinkingLevelMap[model];
    if (mapped && levels.includes(mapped)) {
      return mapped;
    }
    return levels[levels.length - 1] ?? 'high';
  }

  function updateThinkingOptions(model: string, preferredThinkingLevel?: string): void {
    const levels = getModelThinkingLevels(model);
    const selectedThinkingLevel = resolveThinkingLevel(model, preferredThinkingLevel);
    thinkingMenu.innerHTML = '';
    for (const level of [...levels].reverse()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dropup-item';
      btn.dataset.value = level;
      btn.textContent = THINKING_LABELS[level] ?? level;
      btn.setAttribute('aria-selected', level === selectedThinkingLevel ? 'true' : 'false');
      thinkingMenu.appendChild(btn);
    }
    selectDropupItem(
      thinkingDropup,
      thinkingTrigger,
      selectedThinkingLevel,
      THINKING_LABELS[selectedThinkingLevel] ?? selectedThinkingLevel,
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
        btn.textContent = getModelDisplayLabel(model);
        modelMenu.appendChild(btn);
      }
    }
  }

  modelTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = modelMenuController.isOpen();
    closeAllDropups();
    if (!wasOpen) {
      modelMenuController.setOpen(true);
    }
  });

  thinkingTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = thinkingMenuController.isOpen();
    closeAllDropups();
    if (!wasOpen) {
      thinkingMenuController.setOpen(true);
    }
  });

  modelMenu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest('.dropup-item') as HTMLElement | null;
    if (!item) {
      return;
    }
    const value = item.dataset.value ?? '';
    const label = item.textContent ?? value;
    selectDropupItem(modelDropup, modelTrigger, value, label);
    closeAllDropups();
    updateThinkingOptions(value);
  });

  thinkingMenu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest('.dropup-item') as HTMLElement | null;
    if (!item) {
      return;
    }
    const value = item.dataset.value ?? '';
    const label = item.textContent ?? value;
    selectDropupItem(thinkingDropup, thinkingTrigger, value, label);
    closeAllDropups();
  });

  shadowRoot.addEventListener('click', () => {
    closeAllDropups();
  });

  function applySettings(settingsValue: unknown, keepThinkingSelection = false): void {
    const settings = normalizeGeminiSettings(settingsValue);
    modelThinkingLevelMap = settings.modelThinkingLevelMap;
    applyCustomModels(settings.customModels);
    const preferred = keepThinkingSelection ? thinkingTrigger.dataset.value : undefined;
    updateThinkingOptions(selectedModelValue(), preferred);
  }

  applySettings(undefined);

  void chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY).then((stored) => {
    applySettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
  });

  chrome.storage.onChanged.addListener((changes) => {
    const settingsChange = changes[GEMINI_SETTINGS_STORAGE_KEY];
    if (!settingsChange) {
      return;
    }
    applySettings(settingsChange.newValue, true);
  });

  return {
    selectedModel(): string {
      return selectedModelValue();
    },
    selectedThinkingLevel(): string {
      return resolveThinkingLevel(selectedModelValue(), thinkingTrigger.dataset.value);
    },
    captureButton,
    extractTextButton,
    attachButton,
  };
}
