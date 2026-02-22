import { describe, expect, it } from 'bun:test';
import type { OptionsDom } from '../../src/options/dom';
import { applySettingsToForm, readFormState } from '../../src/options/form-state';
import { defaultGeminiSettings } from '../../src/shared/settings';

function createInput(value = '', checked = false): HTMLInputElement {
  return { value, checked } as HTMLInputElement;
}

function createTextArea(value = ''): HTMLTextAreaElement {
  return { value } as HTMLTextAreaElement;
}

function createOptionsDomStub(): OptionsDom {
  return {
    form: {} as HTMLFormElement,
    versionNode: {} as HTMLElement,
    statusNode: {} as HTMLElement,
    apiKeyInput: createInput(),
    modelInput: createInput(),
    systemInstructionInput: createTextArea(),
    storeInteractionsInput: createInput('', false),
    maxToolRoundTripsInput: createInput(),
    toolGoogleSearch: createInput('', false),
    toolGoogleMaps: createInput('', false),
    toolCodeExecution: createInput('', false),
    toolUrlContext: createInput('', false),
    toolFileSearch: createInput('', false),
    toolMcpServers: createInput('', false),
    toolFunctionCalling: createInput('', false),
    toolComputerUse: createInput('', false),
    fileSearchStoreNamesInput: createInput(),
    mcpServerUrlsInput: createInput(),
    mapsLatitudeInput: createInput(),
    mapsLongitudeInput: createInput(),
    computerUseExcludedActionsInput: createInput(),
  };
}

describe('options form state', () => {
  it('applies settings into form fields', () => {
    const dom = createOptionsDomStub();
    const settings = defaultGeminiSettings();
    settings.apiKey = 'api-key';
    settings.model = 'gemini-2.5-pro';
    settings.customModels = ['gemini-2.5-pro'];
    settings.systemInstruction = 'Be direct.';
    settings.storeInteractions = false;
    settings.maxToolRoundTrips = 9;
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
    expect(dom.modelInput.value).toBe('gemini-2.5-pro');
    expect(dom.systemInstructionInput.value).toBe('Be direct.');
    expect(dom.storeInteractionsInput.checked).toBe(false);
    expect(dom.maxToolRoundTripsInput.value).toBe('9');
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
    const dom = createOptionsDomStub();
    const settings = defaultGeminiSettings();
    settings.mapsLatitude = null;
    settings.mapsLongitude = null;

    applySettingsToForm(dom, settings);

    expect(dom.mapsLatitudeInput.value).toBe('');
    expect(dom.mapsLongitudeInput.value).toBe('');
  });

  it('reads and normalizes form values into partial settings', () => {
    const dom = createOptionsDomStub();
    dom.apiKeyInput.value = '  key-123  ';
    dom.modelInput.value = '  gemini-2.5-flash  ';
    dom.systemInstructionInput.value = '  Use tools when needed. ';
    dom.storeInteractionsInput.checked = true;
    dom.maxToolRoundTripsInput.value = '7';
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
      model: 'gemini-2.5-flash',
      customModels: ['gemini-2.5-flash'],
      systemInstruction: 'Use tools when needed.',
      storeInteractions: true,
      maxToolRoundTrips: 7,
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
    const dom = createOptionsDomStub();
    dom.mapsLatitudeInput.value = ' ';
    dom.mapsLongitudeInput.value = 'Infinity';

    const state = readFormState(dom);

    expect(state.mapsLatitude).toBeNull();
    expect(state.mapsLongitude).toBeNull();
  });
});
