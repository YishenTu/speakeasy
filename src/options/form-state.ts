import {
  type GeminiSettings,
  type ThinkingLevel,
  getBuiltinGeminiModelByKey,
  parseCommaSeparatedList,
} from '../shared/settings';
import { type SlashCommandDefinition, normalizeSlashCommandName } from '../shared/slash-commands';
import type { OptionsDom } from './dom';

const FLASH_MODEL = getBuiltinGeminiModelByKey('flash');
const FLASH_LITE_MODEL = getBuiltinGeminiModelByKey('flash-lite');
const PRO_MODEL = getBuiltinGeminiModelByKey('pro');
const SLASH_COMMAND_ROW_SELECTOR = '[data-slash-command-row]';
const SLASH_COMMAND_NAME_SELECTOR = '[data-slash-command-name]';
const SLASH_COMMAND_PROMPT_SELECTOR = '[data-slash-command-prompt]';
const SLASH_COMMAND_SUMMARY_SELECTOR = '[data-slash-command-summary]';
const SLASH_COMMAND_EDITOR_SELECTOR = '[data-slash-command-editor]';
const SLASH_COMMAND_TITLE_SELECTOR = '[data-slash-command-title]';
const SLASH_COMMAND_PREVIEW_SELECTOR = '[data-slash-command-preview]';
const SLASH_COMMAND_AVATAR_SELECTOR = '[data-slash-command-avatar]';
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
  replaceSlashCommandRows(dom, settings.slashCommands);

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
    slashCommands: readSlashCommandDrafts(dom),
  };
}

export function addSlashCommandRow(dom: OptionsDom, name = '', prompt = ''): HTMLElement {
  const templateRoot = dom.slashCommandRowTemplate.content.firstElementChild as HTMLElement | null;
  if (!templateRoot) {
    throw new Error('Slash command row template must have a root element.');
  }

  const row = templateRoot.cloneNode(true) as HTMLElement;
  queryRequiredInRow<HTMLInputElement>(row, SLASH_COMMAND_NAME_SELECTOR).value = name;
  queryRequiredInRow<HTMLTextAreaElement>(row, SLASH_COMMAND_PROMPT_SELECTOR).value = prompt;
  syncSlashCommandRowPresentation(row);
  dom.slashCommandRowsContainer.appendChild(row);
  return row;
}

export function removeSlashCommandRow(row: HTMLElement): void {
  row.remove();
}

export function readSlashCommandDraftFromRow(row: HTMLElement): SlashCommandDefinition {
  return {
    name: normalizeSlashCommandName(
      queryRequiredInRow<HTMLInputElement>(row, SLASH_COMMAND_NAME_SELECTOR).value,
    ),
    prompt: queryRequiredInRow<HTMLTextAreaElement>(
      row,
      SLASH_COMMAND_PROMPT_SELECTOR,
    ).value.trim(),
  };
}

export function readSlashCommandDrafts(dom: OptionsDom): SlashCommandDefinition[] {
  return listSlashCommandRows(dom)
    .map((row) => readSlashCommandDraftFromRow(row))
    .filter((command) => command.name.length > 0 || command.prompt.length > 0);
}

export function syncSlashCommandRowPresentation(row: HTMLElement): void {
  const draft = readSlashCommandDraftFromRow(row);
  queryRequiredInRow<HTMLElement>(row, SLASH_COMMAND_TITLE_SELECTOR).textContent = draft.name
    ? `/${draft.name}`
    : '/command';
  queryRequiredInRow<HTMLElement>(row, SLASH_COMMAND_PREVIEW_SELECTOR).textContent =
    draft.prompt || 'Describe what this command should do.';
  queryRequiredInRow<HTMLElement>(row, SLASH_COMMAND_AVATAR_SELECTOR).textContent = draft.name
    ? draft.name.charAt(0).toUpperCase()
    : '/';
}

export function setSlashCommandRowEditState(row: HTMLElement, isEditing: boolean): void {
  row.dataset.slashCommandMode = isEditing ? 'edit' : 'view';
  queryRequiredInRow<HTMLElement>(row, SLASH_COMMAND_SUMMARY_SELECTOR).hidden = isEditing;
  queryRequiredInRow<HTMLElement>(row, SLASH_COMMAND_EDITOR_SELECTOR).hidden = !isEditing;
}

export function focusSlashCommandRowNameInput(row: HTMLElement): void {
  queryRequiredInRow<HTMLInputElement>(row, SLASH_COMMAND_NAME_SELECTOR).focus();
}

function replaceSlashCommandRows(
  dom: OptionsDom,
  slashCommands: readonly SlashCommandDefinition[],
): void {
  dom.slashCommandRowsContainer.replaceChildren();
  for (const slashCommand of slashCommands) {
    addSlashCommandRow(dom, slashCommand.name, slashCommand.prompt);
  }
}

function listSlashCommandRows(dom: OptionsDom): HTMLElement[] {
  return Array.from(
    dom.slashCommandRowsContainer.querySelectorAll<HTMLElement>(SLASH_COMMAND_ROW_SELECTOR),
  );
}

function queryRequiredInRow<TElement extends Element>(
  row: HTMLElement,
  selector: string,
): TElement {
  const element = row.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Slash command row is missing required node: ${selector}`);
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
