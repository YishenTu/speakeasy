import type { GeminiSettings } from './settings';

export function validateGeminiToolConfiguration(settings: GeminiSettings): string | null {
  if (settings.tools.fileSearch && settings.fileSearchStoreNames.length === 0) {
    return 'File Search is enabled but no file store names are configured.';
  }

  if (settings.tools.mcpServers && settings.mcpServerUrls.length === 0) {
    return 'MCP servers are enabled but no MCP server URLs are configured.';
  }

  if (settings.tools.computerUse) {
    return 'Computer Use needs a dedicated action/screenshot loop and is not yet wired.';
  }

  if (settings.tools.googleMaps) {
    return 'Google Maps is not supported by the Interactions API in this extension yet.';
  }

  const usesNativeTools =
    settings.tools.googleSearch ||
    settings.tools.codeExecution ||
    settings.tools.urlContext ||
    settings.tools.fileSearch ||
    settings.tools.mcpServers;
  if (settings.tools.functionCalling && usesNativeTools) {
    return 'Function Calling cannot be combined with native tools in the Interactions API. Choose one mode.';
  }

  return null;
}
