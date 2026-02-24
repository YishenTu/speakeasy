import {
  CUSTOM_MODEL_THINKING_LEVELS,
  DEFAULT_CUSTOM_MODEL_THINKING_LEVEL,
  type GeminiSettings,
  type ThinkingLevel,
  getBuiltinGeminiModelByKey,
  parseCommaSeparatedList,
} from '../shared/settings';
import type { OptionsDom } from './dom';

const FLASH_MODEL = getBuiltinGeminiModelByKey('flash');
const PRO_MODEL = getBuiltinGeminiModelByKey('pro');
const CUSTOM_MODEL_ROW_SELECTOR = '[data-custom-model-row]';
const CUSTOM_MODEL_INPUT_SELECTOR = '[data-custom-model-input]';
const CUSTOM_MODEL_THINKING_LEVEL_SELECTOR = '[data-custom-model-thinking-level]';
const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: 'Minimal (fastest)',
  low: 'Low',
  medium: 'Medium',
  high: 'High (deepest)',
};

export function initializeModelThinkingControls(dom: OptionsDom): void {
  dom.modelFlashNameInput.value = FLASH_MODEL.model;
  dom.modelProNameInput.value = PRO_MODEL.model;
  replaceThinkingLevelOptions(dom.modelFlashThinkingLevelSelect, FLASH_MODEL.thinkingLevels);
  replaceThinkingLevelOptions(dom.modelProThinkingLevelSelect, PRO_MODEL.thinkingLevels);

  const templateThinkingLevelSelect = queryRequiredInTemplate<HTMLSelectElement>(
    dom.customModelRowTemplate,
    CUSTOM_MODEL_THINKING_LEVEL_SELECTOR,
  );
  replaceThinkingLevelOptions(templateThinkingLevelSelect, CUSTOM_MODEL_THINKING_LEVELS);
}

export function applySettingsToForm(dom: OptionsDom, settings: GeminiSettings): void {
  initializeModelThinkingControls(dom);

  dom.apiKeyInput.value = settings.apiKey;
  dom.modelFlashThinkingLevelSelect.value = normalizeThinkingLevelForAllowed(
    settings.modelThinkingLevelMap[FLASH_MODEL.model],
    FLASH_MODEL.thinkingLevels,
    FLASH_MODEL.defaultThinkingLevel,
  );
  dom.modelProThinkingLevelSelect.value = normalizeThinkingLevelForAllowed(
    settings.modelThinkingLevelMap[PRO_MODEL.model],
    PRO_MODEL.thinkingLevels,
    PRO_MODEL.defaultThinkingLevel,
  );
  replaceCustomModelRows(dom, settings.customModels, settings.modelThinkingLevelMap);

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
    [PRO_MODEL.model]: normalizeThinkingLevelForAllowed(
      dom.modelProThinkingLevelSelect.value,
      PRO_MODEL.thinkingLevels,
      PRO_MODEL.defaultThinkingLevel,
    ),
  };
  const customModels: string[] = [];
  const seenModels = new Set<string>();

  for (const row of listCustomModelRows(dom)) {
    const modelInput = queryRequiredInRow<HTMLInputElement>(row, CUSTOM_MODEL_INPUT_SELECTOR);
    const thinkingLevelInput = queryRequiredInRow<HTMLSelectElement>(
      row,
      CUSTOM_MODEL_THINKING_LEVEL_SELECTOR,
    );
    const model = modelInput.value.trim();
    if (!model || seenModels.has(model)) {
      continue;
    }

    seenModels.add(model);
    customModels.push(model);
    modelThinkingLevelMap[model] = normalizeThinkingLevelForAllowed(
      thinkingLevelInput.value,
      CUSTOM_MODEL_THINKING_LEVELS,
      DEFAULT_CUSTOM_MODEL_THINKING_LEVEL,
    );
  }

  return {
    apiKey: dom.apiKeyInput.value.trim(),
    customModels,
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

export function addCustomModelRow(
  dom: OptionsDom,
  model = '',
  thinkingLevel: string | undefined = DEFAULT_CUSTOM_MODEL_THINKING_LEVEL,
): HTMLElement {
  const templateRoot = dom.customModelRowTemplate.content.firstElementChild as HTMLElement | null;
  if (!templateRoot) {
    throw new Error('Custom model row template must have a root element.');
  }

  const row = templateRoot.cloneNode(true) as HTMLElement;
  const thinkingLevelInput = queryRequiredInRow<HTMLSelectElement>(
    row,
    CUSTOM_MODEL_THINKING_LEVEL_SELECTOR,
  );
  if (thinkingLevelInput.options.length === 0) {
    replaceThinkingLevelOptions(thinkingLevelInput, CUSTOM_MODEL_THINKING_LEVELS);
  }

  queryRequiredInRow<HTMLInputElement>(row, CUSTOM_MODEL_INPUT_SELECTOR).value = model;
  thinkingLevelInput.value = normalizeThinkingLevelForAllowed(
    thinkingLevel,
    CUSTOM_MODEL_THINKING_LEVELS,
    DEFAULT_CUSTOM_MODEL_THINKING_LEVEL,
  );

  dom.customModelRowsContainer.appendChild(row);
  return row;
}

export function removeCustomModelRow(row: HTMLElement): void {
  row.remove();
}

function replaceCustomModelRows(
  dom: OptionsDom,
  customModels: readonly string[],
  modelThinkingLevelMap: Record<string, string>,
): void {
  dom.customModelRowsContainer.replaceChildren();
  for (const model of customModels) {
    addCustomModelRow(dom, model, modelThinkingLevelMap[model]);
  }
}

function listCustomModelRows(dom: OptionsDom): HTMLElement[] {
  return Array.from(
    dom.customModelRowsContainer.querySelectorAll<HTMLElement>(CUSTOM_MODEL_ROW_SELECTOR),
  );
}

function queryRequiredInRow<TElement extends Element>(
  row: HTMLElement,
  selector: string,
): TElement {
  const element = row.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Custom model row is missing required node: ${selector}`);
  }
  return element;
}

function queryRequiredInTemplate<TElement extends Element>(
  template: HTMLTemplateElement,
  selector: string,
): TElement {
  const element = template.content.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Custom model template is missing required node: ${selector}`);
  }
  return element;
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
