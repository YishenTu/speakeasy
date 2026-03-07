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
      slashCommands: [
        { name: 'summarize', prompt: 'Summarize:\n\n$ARGUMENTS' },
        { name: 'rewrite', prompt: 'Rewrite clearly.' },
      ],
      modelThinkingLevelMap: {
        'gemini-3-flash-preview': 'high',
        'gemini-3.1-flash-lite-preview': 'low',
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
    expect((document.getElementById('model-name-flash-lite') as HTMLInputElement).value).toBe(
      'gemini-3.1-flash-lite-preview',
    );
    expect(
      (document.getElementById('model-thinking-level-flash-lite') as HTMLSelectElement).value,
    ).toBe('low');
    expect((document.getElementById('model-name-pro') as HTMLInputElement).value).toBe(
      'gemini-3.1-pro-preview',
    );
    expect((document.getElementById('model-thinking-level-pro') as HTMLSelectElement).value).toBe(
      'high',
    );
    const slashRows = getSlashCommandRows();
    expect(slashRows).toHaveLength(2);
    expect(slashRows[0]?.nameInput.value).toBe('summarize');
    expect(slashRows[0]?.promptInput.value).toBe('Summarize:\n\n$ARGUMENTS');
    expect(slashRows[1]?.nameInput.value).toBe('rewrite');
    expect(slashRows[1]?.promptInput.value).toBe('Rewrite clearly.');
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
    (document.getElementById('model-thinking-level-flash-lite') as HTMLSelectElement).value =
      'high';
    (document.getElementById('model-thinking-level-pro') as HTMLSelectElement).value = 'medium';
    const addSlashCommandButton = document.getElementById('add-slash-command') as HTMLButtonElement;
    addSlashCommandButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    const slashRows = getSlashCommandRows();
    expect(slashRows).toHaveLength(1);
    const firstSlashRow = slashRows[0];
    if (!firstSlashRow) {
      throw new Error('Expected one slash command row.');
    }
    firstSlashRow.nameInput.value = '/summarize';
    firstSlashRow.promptInput.value = ' Summarize:\n\n$ARGUMENTS ';
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
          modelThinkingLevelMap?: Record<string, string>;
          maxToolRoundTrips?: number;
          pageTextExtractionEngine?: string;
          slashCommands?: Array<{ name: string; prompt: string }>;
        }
      | undefined;
    expect(persisted?.apiKey).toBe('live-key');
    expect(persisted?.model).toBe('gemini-3-flash-preview');
    expect(persisted?.modelThinkingLevelMap).toEqual({
      'gemini-3-flash-preview': 'low',
      'gemini-3.1-flash-lite-preview': 'high',
      'gemini-3.1-pro-preview': 'medium',
    });
    expect(persisted?.maxToolRoundTrips).toBe(4);
    expect(persisted?.pageTextExtractionEngine).toBe('readability');
    expect(persisted?.slashCommands).toEqual([
      {
        name: 'summarize',
        prompt: 'Summarize:\n\n$ARGUMENTS',
      },
    ]);
    expect(document.getElementById('save-status')?.textContent).toBe('Saved Gemini settings.');
  });

  it('shows slash command validation errors and skips writes on invalid submit', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    (document.getElementById('api-key') as HTMLInputElement).value = 'live-key';
    const addSlashCommandButton = document.getElementById('add-slash-command') as HTMLButtonElement;
    addSlashCommandButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    const slashRows = getSlashCommandRows();
    const firstSlashRow = slashRows[0];
    if (!firstSlashRow) {
      throw new Error('Expected one slash command row.');
    }
    firstSlashRow.nameInput.value = 'release notes';
    firstSlashRow.promptInput.value = 'Summarize these notes.';

    const form = document.getElementById('settings-form') as HTMLFormElement;
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushTasks();

    expect(document.getElementById('save-status')?.textContent).toBe(
      'Slash command names must be a single token using letters, numbers, hyphens, or underscores.',
    );
    expect(savedItems).toHaveLength(0);
  });

  it('keeps a valid slash command after reloading the settings page without a full form submit', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    const addSlashCommandButton = document.getElementById('add-slash-command') as HTMLButtonElement;
    addSlashCommandButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    let slashRows = getSlashCommandRows();
    const firstSlashRow = slashRows[0];
    if (!firstSlashRow) {
      throw new Error('Expected one slash command row.');
    }

    firstSlashRow.nameInput.value = 'summarize';
    firstSlashRow.nameInput.dispatchEvent(new testWindow.Event('input', { bubbles: true }));
    firstSlashRow.promptInput.value = 'Summarize:\n\n$ARGUMENTS';
    firstSlashRow.promptInput.dispatchEvent(new testWindow.Event('input', { bubbles: true }));
    await flushTasks();

    dom?.restore();
    dom = installDomTestEnvironment(buildOptionsPageFixtureHtml());
    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    slashRows = getSlashCommandRows();
    expect(slashRows).toHaveLength(1);
    expect(slashRows[0]?.nameInput.value).toBe('summarize');
    expect(slashRows[0]?.promptInput.value).toBe('Summarize:\n\n$ARGUMENTS');
  });

  it('switches a completed slash command row into summary card view when done is clicked', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    const addSlashCommandButton = document.getElementById('add-slash-command') as HTMLButtonElement;
    addSlashCommandButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    const slashRows = getSlashCommandRows();
    const firstSlashRow = slashRows[0];
    if (!firstSlashRow) {
      throw new Error('Expected one slash command row.');
    }

    firstSlashRow.nameInput.value = 'comment';
    firstSlashRow.nameInput.dispatchEvent(new testWindow.Event('input', { bubbles: true }));
    firstSlashRow.promptInput.value = 'Summarize the comments in Chinese.';
    firstSlashRow.promptInput.dispatchEvent(new testWindow.Event('input', { bubbles: true }));

    firstSlashRow.doneButton.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    await flushTasks();

    expect(firstSlashRow.summary.hidden).toBe(false);
    expect(firstSlashRow.editor.hidden).toBe(true);
    expect(firstSlashRow.titleNode.textContent).toBe('/comment');
    expect(firstSlashRow.previewNode.textContent).toBe('Summarize the comments in Chinese.');
  });

  it('shows validation error and skips writes when MCP servers are enabled', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    (document.getElementById('api-key') as HTMLInputElement).value = 'live-key';
    (document.getElementById('tool-google-search') as HTMLInputElement).checked = false;
    (document.getElementById('tool-code-execution') as HTMLInputElement).checked = false;
    (document.getElementById('tool-url-context') as HTMLInputElement).checked = false;
    (document.getElementById('tool-mcp-servers') as HTMLInputElement).checked = true;
    (document.getElementById('mcp-server-urls') as HTMLInputElement).value =
      'https://mcp.example.com/stream';

    const form = document.getElementById('settings-form') as HTMLFormElement;
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushTasks();

    expect(savedItems).toHaveLength(0);
    expect(document.getElementById('save-status')?.textContent).toBe(
      'Remote MCP is not supported in this extension yet.',
    );
  });

  it('normalizes unsupported stored active model values back to the default model', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    storedSettings = {
      apiKey: 'init-key',
      model: 'custom-legacy-model',
      modelThinkingLevelMap: {
        'gemini-3-flash-preview': 'minimal',
        'gemini-3.1-flash-lite-preview': 'minimal',
        'gemini-3.1-pro-preview': 'high',
      },
    };
    installChromeOptionsMock();
    await importFreshOptionsModule();
    await flushTasks();

    (document.getElementById('api-key') as HTMLInputElement).value = 'updated-key';
    const form = document.getElementById('settings-form') as HTMLFormElement;
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushTasks();

    const persisted = savedItems[0]?.[GEMINI_SETTINGS_STORAGE_KEY] as
      | {
          model?: string;
          apiKey?: string;
        }
      | undefined;
    expect(persisted?.apiKey).toBe('updated-key');
    expect(persisted?.model).toBe('gemini-3-flash-preview');
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
            storedSettings = items[GEMINI_SETTINGS_STORAGE_KEY] ?? storedSettings;
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
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
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
          <input id="model-name-flash-lite" />
          <select id="model-thinking-level-flash-lite"></select>
          <input id="model-name-pro" />
          <select id="model-thinking-level-pro"></select>
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
          <div id="slash-command-rows"></div>
          <button id="add-slash-command" type="button">Add slash command</button>
          <template id="slash-command-row-template">
            <div data-slash-command-row>
              <div data-slash-command-summary>
                <button type="button" data-edit-slash-command>Edit</button>
                <span data-slash-command-avatar></span>
                <span data-slash-command-title></span>
                <p data-slash-command-preview></p>
              </div>
              <div data-slash-command-editor hidden>
                <input data-slash-command-name />
                <textarea data-slash-command-prompt></textarea>
                <button type="button" data-done-slash-command>Done</button>
                <button type="button" data-remove-slash-command>Remove</button>
              </div>
            </div>
          </template>
        </form>
        <span id="version"></span>
        <p id="save-status"></p>
      </body>
    </html>
  `;
}

function getSlashCommandRows(): Array<{
  nameInput: HTMLInputElement;
  promptInput: HTMLTextAreaElement;
  summary: HTMLElement;
  editor: HTMLElement;
  titleNode: HTMLElement;
  previewNode: HTMLElement;
  doneButton: HTMLButtonElement;
}> {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slash-command-row]')).map(
    (row) => {
      const nameInput = row.querySelector<HTMLInputElement>('[data-slash-command-name]');
      const promptInput = row.querySelector<HTMLTextAreaElement>('[data-slash-command-prompt]');
      const summary = row.querySelector<HTMLElement>('[data-slash-command-summary]');
      const editor = row.querySelector<HTMLElement>('[data-slash-command-editor]');
      const titleNode = row.querySelector<HTMLElement>('[data-slash-command-title]');
      const previewNode = row.querySelector<HTMLElement>('[data-slash-command-preview]');
      const doneButton = row.querySelector<HTMLButtonElement>('[data-done-slash-command]');
      if (
        !nameInput ||
        !promptInput ||
        !summary ||
        !editor ||
        !titleNode ||
        !previewNode ||
        !doneButton
      ) {
        throw new Error('Slash command row is missing required inputs.');
      }

      return { nameInput, promptInput, summary, editor, titleNode, previewNode, doneButton };
    },
  );
}
