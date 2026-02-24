import { describe, expect, it } from 'bun:test';
import { composeGeminiInteractionRequest } from '../../src/background/features/gemini/gemini-request';
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

  it('builds native built-in tool list config', () => {
    const settings = createBaseSettings();
    settings.tools.googleSearch = true;
    settings.tools.codeExecution = true;
    settings.tools.urlContext = true;
    settings.tools.fileSearch = true;
    settings.fileSearchStoreNames = ['fileSearchStores/project'];

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
    ]);
  });

  it('builds mcp tool list in interactions format', () => {
    const settings = createBaseSettings();
    settings.model = 'gemini-2.5-flash';
    settings.tools.mcpServers = true;
    settings.mcpServerUrls = ['https://mcp.example.com/stream'];

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'query remote mcp' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.tools).toEqual([
      {
        type: 'mcp_server',
        name: 'mcp_server_1',
        url: 'https://mcp.example.com/stream',
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

  it('omits tools for function_result follow-up turns by default', () => {
    const settings = createBaseSettings();
    settings.tools.functionCalling = true;

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [
        {
          type: 'function_result',
          call_id: 'call-1',
          name: 'get_current_time',
          result: {
            iso: '2026-02-22T00:00:00.000Z',
          },
        },
      ],
      functionDeclarations: FUNCTION_DECLARATIONS,
      previousInteractionId: 'int-1',
    });

    expect(plan.request.tools).toBeUndefined();
    expect(plan.tools).toHaveLength(1);
  });

  it('uses the configured store flag', () => {
    const settings = createBaseSettings();
    settings.storeInteractions = false;
    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'hello' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });
    expect(plan.request.store).toBe(false);
  });
});
