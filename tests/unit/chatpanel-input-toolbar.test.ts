import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createInputToolbar } from '../../src/chatpanel/input-toolbar';
import { GEMINI_SETTINGS_STORAGE_KEY } from '../../src/shared/settings';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

interface ChromeStorageChange {
  newValue?: unknown;
}

describe('chatpanel input toolbar', () => {
  let dom: InstalledDomEnvironment | null = null;
  let onChangedListener: ((changes: Record<string, ChromeStorageChange>) => void) | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment();
    onChangedListener = null;
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('loads custom models and updates thinking levels after model selection', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        customModels: ['gemini-3.2-custom'],
      },
    });

    const shadowRoot = createToolbarShadowRoot();
    const toolbar = createInputToolbar(shadowRoot);
    await Promise.resolve();

    const customModelButton = shadowRoot.querySelector<HTMLElement>(
      '.dropup-item[data-value="gemini-3.2-custom"]',
    );
    expect(customModelButton).not.toBeNull();
    expect(toolbar.attachButton.id).toBe('speakeasy-attach');

    customModelButton?.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));

    expect(toolbar.selectedModel()).toBe('gemini-3.2-custom');
    expect(toolbar.selectedThinkingLevel()).toBe('high');
    const thinkingValues = Array.from(
      shadowRoot.querySelectorAll<HTMLElement>('#speakeasy-thinking-dropup .dropup-item'),
    ).map((node) => node.dataset.value);
    expect(thinkingValues).toEqual(['high', 'medium', 'low']);
  });

  it('refreshes custom model menu when settings change', async () => {
    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        customModels: ['gemini-3.2-alpha'],
      },
    });

    const shadowRoot = createToolbarShadowRoot();
    createInputToolbar(shadowRoot);
    await Promise.resolve();

    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-alpha"]')).not.toBeNull();

    onChangedListener?.({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        newValue: { customModels: ['gemini-3.2-beta'] },
      },
    });

    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-alpha"]')).toBeNull();
    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-beta"]')).not.toBeNull();
  });

  function installChromeStorageMock(initialValue: unknown): void {
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => initialValue,
        },
        onChanged: {
          addListener: (listener: (changes: Record<string, ChromeStorageChange>) => void) => {
            onChangedListener = listener;
          },
        },
      },
    };
  }

  function createToolbarShadowRoot(): ShadowRoot {
    const host = document.createElement('div');
    document.body.append(host);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <div class="dropup" id="speakeasy-model-dropup">
        <button class="dropup-trigger" type="button" data-value="gemini-3-flash-preview">Flash</button>
        <div class="dropup-menu">
          <button type="button" class="dropup-item" data-value="gemini-3-flash-preview" aria-selected="true">Flash</button>
          <button type="button" class="dropup-item" data-value="gemini-3.1-pro-preview">Pro</button>
        </div>
      </div>
      <div class="dropup" id="speakeasy-thinking-dropup">
        <button class="dropup-trigger" type="button" data-value="minimal">Min</button>
        <div class="dropup-menu">
          <button type="button" class="dropup-item" data-value="high">High</button>
          <button type="button" class="dropup-item" data-value="medium">Med</button>
          <button type="button" class="dropup-item" data-value="low">Low</button>
          <button type="button" class="dropup-item" data-value="minimal" aria-selected="true">Min</button>
        </div>
      </div>
      <button id="speakeasy-attach" type="button">Attach</button>
    `;
    return shadowRoot;
  }
});
