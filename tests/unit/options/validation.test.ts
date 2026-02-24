import { describe, expect, it } from 'bun:test';
import { validateSettings } from '../../../src/options/validation';
import { defaultGeminiSettings } from '../../../src/shared/settings';

function createValidSettings() {
  const settings = defaultGeminiSettings();
  settings.apiKey = 'test-api-key';
  settings.model = 'gemini-3-flash-preview';
  settings.tools = {
    googleSearch: false,
    googleMaps: false,
    codeExecution: false,
    urlContext: false,
    fileSearch: false,
    mcpServers: false,
    computerUse: false,
    functionCalling: false,
  };
  settings.fileSearchStoreNames = [];
  settings.mcpServerUrls = [];
  settings.mapsLatitude = null;
  settings.mapsLongitude = null;
  return settings;
}

describe('validateSettings', () => {
  it('requires API key and model', () => {
    const missingApiKey = createValidSettings();
    missingApiKey.apiKey = '';
    expect(validateSettings(missingApiKey)).toBe('Gemini API key is required.');

    const missingModel = createValidSettings();
    missingModel.model = '';
    expect(validateSettings(missingModel)).toBe('Gemini model is required.');
  });

  it('rejects google maps because interactions tooling does not support it yet', () => {
    const settings = createValidSettings();
    settings.tools.googleMaps = true;

    expect(validateSettings(settings)).toBe(
      'Google Maps is not supported by the Interactions API in this extension yet.',
    );
  });

  it('requires file search and mcp server configuration when those tools are enabled', () => {
    const fileSearch = createValidSettings();
    fileSearch.tools.fileSearch = true;
    expect(validateSettings(fileSearch)).toBe(
      'File Search is enabled but no file store names are configured.',
    );

    const mcp = createValidSettings();
    mcp.tools.mcpServers = true;
    expect(validateSettings(mcp)).toBe(
      'MCP servers are enabled but no MCP server URLs are configured.',
    );
  });

  it('rejects mixing function calling with native tools', () => {
    const settings = createValidSettings();
    settings.tools.functionCalling = true;
    settings.tools.googleSearch = true;

    expect(validateSettings(settings)).toBe(
      'Function Calling cannot be combined with native tools in the Interactions API. Choose one mode.',
    );
  });

  it('rejects combining MCP servers with built-in tools', () => {
    const settings = createValidSettings();
    settings.model = 'gemini-2.5-flash';
    settings.tools.mcpServers = true;
    settings.tools.googleSearch = true;
    settings.mcpServerUrls = ['https://mcp.example.com/stream'];

    expect(validateSettings(settings)).toBe(
      'MCP servers cannot be combined with built-in tools or local function calling in the Interactions API yet. Choose one mode.',
    );
  });

  it('rejects remote MCP on Gemini 3 models', () => {
    const settings = createValidSettings();
    settings.model = 'gemini-3-flash-preview';
    settings.tools.mcpServers = true;
    settings.mcpServerUrls = ['https://mcp.example.com/stream'];

    expect(validateSettings(settings)).toBe(
      'Remote MCP is not supported on Gemini 3 models yet. Use a Gemini 2.5 model for MCP server tools.',
    );
  });

  it('requires both or neither map coordinates', () => {
    const onlyLatitude = createValidSettings();
    onlyLatitude.mapsLatitude = 37.422;
    onlyLatitude.mapsLongitude = null;

    expect(validateSettings(onlyLatitude)).toBe(
      'Provide both maps latitude and longitude, or leave both empty.',
    );
  });

  it('allows computer use to pass through when explicitly enabled', () => {
    const settings = createValidSettings();
    settings.tools.computerUse = true;

    expect(validateSettings(settings)).toBeNull();
  });

  it('accepts valid settings', () => {
    const settings = createValidSettings();
    settings.tools.fileSearch = true;
    settings.fileSearchStoreNames = ['fileSearchStores/project'];
    settings.tools.computerUse = true;
    settings.mapsLatitude = 37.422;
    settings.mapsLongitude = -122.084;

    expect(validateSettings(settings)).toBeNull();
  });
});
