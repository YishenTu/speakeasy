export interface OptionsDom {
  form: HTMLFormElement;
  versionNode: HTMLElement;
  statusNode: HTMLElement;
  apiKeyInput: HTMLInputElement;
  modelInput: HTMLInputElement;
  systemInstructionInput: HTMLTextAreaElement;
  maxToolRoundTripsInput: HTMLInputElement;
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
    modelInput: queryRequiredElement<HTMLInputElement>('#model'),
    systemInstructionInput: queryRequiredElement<HTMLTextAreaElement>('#system-instruction'),
    maxToolRoundTripsInput: queryRequiredElement<HTMLInputElement>('#max-tool-round-trips'),
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

export function setStatus(
  statusNode: HTMLElement,
  message: string,
  tone: 'success' | 'error' | 'info',
): void {
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
