import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
  parseCommaSeparatedList,
} from '../shared/settings';

const form = queryRequiredElement<HTMLFormElement>('#settings-form');
const versionNode = queryRequiredElement<HTMLElement>('#version');
const statusNode = queryRequiredElement<HTMLElement>('#save-status');

const apiKeyInput = queryRequiredElement<HTMLInputElement>('#api-key');
const modelInput = queryRequiredElement<HTMLInputElement>('#model');
const systemInstructionInput = queryRequiredElement<HTMLTextAreaElement>('#system-instruction');
const maxToolRoundTripsInput = queryRequiredElement<HTMLInputElement>('#max-tool-round-trips');

const toolGoogleSearch = queryRequiredElement<HTMLInputElement>('#tool-google-search');
const toolGoogleMaps = queryRequiredElement<HTMLInputElement>('#tool-google-maps');
const toolCodeExecution = queryRequiredElement<HTMLInputElement>('#tool-code-execution');
const toolUrlContext = queryRequiredElement<HTMLInputElement>('#tool-url-context');
const toolFileSearch = queryRequiredElement<HTMLInputElement>('#tool-file-search');
const toolMcpServers = queryRequiredElement<HTMLInputElement>('#tool-mcp-servers');
const toolFunctionCalling = queryRequiredElement<HTMLInputElement>('#tool-function-calling');
const toolComputerUse = queryRequiredElement<HTMLInputElement>('#tool-computer-use');

const fileSearchStoreNamesInput = queryRequiredElement<HTMLInputElement>(
  '#file-search-store-names',
);
const mcpServerUrlsInput = queryRequiredElement<HTMLInputElement>('#mcp-server-urls');
const mapsLatitudeInput = queryRequiredElement<HTMLInputElement>('#maps-latitude');
const mapsLongitudeInput = queryRequiredElement<HTMLInputElement>('#maps-longitude');
const computerUseExcludedActionsInput = queryRequiredElement<HTMLInputElement>(
  '#computer-use-excluded-actions',
);

versionNode.textContent = chrome.runtime.getManifest().version;
void initializeForm();

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const nextSettings = normalizeGeminiSettings(readFormState());
  const validationError = validateSettings(nextSettings);
  if (validationError) {
    setStatus(validationError, 'error');
    return;
  }

  await chrome.storage.local.set({
    [GEMINI_SETTINGS_STORAGE_KEY]: nextSettings,
  });

  setStatus('Saved Gemini settings.', 'success');
});

async function initializeForm(): Promise<void> {
  const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
  const settings = normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
  applySettingsToForm(settings);
  setStatus('Ready.', 'info');
}

function applySettingsToForm(settings: GeminiSettings): void {
  apiKeyInput.value = settings.apiKey;
  modelInput.value = settings.model;
  systemInstructionInput.value = settings.systemInstruction;
  maxToolRoundTripsInput.value = String(settings.maxToolRoundTrips);

  toolGoogleSearch.checked = settings.tools.googleSearch;
  toolGoogleMaps.checked = settings.tools.googleMaps;
  toolCodeExecution.checked = settings.tools.codeExecution;
  toolUrlContext.checked = settings.tools.urlContext;
  toolFileSearch.checked = settings.tools.fileSearch;
  toolMcpServers.checked = settings.tools.mcpServers;
  toolFunctionCalling.checked = settings.tools.functionCalling;
  toolComputerUse.checked = settings.tools.computerUse;

  fileSearchStoreNamesInput.value = settings.fileSearchStoreNames.join(', ');
  mcpServerUrlsInput.value = settings.mcpServerUrls.join(', ');
  mapsLatitudeInput.value = settings.mapsLatitude === null ? '' : String(settings.mapsLatitude);
  mapsLongitudeInput.value = settings.mapsLongitude === null ? '' : String(settings.mapsLongitude);
  computerUseExcludedActionsInput.value = settings.computerUseExcludedActions.join(', ');
}

function readFormState(): Partial<GeminiSettings> {
  return {
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    systemInstruction: systemInstructionInput.value.trim(),
    maxToolRoundTrips: Number(maxToolRoundTripsInput.value),
    tools: {
      googleSearch: toolGoogleSearch.checked,
      googleMaps: toolGoogleMaps.checked,
      codeExecution: toolCodeExecution.checked,
      urlContext: toolUrlContext.checked,
      fileSearch: toolFileSearch.checked,
      mcpServers: toolMcpServers.checked,
      functionCalling: toolFunctionCalling.checked,
      computerUse: toolComputerUse.checked,
    },
    fileSearchStoreNames: parseCommaSeparatedList(fileSearchStoreNamesInput.value),
    mcpServerUrls: parseCommaSeparatedList(mcpServerUrlsInput.value),
    mapsLatitude: parseNullableNumber(mapsLatitudeInput.value),
    mapsLongitude: parseNullableNumber(mapsLongitudeInput.value),
    computerUseExcludedActions: parseCommaSeparatedList(computerUseExcludedActionsInput.value),
  };
}

function parseNullableNumber(raw: string): number | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateSettings(settings: GeminiSettings): string | null {
  if (!settings.apiKey) {
    return 'Gemini API key is required.';
  }

  if (!settings.model) {
    return 'Gemini model is required.';
  }

  const nativeToolFlags = [
    settings.tools.googleSearch,
    settings.tools.googleMaps,
    settings.tools.codeExecution,
    settings.tools.urlContext,
    settings.tools.fileSearch,
    settings.tools.mcpServers,
  ];
  const nativeToolCount = nativeToolFlags.filter(Boolean).length;

  if (settings.tools.functionCalling && nativeToolCount > 0) {
    return 'Function calling cannot be enabled with native Gemini tools in generateContent.';
  }

  if (settings.tools.fileSearch && settings.fileSearchStoreNames.length === 0) {
    return 'File Search is enabled but no file store names are configured.';
  }

  if (settings.tools.mcpServers && settings.mcpServerUrls.length === 0) {
    return 'MCP servers are enabled but no MCP server URLs are configured.';
  }

  if ((settings.mapsLatitude === null) !== (settings.mapsLongitude === null)) {
    return 'Provide both maps latitude and longitude, or leave both empty.';
  }

  if (settings.tools.computerUse) {
    return 'Computer Use needs a dedicated action/screenshot loop and is not wired yet.';
  }

  return null;
}

function setStatus(message: string, tone: 'success' | 'error' | 'info'): void {
  statusNode.textContent = message;
  statusNode.classList.remove('text-slate-300', 'text-emerald-300', 'text-rose-300');

  if (tone === 'success') {
    statusNode.classList.add('text-emerald-300');
    return;
  }

  if (tone === 'error') {
    statusNode.classList.add('text-rose-300');
    return;
  }

  statusNode.classList.add('text-slate-300');
}

function queryRequiredElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Options DOM is missing required node: ${selector}`);
  }

  return element;
}
