import { describe, expect, it } from 'bun:test';
import { composeGeminiGenerateContentRequest } from '../../src/background/gemini-request';
import type { GeminiContent } from '../../src/background/types';
import { defaultGeminiSettings } from '../../src/shared/settings';

const FUNCTION_DECLARATIONS = [
  {
    name: 'get_current_time',
    description: 'Get current time',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

function createBaseSettings() {
  const settings = defaultGeminiSettings();
  settings.apiKey = 'dummy-key';
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
  settings.systemInstruction = '';
  return settings;
}

describe('Gemini request contract', () => {
  it('builds a text-only request without config', () => {
    const settings = createBaseSettings();
    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const plan = composeGeminiGenerateContentRequest({
      settings,
      contents,
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request).toEqual({
      model: settings.model,
      contents,
    });
    expect(plan.tools).toEqual([]);
    expect(plan.functionCallingEnabled).toBe(false);
  });

  it('builds function-calling request config', () => {
    const settings = createBaseSettings();
    settings.tools.functionCalling = true;

    const plan = composeGeminiGenerateContentRequest({
      settings,
      contents: [{ role: 'user', parts: [{ text: 'call get_current_time' }] }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.config?.tools).toEqual([{ functionDeclarations: FUNCTION_DECLARATIONS }]);
    expect(plan.request.config?.toolConfig).toEqual({
      functionCallingConfig: {
        mode: 'AUTO',
      },
    });
    expect(plan.functionCallingEnabled).toBe(true);
  });

  it('builds native tool list config with file search and mcp servers', () => {
    const settings = createBaseSettings();
    settings.tools.googleSearch = true;
    settings.tools.urlContext = true;
    settings.tools.fileSearch = true;
    settings.tools.mcpServers = true;
    settings.fileSearchStoreNames = ['fileSearchStores/project'];
    settings.mcpServerUrls = ['https://mcp.example.com/sse'];

    const plan = composeGeminiGenerateContentRequest({
      settings,
      contents: [{ role: 'user', parts: [{ text: 'find docs' }] }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.config?.tools).toEqual([
      { googleSearch: {} },
      { urlContext: {} },
      {
        fileSearch: {
          fileSearchStoreNames: ['fileSearchStores/project'],
        },
      },
      {
        mcpServers: [
          {
            name: 'mcp_server_1',
            streamableHttpTransport: {
              url: 'https://mcp.example.com/sse',
            },
          },
        ],
      },
    ]);
    expect(plan.request.config?.toolConfig).toBeUndefined();
  });

  it('adds maps retrieval latLng only when both coordinates exist', () => {
    const settingsWithCoords = createBaseSettings();
    settingsWithCoords.tools.googleMaps = true;
    settingsWithCoords.mapsLatitude = 37.422;
    settingsWithCoords.mapsLongitude = -122.084;

    const withCoords = composeGeminiGenerateContentRequest({
      settings: settingsWithCoords,
      contents: [{ role: 'user', parts: [{ text: 'nearby coffee' }] }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(withCoords.request.config?.toolConfig).toEqual({
      retrievalConfig: {
        latLng: {
          latitude: 37.422,
          longitude: -122.084,
        },
      },
    });

    const settingsMissingLongitude = createBaseSettings();
    settingsMissingLongitude.tools.googleMaps = true;
    settingsMissingLongitude.mapsLatitude = 37.422;
    settingsMissingLongitude.mapsLongitude = null;

    const missingLongitude = composeGeminiGenerateContentRequest({
      settings: settingsMissingLongitude,
      contents: [{ role: 'user', parts: [{ text: 'nearby coffee' }] }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(missingLongitude.request.config?.toolConfig).toBeUndefined();
  });

  it('preserves conversation content structure for thought-signature safety', () => {
    const settings = createBaseSettings();
    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [{ text: 'Solve 3x + 5 = 20' }],
      },
      {
        role: 'model',
        parts: [
          {
            thoughtSignature: 'sig-123',
            text: 'I can solve this.',
          },
        ],
      },
      {
        role: 'user',
        parts: [{ text: 'Only provide x.' }],
      },
    ];

    const plan = composeGeminiGenerateContentRequest({
      settings,
      contents,
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.contents).toBe(contents);
    expect(plan.request.contents).toEqual(contents);
    expect(plan.request.contents[1]?.parts[0]).toEqual({
      thoughtSignature: 'sig-123',
      text: 'I can solve this.',
    });
  });
});
