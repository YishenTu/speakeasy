import { type GeminiSettings, parseCommaSeparatedList } from '../shared/settings';
import type { OptionsDom } from './dom';

export function applySettingsToForm(dom: OptionsDom, settings: GeminiSettings): void {
  dom.apiKeyInput.value = settings.apiKey;
  dom.modelInput.value = settings.model;
  dom.systemInstructionInput.value = settings.systemInstruction;
  dom.maxToolRoundTripsInput.value = String(settings.maxToolRoundTrips);

  dom.toolGoogleSearch.checked = settings.tools.googleSearch;
  dom.toolGoogleMaps.checked = settings.tools.googleMaps;
  dom.toolCodeExecution.checked = settings.tools.codeExecution;
  dom.toolUrlContext.checked = settings.tools.urlContext;
  dom.toolFileSearch.checked = settings.tools.fileSearch;
  dom.toolMcpServers.checked = settings.tools.mcpServers;
  dom.toolFunctionCalling.checked = settings.tools.functionCalling;
  dom.toolComputerUse.checked = settings.tools.computerUse;

  dom.fileSearchStoreNamesInput.value = settings.fileSearchStoreNames.join(', ');
  dom.mcpServerUrlsInput.value = settings.mcpServerUrls.join(', ');
  dom.mapsLatitudeInput.value = settings.mapsLatitude === null ? '' : String(settings.mapsLatitude);
  dom.mapsLongitudeInput.value =
    settings.mapsLongitude === null ? '' : String(settings.mapsLongitude);
  dom.computerUseExcludedActionsInput.value = settings.computerUseExcludedActions.join(', ');
}

export function readFormState(dom: OptionsDom): Partial<GeminiSettings> {
  return {
    apiKey: dom.apiKeyInput.value.trim(),
    model: dom.modelInput.value.trim(),
    systemInstruction: dom.systemInstructionInput.value.trim(),
    maxToolRoundTrips: Number(dom.maxToolRoundTripsInput.value),
    tools: {
      googleSearch: dom.toolGoogleSearch.checked,
      googleMaps: dom.toolGoogleMaps.checked,
      codeExecution: dom.toolCodeExecution.checked,
      urlContext: dom.toolUrlContext.checked,
      fileSearch: dom.toolFileSearch.checked,
      mcpServers: dom.toolMcpServers.checked,
      functionCalling: dom.toolFunctionCalling.checked,
      computerUse: dom.toolComputerUse.checked,
    },
    fileSearchStoreNames: parseCommaSeparatedList(dom.fileSearchStoreNamesInput.value),
    mcpServerUrls: parseCommaSeparatedList(dom.mcpServerUrlsInput.value),
    mapsLatitude: parseNullableNumber(dom.mapsLatitudeInput.value),
    mapsLongitude: parseNullableNumber(dom.mapsLongitudeInput.value),
    computerUseExcludedActions: parseCommaSeparatedList(dom.computerUseExcludedActionsInput.value),
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
