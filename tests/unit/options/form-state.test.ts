import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getOptionsDom } from '../../../src/options/dom';
import {
  addSlashCommandRow,
  applySettingsToForm,
  initializeModelThinkingControls,
  readFormState,
} from '../../../src/options/form-state';
import { defaultGeminiSettings } from '../../../src/shared/settings';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

describe('options form state', () => {
  let installedDom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    installedDom = installDomTestEnvironment(buildOptionsFixtureHtml());
  });

  afterEach(() => {
    installedDom?.restore();
    installedDom = null;
  });

  it('applies settings into form fields', () => {
    const dom = getOptionsDom();
    const settings = defaultGeminiSettings();
    settings.apiKey = 'api-key';
    settings.modelThinkingLevelMap = {
      'gemini-3-flash-preview': 'medium',
      'gemini-3.1-flash-lite-preview': 'low',
      'gemini-3.1-pro-preview': 'low',
    };
    settings.systemInstruction = 'Be direct.';
    settings.storeInteractions = false;
    settings.maxToolRoundTrips = 9;
    settings.pageTextExtractionEngine = 'readability';
    settings.tools.googleSearch = false;
    settings.tools.googleMaps = true;
    settings.tools.codeExecution = false;
    settings.tools.urlContext = true;
    settings.tools.fileSearch = true;
    settings.tools.mcpServers = true;
    settings.tools.functionCalling = true;
    settings.tools.computerUse = false;
    settings.fileSearchStoreNames = ['store/a', 'store/b'];
    settings.mcpServerUrls = ['https://mcp.example.com/sse'];
    settings.mapsLatitude = 37.422;
    settings.mapsLongitude = -122.084;
    settings.computerUseExcludedActions = ['click', 'drag'];
    settings.slashCommands = [
      { name: 'summarize', prompt: 'Summarize this:\n\n$ARGUMENTS' },
      { name: 'rewrite', prompt: 'Rewrite the text clearly.' },
    ];

    applySettingsToForm(dom, settings);

    expect(dom.apiKeyInput.value).toBe('api-key');
    expect(dom.modelFlashNameInput.value).toBe('gemini-3-flash-preview');
    expect(dom.modelFlashThinkingLevelSelect.value).toBe('medium');
    expect(dom.modelFlashLiteNameInput.value).toBe('gemini-3.1-flash-lite-preview');
    expect(dom.modelFlashLiteThinkingLevelSelect.value).toBe('low');
    expect(dom.modelProNameInput.value).toBe('gemini-3.1-pro-preview');
    expect(dom.modelProThinkingLevelSelect.value).toBe('low');
    expect(dom.systemInstructionInput.value).toBe('Be direct.');
    expect(dom.storeInteractionsInput.checked).toBe(false);
    expect(dom.maxToolRoundTripsInput.value).toBe('9');
    expect(dom.pageTextExtractionEngineInput.value).toBe('readability');
    expect(dom.toolGoogleSearch.checked).toBe(false);
    expect(dom.toolGoogleMaps.checked).toBe(true);
    expect(dom.toolCodeExecution.checked).toBe(false);
    expect(dom.toolUrlContext.checked).toBe(true);
    expect(dom.toolFileSearch.checked).toBe(true);
    expect(dom.toolMcpServers.checked).toBe(true);
    expect(dom.toolFunctionCalling.checked).toBe(true);
    expect(dom.toolComputerUse.checked).toBe(false);
    expect(dom.fileSearchStoreNamesInput.value).toBe('store/a, store/b');
    expect(dom.mcpServerUrlsInput.value).toBe('https://mcp.example.com/sse');
    expect(dom.mapsLatitudeInput.value).toBe('37.422');
    expect(dom.mapsLongitudeInput.value).toBe('-122.084');
    expect(dom.computerUseExcludedActionsInput.value).toBe('click, drag');
    const slashRows = getSlashRows(dom);
    expect(slashRows).toHaveLength(2);
    expect(slashRows[0]?.nameInput.value).toBe('summarize');
    expect(slashRows[0]?.promptInput.value).toBe('Summarize this:\n\n$ARGUMENTS');
    expect(slashRows[1]?.nameInput.value).toBe('rewrite');
    expect(slashRows[1]?.promptInput.value).toBe('Rewrite the text clearly.');
    expect(slashRows[0]?.titleNode.textContent).toBe('/summarize');
    expect(slashRows[0]?.previewNode.textContent).toBe('Summarize this:\n\n$ARGUMENTS');
    expect(slashRows[0]?.editor.hidden).toBe(true);
    expect(slashRows[0]?.summary.hidden).toBe(false);
  });

  it('writes empty map coordinate fields when settings hold null coordinates', () => {
    const dom = getOptionsDom();
    const settings = defaultGeminiSettings();
    settings.mapsLatitude = null;
    settings.mapsLongitude = null;

    applySettingsToForm(dom, settings);

    expect(dom.mapsLatitudeInput.value).toBe('');
    expect(dom.mapsLongitudeInput.value).toBe('');
  });

  it('reads and normalizes form state into partial settings', () => {
    const dom = getOptionsDom();
    initializeModelThinkingControls(dom);
    dom.apiKeyInput.value = '  key-123  ';
    dom.modelFlashThinkingLevelSelect.value = 'low';
    dom.modelFlashLiteThinkingLevelSelect.value = 'high';
    dom.modelProThinkingLevelSelect.value = 'high';
    dom.systemInstructionInput.value = '  Use tools when needed. ';
    dom.storeInteractionsInput.checked = true;
    dom.maxToolRoundTripsInput.value = '7';
    dom.pageTextExtractionEngineInput.value = 'readability';
    dom.toolGoogleSearch.checked = true;
    dom.toolGoogleMaps.checked = false;
    dom.toolCodeExecution.checked = true;
    dom.toolUrlContext.checked = false;
    dom.toolFileSearch.checked = true;
    dom.toolMcpServers.checked = false;
    dom.toolFunctionCalling.checked = false;
    dom.toolComputerUse.checked = false;
    dom.fileSearchStoreNamesInput.value = ' store/a, store/b, store/a ';
    dom.mcpServerUrlsInput.value = ' https://mcp.one/sse, https://mcp.two/sse ';
    dom.mapsLatitudeInput.value = ' 37.422 ';
    dom.mapsLongitudeInput.value = ' -122.084 ';
    dom.computerUseExcludedActionsInput.value = ' click, drag, click ';
    addSlashCommandRow(dom, ' summarize ', ' Summarize:\n\n$ARGUMENTS ');
    addSlashCommandRow(dom, '/rewrite', ' Rewrite clearly. ');

    const state = readFormState(dom);

    expect(state).toEqual({
      apiKey: 'key-123',
      modelThinkingLevelMap: {
        'gemini-3-flash-preview': 'low',
        'gemini-3.1-flash-lite-preview': 'high',
        'gemini-3.1-pro-preview': 'high',
      },
      systemInstruction: 'Use tools when needed.',
      storeInteractions: true,
      maxToolRoundTrips: 7,
      pageTextExtractionEngine: 'readability',
      tools: {
        googleSearch: true,
        googleMaps: false,
        codeExecution: true,
        urlContext: false,
        fileSearch: true,
        mcpServers: false,
        functionCalling: false,
        computerUse: false,
      },
      fileSearchStoreNames: ['store/a', 'store/b'],
      mcpServerUrls: ['https://mcp.one/sse', 'https://mcp.two/sse'],
      mapsLatitude: 37.422,
      mapsLongitude: -122.084,
      computerUseExcludedActions: ['click', 'drag'],
      slashCommands: [
        {
          name: 'summarize',
          prompt: 'Summarize:\n\n$ARGUMENTS',
        },
        {
          name: 'rewrite',
          prompt: 'Rewrite clearly.',
        },
      ],
    });
  });

  it('parses empty or invalid coordinates as null', () => {
    const dom = getOptionsDom();
    initializeModelThinkingControls(dom);
    dom.mapsLatitudeInput.value = ' ';
    dom.mapsLongitudeInput.value = 'Infinity';

    const state = readFormState(dom);

    expect(state.mapsLatitude).toBeNull();
    expect(state.mapsLongitude).toBeNull();
  });

  it('falls back to model defaults when select values are unsupported', () => {
    const dom = getOptionsDom();
    initializeModelThinkingControls(dom);
    dom.modelFlashThinkingLevelSelect.replaceChildren(
      createOption('ultra', 'Ultra'),
      createOption('minimal', 'Minimal'),
    );
    dom.modelFlashThinkingLevelSelect.value = 'ultra';
    dom.modelFlashLiteThinkingLevelSelect.replaceChildren(
      createOption('ultra', 'Ultra'),
      createOption('minimal', 'Minimal'),
    );
    dom.modelFlashLiteThinkingLevelSelect.value = 'ultra';
    dom.modelProThinkingLevelSelect.replaceChildren(
      createOption('ultra', 'Ultra'),
      createOption('high', 'High'),
    );
    dom.modelProThinkingLevelSelect.value = 'ultra';

    const state = readFormState(dom);

    expect(state.modelThinkingLevelMap).toEqual({
      'gemini-3-flash-preview': 'minimal',
      'gemini-3.1-flash-lite-preview': 'minimal',
      'gemini-3.1-pro-preview': 'high',
    });
  });

  it('adds a new slash command row in view mode and updates the summary content', () => {
    const dom = getOptionsDom();
    const row = addSlashCommandRow(dom, 'summarize', 'Summarize this.');

    const slashRows = getSlashRows(dom);
    expect(slashRows).toHaveLength(1);
    expect(slashRows[0]?.row).toBe(row);
    expect(slashRows[0]?.editor.hidden).toBe(true);
    expect(slashRows[0]?.summary.hidden).toBe(false);
    expect(slashRows[0]?.titleNode.textContent).toBe('/summarize');
    expect(slashRows[0]?.previewNode.textContent).toBe('Summarize this.');
  });
});

function createOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function requireInRow<TElement extends Element>(row: HTMLElement, selector: string): TElement {
  const element = row.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`row is missing ${selector}`);
  }
  return element;
}

interface SlashCommandRow {
  row: HTMLElement;
  nameInput: HTMLInputElement;
  promptInput: HTMLTextAreaElement;
  summary: HTMLElement;
  editor: HTMLElement;
  titleNode: HTMLElement;
  previewNode: HTMLElement;
}

function getSlashRows(dom: ReturnType<typeof getOptionsDom>): SlashCommandRow[] {
  return Array.from(
    dom.slashCommandRowsContainer.querySelectorAll<HTMLElement>('[data-slash-command-row]'),
  ).map(
    (row): SlashCommandRow => ({
      row,
      nameInput: requireInRow<HTMLInputElement>(row, '[data-slash-command-name]'),
      promptInput: requireInRow<HTMLTextAreaElement>(row, '[data-slash-command-prompt]'),
      summary: requireInRow<HTMLElement>(row, '[data-slash-command-summary]'),
      editor: requireInRow<HTMLElement>(row, '[data-slash-command-editor]'),
      titleNode: requireInRow<HTMLElement>(row, '[data-slash-command-title]'),
      previewNode: requireInRow<HTMLElement>(row, '[data-slash-command-preview]'),
    }),
  );
}

function buildOptionsFixtureHtml(): string {
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
          <input id="max-tool-round-trips" />
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
          <span id="version"></span>
          <p id="save-status"></p>
        </form>
      </body>
    </html>
  `;
}
