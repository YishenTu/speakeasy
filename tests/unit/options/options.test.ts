import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { GEMINI_SETTINGS_STORAGE_KEY } from '../../../src/shared/settings';
import { createChromeStorageLocalMock } from '../helpers/chrome-mock';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

describe('options page bootstrap', () => {
  let dom: InstalledDomEnvironment | null = null;
  let savedItems: Record<string, unknown>[] = [];
  let storedSettings: unknown = {};

  beforeEach(() => {
    dom = installDomTestEnvironment(buildOptionsPageFixtureHtml());
    savedItems = [];
    storedSettings = {};
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('initializes form state and page metadata from storage', async () => {
    storedSettings = {
      apiKey: 'init-key',
      model: 'gemini-3.1-pro-preview',
      customModels: ['gemini-3.2-custom', 'gemini-3.2-beta'],
      modelThinkingLevelMap: {
        'gemini-3-flash-preview': 'high',
        'gemini-3.2-custom': 'medium',
        'gemini-3.2-beta': 'low',
      },
      maxToolRoundTrips: 7,
      pageTextExtractionEngine: 'readability',
    };
    installChromeOptionsMock();

    await importFreshOptionsModule();
    await flushTasks();

    expect(document.getElementById('version')?.textContent).toBe('9.9.9');
    expect((document.getElementById('api-key') as HTMLInputElement).value).toBe('init-key');
    expect((document.getElementById('model-name-flash') as HTMLInputElement).value).toBe(
      'gemini-3-flash-preview',
    );
    expect((document.getElementById('model-thinking-level-flash') as HTMLSelectElement).value).toBe(
      'high',
    );
    expect((document.getElementById('model-name-pro') as HTMLInputElement).value).toBe(
      'gemini-3.1-pro-preview',
    );
    expect((document.getElementById('model-thinking-level-pro') as HTMLSelectElement).value).toBe(
      'high',
    );
    const customRows = getCustomModelRows();
    expect(customRows).toHaveLength(2);
    expect(customRows[0]?.modelInput.value).toBe('gemini-3.2-custom');
    expect(customRows[0]?.thinkingLevelInput.value).toBe('medium');
    expect(customRows[1]?.modelInput.value).toBe('gemini-3.2-beta');
    expect(customRows[1]?.thinkingLevelInput.value).toBe('low');
    expect(
      (document.getElementById('page-text-extraction-engine') as HTMLSelectElement).value,
    ).toBe('readability');
    expect(document.getElementById('save-status')?.textContent).toBe('Ready.');
  });

  it('shows validation errors and skips writes on invalid submit', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    (document.getElementById('api-key') as HTMLInputElement).value = '';
    const form = document.getElementById('settings-form') as HTMLFormElement;
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushTasks();

    const statusNode = document.getElementById('save-status') as HTMLElement;
    expect(statusNode.textContent).toContain('API key is required');
    expect(statusNode.classList.contains('text-rose-300')).toBe(true);
    expect(savedItems).toHaveLength(0);
  });

  it('persists normalized settings and reports success on valid submit', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    (document.getElementById('api-key') as HTMLInputElement).value = 'live-key';
    (document.getElementById('model-thinking-level-flash') as HTMLSelectElement).value = 'low';
    (document.getElementById('model-thinking-level-pro') as HTMLSelectElement).value = 'medium';
    const addButton = document.getElementById('add-custom-model') as HTMLButtonElement;
    addButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    addButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    const customRows = getCustomModelRows();
    expect(customRows).toHaveLength(2);
    const firstCustomRow = customRows[0];
    const secondCustomRow = customRows[1];
    if (!firstCustomRow || !secondCustomRow) {
      throw new Error('Expected two custom model rows.');
    }

    firstCustomRow.modelInput.value = 'gemini-3.2-custom';
    firstCustomRow.thinkingLevelInput.value = 'high';
    secondCustomRow.modelInput.value = 'gemini-3.2-beta';
    secondCustomRow.thinkingLevelInput.value = 'low';
    (document.getElementById('max-tool-round-trips') as HTMLInputElement).value = '4';
    (document.getElementById('page-text-extraction-engine') as HTMLSelectElement).value =
      'readability';
    const form = document.getElementById('settings-form') as HTMLFormElement;
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushTasks();

    expect(savedItems).toHaveLength(1);
    const persisted = savedItems[0]?.[GEMINI_SETTINGS_STORAGE_KEY] as
      | {
          apiKey?: string;
          model?: string;
          customModels?: string[];
          modelThinkingLevelMap?: Record<string, string>;
          maxToolRoundTrips?: number;
          pageTextExtractionEngine?: string;
        }
      | undefined;
    expect(persisted?.apiKey).toBe('live-key');
    expect(persisted?.model).toBe('gemini-3-flash-preview');
    expect(persisted?.customModels).toEqual(['gemini-3.2-custom', 'gemini-3.2-beta']);
    expect(persisted?.modelThinkingLevelMap).toEqual({
      'gemini-3-flash-preview': 'low',
      'gemini-3.1-pro-preview': 'medium',
      'gemini-3.2-custom': 'high',
      'gemini-3.2-beta': 'low',
    });
    expect(persisted?.maxToolRoundTrips).toBe(4);
    expect(persisted?.pageTextExtractionEngine).toBe('readability');
    expect(document.getElementById('save-status')?.textContent).toBe('Saved Gemini settings.');
  });

  it('removes a custom model row when remove is clicked', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    const addButton = document.getElementById('add-custom-model') as HTMLButtonElement;
    addButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    addButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    expect(getCustomModelRows()).toHaveLength(2);

    const firstRemoveButton = document.querySelector<HTMLElement>('[data-remove-custom-model]');
    if (!firstRemoveButton) {
      throw new Error('First remove button is missing.');
    }
    firstRemoveButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));

    expect(getCustomModelRows()).toHaveLength(1);
  });

  function installChromeOptionsMock(): void {
    const storageState: Record<string, unknown> = {
      [GEMINI_SETTINGS_STORAGE_KEY]: storedSettings,
    };

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        getManifest: () => ({ version: '9.9.9' }),
      },
      storage: {
        local: createChromeStorageLocalMock(storageState, {
          onSet: async (items) => {
            savedItems.push(items);
          },
        }),
      },
    };
  }
});

async function importFreshOptionsModule(): Promise<void> {
  await import(`../../../src/options/options.ts?test=${crypto.randomUUID()}`);
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function buildOptionsPageFixtureHtml(): string {
  return `
    <!doctype html>
    <html>
      <body>
        <form id="settings-form">
          <input id="api-key" />
          <input id="model-name-flash" />
          <select id="model-thinking-level-flash"></select>
          <input id="model-name-pro" />
          <select id="model-thinking-level-pro"></select>
          <div id="custom-model-rows"></div>
          <button id="add-custom-model" type="button">Add custom model</button>
          <template id="custom-model-row-template">
            <div data-custom-model-row>
              <input data-custom-model-input />
              <select data-custom-model-thinking-level></select>
              <button type="button" data-remove-custom-model>Remove</button>
            </div>
          </template>
          <textarea id="system-instruction"></textarea>
          <input id="store-interactions" type="checkbox" />
          <input id="max-tool-round-trips" value="8" />
          <input id="page-text-extraction-engine" />
          <input id="tool-google-search" type="checkbox" />
          <input id="tool-google-maps" type="checkbox" />
          <input id="tool-code-execution" type="checkbox" />
          <input id="tool-url-context" type="checkbox" />
          <input id="tool-file-search" type="checkbox" />
          <input id="tool-mcp-servers" type="checkbox" />
          <input id="tool-function-calling" type="checkbox" />
          <input id="tool-computer-use" type="checkbox" />
          <input id="file-search-store-names" />
          <input id="mcp-server-urls" />
          <input id="maps-latitude" />
          <input id="maps-longitude" />
          <input id="computer-use-excluded-actions" />
        </form>
        <span id="version"></span>
        <p id="save-status"></p>
      </body>
    </html>
  `;
}

function getCustomModelRows(): Array<{
  modelInput: HTMLInputElement;
  thinkingLevelInput: HTMLSelectElement;
}> {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-custom-model-row]')).map(
    (row) => {
      const modelInput = row.querySelector<HTMLInputElement>('[data-custom-model-input]');
      const thinkingLevelInput = row.querySelector<HTMLSelectElement>(
        '[data-custom-model-thinking-level]',
      );
      if (!modelInput || !thinkingLevelInput) {
        throw new Error('Custom model row is missing required inputs.');
      }

      return { modelInput, thinkingLevelInput };
    },
  );
}
