import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createInputToolbar } from '../../src/chatpanel/input-toolbar';
import { GEMINI_SETTINGS_STORAGE_KEY } from '../../src/shared/settings';
import {
  type ChromeStorageChange,
  createChromeStorageLocalMock,
  createChromeStorageOnChangedMock,
} from './helpers/chrome-mock';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

describe('chatpanel input toolbar', () => {
  let dom: InstalledDomEnvironment | null = null;
  let emitChanged: ((changes: Record<string, ChromeStorageChange>) => void) | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment();
    emitChanged = null;
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
    expect(toolbar.captureButton.id).toBe('speakeasy-capture-full-page');
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

    emitChanged?.({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        newValue: { customModels: ['gemini-3.2-beta'] },
      },
    });

    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-alpha"]')).toBeNull();
    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-beta"]')).not.toBeNull();
  });

  it('toggles dropups and closes them when clicking outside menu controls', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        customModels: [],
      },
    });

    const shadowRoot = createToolbarShadowRoot();
    createInputToolbar(shadowRoot);
    await Promise.resolve();

    const modelDropup = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-model-dropup');
    const thinkingDropup = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup',
    );
    const modelTrigger = queryRequiredElement<HTMLElement>(modelDropup, '.dropup-trigger');
    const thinkingTrigger = queryRequiredElement<HTMLElement>(thinkingDropup, '.dropup-trigger');

    modelTrigger.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(modelDropup.classList.contains('open')).toBe(true);
    expect(thinkingDropup.classList.contains('open')).toBe(false);

    modelTrigger.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(modelDropup.classList.contains('open')).toBe(false);

    modelTrigger.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    thinkingTrigger.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(modelDropup.classList.contains('open')).toBe(false);
    expect(thinkingDropup.classList.contains('open')).toBe(true);

    shadowRoot.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(modelDropup.classList.contains('open')).toBe(false);
    expect(thinkingDropup.classList.contains('open')).toBe(false);
  });

  it('updates built-in thinking options when selecting the pro model', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        customModels: [],
      },
    });

    const shadowRoot = createToolbarShadowRoot();
    const toolbar = createInputToolbar(shadowRoot);
    await Promise.resolve();

    const proModelButton = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-model-dropup .dropup-item[data-value="gemini-3.1-pro-preview"]',
    );
    proModelButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));

    const thinkingTrigger = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup .dropup-trigger',
    );
    expect(toolbar.selectedModel()).toBe('gemini-3.1-pro-preview');
    expect(toolbar.selectedThinkingLevel()).toBe('high');
    expect(thinkingTrigger.dataset.value).toBe('high');
    expect(thinkingTrigger.textContent?.trim()).toBe('High');

    const thinkingValues = Array.from(
      shadowRoot.querySelectorAll<HTMLElement>('#speakeasy-thinking-dropup .dropup-item'),
    ).map((node) => node.dataset.value);
    expect(thinkingValues).toEqual(['high', 'medium', 'low']);
    expect(
      shadowRoot
        .querySelector<HTMLElement>('#speakeasy-thinking-dropup .dropup-item[data-value="high"]')
        ?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      shadowRoot
        .querySelector<HTMLElement>('#speakeasy-thinking-dropup .dropup-item[data-value="low"]')
        ?.getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('updates selected thinking level when a menu item is clicked', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        customModels: [],
      },
    });

    const shadowRoot = createToolbarShadowRoot();
    const toolbar = createInputToolbar(shadowRoot);
    await Promise.resolve();

    const thinkingMenu = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup .dropup-menu',
    );
    const lowThinkingButton = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup .dropup-item[data-value="low"]',
    );
    const thinkingTrigger = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup .dropup-trigger',
    );

    thinkingMenu.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(toolbar.selectedThinkingLevel()).toBe('minimal');

    lowThinkingButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));

    expect(toolbar.selectedThinkingLevel()).toBe('low');
    expect(thinkingTrigger.dataset.value).toBe('low');
    expect(thinkingTrigger.textContent?.trim()).toBe('Low');
    expect(lowThinkingButton.getAttribute('aria-selected')).toBe('true');
    expect(
      shadowRoot
        .querySelector<HTMLElement>('#speakeasy-thinking-dropup .dropup-item[data-value="minimal"]')
        ?.getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('ignores unrelated storage change events', async () => {
    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        customModels: ['gemini-3.2-alpha'],
      },
    });

    const shadowRoot = createToolbarShadowRoot();
    createInputToolbar(shadowRoot);
    await Promise.resolve();

    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-alpha"]')).not.toBeNull();

    emitChanged?.({
      unrelatedStorageKey: {
        newValue: {
          customModels: ['gemini-3.2-beta'],
        },
      },
    });
    await Promise.resolve();

    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-alpha"]')).not.toBeNull();
    expect(shadowRoot.querySelector('.dropup-item[data-value="gemini-3.2-beta"]')).toBeNull();
  });

  function installChromeStorageMock(initialValue: Record<string, unknown>): void {
    const storageState = { ...initialValue };
    const onChangedMock = createChromeStorageOnChangedMock();
    emitChanged = (changes) => {
      onChangedMock.emitChanged(changes);
    };

    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: createChromeStorageLocalMock(storageState),
        onChanged: onChangedMock.onChanged,
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
      <button id="speakeasy-capture-full-page" type="button">Capture</button>
      <button id="speakeasy-attach" type="button">Attach</button>
    `;
    return shadowRoot;
  }
});

function queryRequiredElement<TElement extends Element>(
  root: ParentNode,
  selector: string,
): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Missing test element: ${selector}`);
  }

  return element;
}
