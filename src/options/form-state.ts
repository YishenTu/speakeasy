import {
  type GeminiSettings,
  type ThinkingLevel,
  getBuiltinGeminiModelByKey,
  parseCommaSeparatedList,
} from '../shared/settings';
import type { OptionsDom } from './dom';

const FLASH_MODEL = getBuiltinGeminiModelByKey('flash');
const FLASH_LITE_MODEL = getBuiltinGeminiModelByKey('flash-lite');
const PRO_MODEL = getBuiltinGeminiModelByKey('pro');
const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: 'Minimal (fastest)',
  low: 'Low',
  medium: 'Medium',
  high: 'High (deepest)',
};

export function initializeModelThinkingControls(dom: OptionsDom): void {
  dom.modelFlashNameInput.value = FLASH_MODEL.model;
  dom.modelFlashLiteNameInput.value = FLASH_LITE_MODEL.model;
  dom.modelProNameInput.value = PRO_MODEL.model;
  replaceThinkingLevelOptions(dom.modelFlashThinkingLevelSelect, FLASH_MODEL.thinkingLevels);
  replaceThinkingLevelOptions(
    dom.modelFlashLiteThinkingLevelSelect,
    FLASH_LITE_MODEL.thinkingLevels,
  );
  replaceThinkingLevelOptions(dom.modelProThinkingLevelSelect, PRO_MODEL.thinkingLevels);
}

export function applySettingsToForm(dom: OptionsDom, settings: GeminiSettings): void {
  initializeModelThinkingControls(dom);

  dom.apiKeyInput.value = settings.apiKey;
  dom.modelFlashThinkingLevelSelect.value = normalizeThinkingLevelForAllowed(
    settings.modelThinkingLevelMap[FLASH_MODEL.model],
    FLASH_MODEL.thinkingLevels,
    FLASH_MODEL.defaultThinkingLevel,
  );
  dom.modelFlashLiteThinkingLevelSelect.value = normalizeThinkingLevelForAllowed(
    settings.modelThinkingLevelMap[FLASH_LITE_MODEL.model],
    FLASH_LITE_MODEL.thinkingLevels,
    FLASH_LITE_MODEL.defaultThinkingLevel,
  );
  dom.modelProThinkingLevelSelect.value = normalizeThinkingLevelForAllowed(
    settings.modelThinkingLevelMap[PRO_MODEL.model],
    PRO_MODEL.thinkingLevels,
    PRO_MODEL.defaultThinkingLevel,
  );

  dom.systemInstructionInput.value = settings.systemInstruction;
  dom.storeInteractionsInput.checked = settings.storeInteractions;
  dom.maxToolRoundTripsInput.value = String(settings.maxToolRoundTrips);
  dom.pageTextExtractionEngineInput.value = settings.pageTextExtractionEngine;

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
  const modelThinkingLevelMap: Record<string, string> = {
    [FLASH_MODEL.model]: normalizeThinkingLevelForAllowed(
      dom.modelFlashThinkingLevelSelect.value,
      FLASH_MODEL.thinkingLevels,
      FLASH_MODEL.defaultThinkingLevel,
    ),
    [FLASH_LITE_MODEL.model]: normalizeThinkingLevelForAllowed(
      dom.modelFlashLiteThinkingLevelSelect.value,
      FLASH_LITE_MODEL.thinkingLevels,
      FLASH_LITE_MODEL.defaultThinkingLevel,
    ),
    [PRO_MODEL.model]: normalizeThinkingLevelForAllowed(
      dom.modelProThinkingLevelSelect.value,
      PRO_MODEL.thinkingLevels,
      PRO_MODEL.defaultThinkingLevel,
    ),
  };

  return {
    apiKey: dom.apiKeyInput.value.trim(),
    modelThinkingLevelMap,
    systemInstruction: dom.systemInstructionInput.value.trim(),
    storeInteractions: dom.storeInteractionsInput.checked,
    maxToolRoundTrips: Number(dom.maxToolRoundTripsInput.value),
    pageTextExtractionEngine: dom.pageTextExtractionEngineInput
      .value as GeminiSettings['pageTextExtractionEngine'],
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

function replaceThinkingLevelOptions(
  select: HTMLSelectElement,
  levels: readonly ThinkingLevel[],
): void {
  select.replaceChildren(...levels.map((level) => createThinkingOption(level)));
}

function createThinkingOption(level: ThinkingLevel): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = level;
  option.textContent = THINKING_LEVEL_LABELS[level] ?? level;
  return option;
}

function parseNullableNumber(raw: string): number | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeThinkingLevelForAllowed(
  raw: string | undefined,
  allowedLevels: readonly ThinkingLevel[],
  fallback: ThinkingLevel,
): ThinkingLevel {
  const normalized = raw?.trim().toLowerCase() as ThinkingLevel;
  return allowedLevels.includes(normalized) ? normalized : fallback;
}
