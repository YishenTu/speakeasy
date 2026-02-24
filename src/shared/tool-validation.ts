import type { GeminiSettings } from './settings';

export interface GeminiToolValidationOptions {
  mcpModelValidationScope?: 'selected-model' | 'available-models';
}

export function validateGeminiToolConfiguration(
  settings: GeminiSettings,
  options?: GeminiToolValidationOptions,
): string | null {
  if (settings.tools.fileSearch && settings.fileSearchStoreNames.length === 0) {
    return 'File Search is enabled but no file store names are configured.';
  }

  if (settings.tools.mcpServers && settings.mcpServerUrls.length === 0) {
    return 'MCP servers are enabled but no MCP server URLs are configured.';
  }

  if (settings.tools.googleMaps) {
    return 'Google Maps is not supported by the Interactions API in this extension yet.';
  }

  const usesBuiltInTools =
    settings.tools.googleSearch ||
    settings.tools.codeExecution ||
    settings.tools.urlContext ||
    settings.tools.fileSearch ||
    settings.tools.computerUse;
  if (settings.tools.functionCalling && usesBuiltInTools) {
    return 'Function Calling cannot be combined with native tools in the Interactions API. Choose one mode.';
  }

  if (settings.tools.mcpServers && (settings.tools.functionCalling || usesBuiltInTools)) {
    return 'MCP servers cannot be combined with built-in tools or local function calling in the Interactions API yet. Choose one mode.';
  }

  if (settings.tools.mcpServers && !hasMcpCompatibleModel(settings, options)) {
    return 'Remote MCP is not supported on Gemini 3 models yet. Use a Gemini 2.5 model for MCP server tools.';
  }

  return null;
}

function hasMcpCompatibleModel(
  settings: GeminiSettings,
  options: GeminiToolValidationOptions | undefined,
): boolean {
  const scope = options?.mcpModelValidationScope ?? 'selected-model';
  const candidateModels = listMcpCandidateModels(settings, scope);
  return candidateModels.some((model) => !isGemini3Model(model));
}

function listMcpCandidateModels(
  settings: GeminiSettings,
  scope: NonNullable<GeminiToolValidationOptions['mcpModelValidationScope']>,
): string[] {
  const candidates =
    scope === 'available-models' ? [settings.model, ...settings.customModels] : [settings.model];
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

function isGemini3Model(model: string): boolean {
  return /^gemini-3(?:[.-]|$)/i.test(model.trim());
}
