import type { GeminiSettings } from '../shared/settings';

export function validateSettings(settings: GeminiSettings): string | null {
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
