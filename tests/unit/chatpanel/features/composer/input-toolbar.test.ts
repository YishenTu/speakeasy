import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createInputToolbar } from '../../../../../src/chatpanel/features/composer/input-toolbar';
import { GEMINI_SETTINGS_STORAGE_KEY } from '../../../../../src/shared/settings';
import {
  type ChromeStorageChange,
  createChromeStorageLocalMock,
  createChromeStorageOnChangedMock,
} from '../../../helpers/chrome-mock';
import {
  type InstalledDomEnvironment,
  installDomTestEnvironment,
} from '../../../helpers/dom-test-env';
import { queryRequiredElement } from '../../../helpers/query-required-element';
import { createShadowRootFixture } from '../../../helpers/shadow-root-fixture';

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

  it('exposes toolbar action controls', async () => {
    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {},
    });

    const shadowRoot = createToolbarShadowRoot();
    const toolbar = createInputToolbar(shadowRoot);
    await Promise.resolve();

    expect(toolbar.captureButton.id).toBe('speakeasy-capture-full-page');
    expect(toolbar.extractTextButton.id).toBe('speakeasy-extract-page-text');
    expect(toolbar.attachButton.id).toBe('speakeasy-attach');
    expect(toolbar.videoUrlButton.id).toBe('speakeasy-attach-video-url');
  });

  it('toggles dropups and closes them when clicking outside menu controls', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {},
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
      [GEMINI_SETTINGS_STORAGE_KEY]: {},
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
  });

  it('uses mapped thinking defaults from settings', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        modelThinkingLevelMap: {
          'gemini-3.1-pro-preview': 'medium',
        },
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
    expect(toolbar.selectedThinkingLevel()).toBe('medium');
    expect(thinkingTrigger.dataset.value).toBe('medium');
    expect(thinkingTrigger.textContent?.trim()).toBe('Med');
  });

  it('updates selected thinking level when a menu item is clicked', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {},
    });

    const shadowRoot = createToolbarShadowRoot();
    const toolbar = createInputToolbar(shadowRoot);
    await Promise.resolve();

    const lowThinkingButton = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup .dropup-item[data-value="low"]',
    );
    const thinkingTrigger = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup .dropup-trigger',
    );

    lowThinkingButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));

    expect(toolbar.selectedThinkingLevel()).toBe('low');
    expect(thinkingTrigger.dataset.value).toBe('low');
    expect(thinkingTrigger.textContent?.trim()).toBe('Low');
  });

  it('resolves thinking level from model defaults when trigger state is empty', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        modelThinkingLevelMap: {
          'gemini-3.1-pro-preview': 'medium',
        },
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
    thinkingTrigger.removeAttribute('data-value');

    expect(toolbar.selectedThinkingLevel()).toBe('medium');
  });

  it('keeps selected thinking level after live settings updates', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {},
    });

    const shadowRoot = createToolbarShadowRoot();
    const toolbar = createInputToolbar(shadowRoot);
    await Promise.resolve();

    const proModelButton = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-model-dropup .dropup-item[data-value="gemini-3.1-pro-preview"]',
    );
    proModelButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));

    const lowThinkingButton = queryRequiredElement<HTMLElement>(
      shadowRoot,
      '#speakeasy-thinking-dropup .dropup-item[data-value="low"]',
    );
    lowThinkingButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(toolbar.selectedThinkingLevel()).toBe('low');

    emitChanged?.({
      [GEMINI_SETTINGS_STORAGE_KEY]: {
        newValue: {
          modelThinkingLevelMap: {
            'gemini-3.1-pro-preview': 'medium',
          },
        },
      },
    });
    await Promise.resolve();

    expect(toolbar.selectedThinkingLevel()).toBe('low');
  });

  it('ignores unrelated storage change events', async () => {
    installChromeStorageMock({
      [GEMINI_SETTINGS_STORAGE_KEY]: {},
    });

    const shadowRoot = createToolbarShadowRoot();
    createInputToolbar(shadowRoot);
    await Promise.resolve();

    emitChanged?.({
      unrelatedStorageKey: {
        newValue: {
          modelThinkingLevelMap: {
            'gemini-3.1-pro-preview': 'high',
          },
        },
      },
    });
    await Promise.resolve();

    const modelItems = shadowRoot.querySelectorAll('#speakeasy-model-dropup .dropup-item');
    expect(modelItems).toHaveLength(2);
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
    return createShadowRootFixture(`
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
      <button id="speakeasy-extract-page-text" type="button">TXT</button>
      <button id="speakeasy-attach" type="button">Attach</button>
      <button id="speakeasy-attach-video-url" type="button">URL</button>
    `);
  }
});
