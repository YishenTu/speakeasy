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

  return null;
}
