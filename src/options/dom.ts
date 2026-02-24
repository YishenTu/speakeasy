export interface OptionsDom {
  form: HTMLFormElement;
  versionNode: HTMLElement;
  statusNode: HTMLElement;
  apiKeyInput: HTMLInputElement;
  modelFlashNameInput: HTMLInputElement;
  modelFlashThinkingLevelSelect: HTMLSelectElement;
  modelProNameInput: HTMLInputElement;
  modelProThinkingLevelSelect: HTMLSelectElement;
  customModelRowsContainer: HTMLElement;
  addCustomModelButton: HTMLButtonElement;
  customModelRowTemplate: HTMLTemplateElement;
  systemInstructionInput: HTMLTextAreaElement;
  storeInteractionsInput: HTMLInputElement;
  maxToolRoundTripsInput: HTMLInputElement;
  pageTextExtractionEngineInput: HTMLSelectElement;
  toolGoogleSearch: HTMLInputElement;
  toolGoogleMaps: HTMLInputElement;
  toolCodeExecution: HTMLInputElement;
  toolUrlContext: HTMLInputElement;
  toolFileSearch: HTMLInputElement;
  toolMcpServers: HTMLInputElement;
  toolFunctionCalling: HTMLInputElement;
  toolComputerUse: HTMLInputElement;
  fileSearchStoreNamesInput: HTMLInputElement;
  mcpServerUrlsInput: HTMLInputElement;
  mapsLatitudeInput: HTMLInputElement;
  mapsLongitudeInput: HTMLInputElement;
  computerUseExcludedActionsInput: HTMLInputElement;
}

export function getOptionsDom(): OptionsDom {
  return {
    form: queryRequiredElement<HTMLFormElement>('#settings-form'),
    versionNode: queryRequiredElement<HTMLElement>('#version'),
    statusNode: queryRequiredElement<HTMLElement>('#save-status'),
    apiKeyInput: queryRequiredElement<HTMLInputElement>('#api-key'),
    modelFlashNameInput: queryRequiredElement<HTMLInputElement>('#model-name-flash'),
    modelFlashThinkingLevelSelect: queryRequiredElement<HTMLSelectElement>(
      '#model-thinking-level-flash',
    ),
    modelProNameInput: queryRequiredElement<HTMLInputElement>('#model-name-pro'),
    modelProThinkingLevelSelect: queryRequiredElement<HTMLSelectElement>(
      '#model-thinking-level-pro',
    ),
    customModelRowsContainer: queryRequiredElement<HTMLElement>('#custom-model-rows'),
    addCustomModelButton: queryRequiredElement<HTMLButtonElement>('#add-custom-model'),
    customModelRowTemplate: queryRequiredElement<HTMLTemplateElement>('#custom-model-row-template'),
    systemInstructionInput: queryRequiredElement<HTMLTextAreaElement>('#system-instruction'),
    storeInteractionsInput: queryRequiredElement<HTMLInputElement>('#store-interactions'),
    maxToolRoundTripsInput: queryRequiredElement<HTMLInputElement>('#max-tool-round-trips'),
    pageTextExtractionEngineInput: queryRequiredElement<HTMLSelectElement>(
      '#page-text-extraction-engine',
    ),
    toolGoogleSearch: queryRequiredElement<HTMLInputElement>('#tool-google-search'),
    toolGoogleMaps: queryRequiredElement<HTMLInputElement>('#tool-google-maps'),
    toolCodeExecution: queryRequiredElement<HTMLInputElement>('#tool-code-execution'),
    toolUrlContext: queryRequiredElement<HTMLInputElement>('#tool-url-context'),
    toolFileSearch: queryRequiredElement<HTMLInputElement>('#tool-file-search'),
    toolMcpServers: queryRequiredElement<HTMLInputElement>('#tool-mcp-servers'),
    toolFunctionCalling: queryRequiredElement<HTMLInputElement>('#tool-function-calling'),
    toolComputerUse: queryRequiredElement<HTMLInputElement>('#tool-computer-use'),
    fileSearchStoreNamesInput: queryRequiredElement<HTMLInputElement>('#file-search-store-names'),
    mcpServerUrlsInput: queryRequiredElement<HTMLInputElement>('#mcp-server-urls'),
    mapsLatitudeInput: queryRequiredElement<HTMLInputElement>('#maps-latitude'),
    mapsLongitudeInput: queryRequiredElement<HTMLInputElement>('#maps-longitude'),
    computerUseExcludedActionsInput: queryRequiredElement<HTMLInputElement>(
      '#computer-use-excluded-actions',
    ),
  };
}

type StatusTone = 'success' | 'error' | 'info';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'text-emerald-300',
  error: 'text-rose-300',
  info: 'text-slate-300',
};

export function setStatus(statusNode: HTMLElement, message: string, tone: StatusTone): void {
  statusNode.textContent = message;
  statusNode.classList.remove('text-slate-300', 'text-emerald-300', 'text-rose-300');
  statusNode.classList.add(TONE_CLASSES[tone]);
}

function queryRequiredElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Options DOM is missing required node: ${selector}`);
  }

  return element;
}
