import { GEMINI_SETTINGS_STORAGE_KEY, normalizeGeminiSettings } from '../shared/settings';
import { queryRequiredElement } from './dom';

export interface InputToolbar {
  selectedModel(): string;
  selectedThinkingLevel(): string;
  attachButton: HTMLButtonElement;
}

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
  const attachButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-attach');

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

  return {
    selectedModel(): string {
      return modelTrigger.dataset.value ?? 'gemini-3-flash-preview';
    },
    selectedThinkingLevel(): string {
      return thinkingTrigger.dataset.value ?? 'minimal';
    },
    attachButton,
  };
}
