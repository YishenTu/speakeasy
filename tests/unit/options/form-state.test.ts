import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getOptionsDom } from '../../../src/options/dom';
import {
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

  it('applies settings into form fields including multiple custom models', () => {
    const dom = getOptionsDom();
    const settings = defaultGeminiSettings();
    settings.apiKey = 'api-key';
    settings.customModels = ['gemini-3.2-custom', 'gemini-3.2-beta'];
    settings.modelThinkingLevelMap = {
      'gemini-3-flash-preview': 'medium',
      'gemini-3.1-pro-preview': 'low',
      'gemini-3.2-custom': 'high',
      'gemini-3.2-beta': 'low',
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

    applySettingsToForm(dom, settings);

    expect(dom.apiKeyInput.value).toBe('api-key');
    expect(dom.modelFlashNameInput.value).toBe('gemini-3-flash-preview');
    expect(dom.modelFlashThinkingLevelSelect.value).toBe('medium');
    expect(dom.modelProNameInput.value).toBe('gemini-3.1-pro-preview');
    expect(dom.modelProThinkingLevelSelect.value).toBe('low');

    const customRows = getCustomRows(dom);
    expect(customRows).toHaveLength(2);
    expect(customRows[0]?.modelInput.value).toBe('gemini-3.2-custom');
    expect(customRows[0]?.thinkingLevelInput.value).toBe('high');
    expect(customRows[1]?.modelInput.value).toBe('gemini-3.2-beta');
    expect(customRows[1]?.thinkingLevelInput.value).toBe('low');

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

  it('reads and normalizes multiple custom model rows into partial settings', () => {
    const dom = getOptionsDom();
    initializeModelThinkingControls(dom);
    dom.apiKeyInput.value = '  key-123  ';
    dom.modelFlashThinkingLevelSelect.value = 'low';
    dom.modelProThinkingLevelSelect.value = 'high';
    appendCustomModelRow(dom, '  gemini-3.2-custom  ', 'medium');
    appendCustomModelRow(dom, 'gemini-3.2-beta', 'low');
    appendCustomModelRow(dom, 'gemini-3.2-custom', 'high');
    appendCustomModelRow(dom, '   ', 'high');
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

    const state = readFormState(dom);

    expect(state).toEqual({
      apiKey: 'key-123',
      model: 'gemini-3-flash-preview',
      customModels: ['gemini-3.2-custom', 'gemini-3.2-beta'],
      modelThinkingLevelMap: {
        'gemini-3-flash-preview': 'low',
        'gemini-3.1-pro-preview': 'high',
        'gemini-3.2-custom': 'medium',
        'gemini-3.2-beta': 'low',
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
    dom.modelFlashThinkingLevelSelect.value = 'ultra';
    dom.modelProThinkingLevelSelect.value = 'ultra';
    appendCustomModelRow(dom, 'gemini-3.2-custom', 'ultra');
    const customRows = getCustomRows(dom);
    const firstCustomRow = customRows[0];
    if (!firstCustomRow) {
      throw new Error('Expected one custom model row.');
    }
    firstCustomRow.thinkingLevelInput.replaceChildren(
      createOption('ultra', 'Ultra'),
      createOption('high', 'High'),
    );
    firstCustomRow.thinkingLevelInput.value = 'ultra';

    const state = readFormState(dom);

    expect(state.modelThinkingLevelMap).toEqual({
      'gemini-3-flash-preview': 'minimal',
      'gemini-3.1-pro-preview': 'high',
      'gemini-3.2-custom': 'high',
    });
  });
});

function getCustomRows(dom: ReturnType<typeof getOptionsDom>): CustomModelRow[] {
  return Array.from(
    dom.customModelRowsContainer.querySelectorAll<HTMLElement>('[data-custom-model-row]'),
  ).map(
    (row): CustomModelRow => ({
      row,
      modelInput: requireInRow<HTMLInputElement>(row, '[data-custom-model-input]'),
      thinkingLevelInput: requireInRow<HTMLSelectElement>(
        row,
        '[data-custom-model-thinking-level]',
      ),
    }),
  );
}

function appendCustomModelRow(
  dom: ReturnType<typeof getOptionsDom>,
  model: string,
  thinkingLevel: string,
): void {
  const templateRoot = dom.customModelRowTemplate.content.firstElementChild as HTMLElement | null;
  if (!templateRoot) {
    throw new Error('custom model row template is missing root element');
  }

  const row = templateRoot.cloneNode(true) as HTMLElement;
  const modelInput = requireInRow<HTMLInputElement>(row, '[data-custom-model-input]');
  const thinkingLevelInput = requireInRow<HTMLSelectElement>(
    row,
    '[data-custom-model-thinking-level]',
  );
  modelInput.value = model;
  thinkingLevelInput.value = thinkingLevel;
  dom.customModelRowsContainer.appendChild(row);
}

function requireInRow<TElement extends Element>(row: HTMLElement, selector: string): TElement {
  const element = row.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`custom model row is missing ${selector}`);
  }
  return element;
}

function createOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

interface CustomModelRow {
  row: HTMLElement;
  modelInput: HTMLInputElement;
  thinkingLevelInput: HTMLSelectElement;
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
          <span id="version"></span>
          <p id="save-status"></p>
        </form>
      </body>
    </html>
  `;
}
