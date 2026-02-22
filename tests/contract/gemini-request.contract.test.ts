import { describe, expect, it } from 'bun:test';
import { composeGeminiInteractionRequest } from '../../src/background/gemini-request';
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

describe('Gemini interactions request contract', () => {
  it('builds a text-only request without optional config', () => {
    const settings = createBaseSettings();
    const input = [{ type: 'text', text: 'hello' }];

    const plan = composeGeminiInteractionRequest({
      settings,
      input,
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request).toEqual({
      model: settings.model,
      input,
      store: true,
      generation_config: {
        thinking_summaries: 'auto',
      },
    });
    expect(plan.tools).toEqual([]);
    expect(plan.functionCallingEnabled).toBe(false);
  });

  it('builds function-calling tools in interactions format', () => {
    const settings = createBaseSettings();
    settings.tools.functionCalling = true;

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'call get_current_time' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.tools).toEqual([
      {
        type: 'function',
        ...FUNCTION_DECLARATIONS[0],
      },
    ]);
    expect(plan.functionCallingEnabled).toBe(true);
  });

  it('builds native tool list config with file search and mcp servers', () => {
    const settings = createBaseSettings();
    settings.tools.googleSearch = true;
    settings.tools.codeExecution = true;
    settings.tools.urlContext = true;
    settings.tools.fileSearch = true;
    settings.tools.mcpServers = true;
    settings.fileSearchStoreNames = ['fileSearchStores/project'];
    settings.mcpServerUrls = ['https://mcp.example.com/sse'];

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'find docs' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.tools).toEqual([
      { type: 'google_search' },
      { type: 'code_execution' },
      { type: 'url_context' },
      {
        type: 'file_search',
        file_search_store_names: ['fileSearchStores/project'],
      },
      {
        type: 'mcp_server',
        name: 'mcp_server_1',
        url: 'https://mcp.example.com/sse',
      },
    ]);
  });

  it('rejects mixing function calling and native tools in interactions', () => {
    const settings = createBaseSettings();
    settings.tools.functionCalling = true;
    settings.tools.googleSearch = true;

    expect(() =>
      composeGeminiInteractionRequest({
        settings,
        input: [{ type: 'text', text: 'hello' }],
        functionDeclarations: FUNCTION_DECLARATIONS,
      }),
    ).toThrow(/function calling.*native tools/i);
  });

  it('includes previous interaction id, system instruction, and thinking config', () => {
    const settings = createBaseSettings();
    settings.systemInstruction = 'Be concise.';

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'hello' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
      previousInteractionId: 'int-1',
      thinkingLevel: 'high',
    });

    expect(plan.request.previous_interaction_id).toBe('int-1');
    expect(plan.request.system_instruction).toBe('Be concise.');
    expect(plan.request.generation_config).toEqual({
      thinking_level: 'high',
      thinking_summaries: 'auto',
    });
  });

  it('includes thinking summaries when thinking level is not provided', () => {
    const settings = createBaseSettings();

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'hello' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.generation_config).toEqual({
      thinking_summaries: 'auto',
    });
  });
});
