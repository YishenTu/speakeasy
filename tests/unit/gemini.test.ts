import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  completeAssistantTurn,
  normalizeContent,
  renderContentForChat,
} from '../../src/background/gemini';
import {
  buildGeminiRequestToolSelection,
  composeGeminiGenerateContentRequest,
} from '../../src/background/gemini-request';
import type { ChatSession, GeminiContent } from '../../src/background/types';
import { defaultGeminiSettings } from '../../src/shared/settings';

const FUNCTION_DECLARATIONS = [
  {
    name: 'get_current_time',
    description: 'Return current time',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

function createSettingsForToolTests() {
  const settings = defaultGeminiSettings();
  settings.apiKey = `test-key-${crypto.randomUUID()}`;
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
  return settings;
}

const originalFetch = globalThis.fetch;
const originalChrome = (globalThis as { chrome?: unknown }).chrome;

let fetchResponseQueue: unknown[] = [];
const fetchRequestBodies: Array<Record<string, unknown>> = [];

function enqueueGeminiResponses(...responses: unknown[]): void {
  fetchResponseQueue.push(...responses);
}

function createSession(prompt = 'hello'): ChatSession {
  return {
    id: `session-${crypto.randomUUID()}`,
    createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  };
}

beforeEach(() => {
  fetchResponseQueue = [];
  fetchRequestBodies.length = 0;

  (globalThis as { fetch: typeof fetch }).fetch = (async (_input, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    fetchRequestBodies.push(body);

    if (fetchResponseQueue.length === 0) {
      throw new Error('Unexpected Gemini API request.');
    }

    const payload = fetchResponseQueue.shift();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      getManifest: () => ({
        name: 'Speakeasy',
        version: '1.2.3',
        description: 'Test extension',
      }),
    },
  };
});

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;

  if (originalChrome === undefined) {
    delete (globalThis as { chrome?: unknown }).chrome;
  } else {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

describe('buildGeminiRequestToolSelection', () => {
  it('rejects mixed native tools with function calling', () => {
    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    settings.tools.googleSearch = true;

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).toThrow(
      /cannot be enabled together/i,
    );
  });

  it('guards file search and mcp server configuration requirements', () => {
    const fileSearchSettings = createSettingsForToolTests();
    fileSearchSettings.tools.fileSearch = true;
    fileSearchSettings.fileSearchStoreNames = [];
    expect(() =>
      buildGeminiRequestToolSelection(fileSearchSettings, FUNCTION_DECLARATIONS),
    ).toThrow(/file search is enabled/i);

    const mcpSettings = createSettingsForToolTests();
    mcpSettings.tools.mcpServers = true;
    mcpSettings.mcpServerUrls = [];
    expect(() => buildGeminiRequestToolSelection(mcpSettings, FUNCTION_DECLARATIONS)).toThrow(
      /mcp servers are enabled/i,
    );
  });

  it('rejects computer use tool when backend loop is not available', () => {
    const settings = createSettingsForToolTests();
    settings.tools.computerUse = true;

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).toThrow(
      /not yet wired/i,
    );
  });
});

describe('renderContentForChat', () => {
  it('renders text, code execution output, and executable code blocks', () => {
    const content: GeminiContent = {
      role: 'model',
      parts: [
        { text: 'Result summary' },
        { codeExecutionResult: { output: '42\n' } },
        { executableCode: { language: 'python', code: 'print(42)' } },
        { code_execution_result: { output: 'from snake case' } },
        { executable_code: { language: 'JavaScript', code: 'console.log(7);' } },
      ],
    };

    const rendered = renderContentForChat(content);

    expect(rendered).toContain('Result summary');
    expect(rendered).toContain('Code output:\n42');
    expect(rendered).toContain('```python\nprint(42)\n```');
    expect(rendered).toContain('Code output:\nfrom snake case');
    expect(rendered).toContain('```javascript\nconsole.log(7);\n```');
  });

  it('uses text language fallback and ignores empty display parts', () => {
    const content: GeminiContent = {
      role: 'model',
      parts: [
        { text: '   ' },
        { codeExecutionResult: { output: '   ' } },
        { executableCode: { language: ' ', code: 'x = 1' } },
      ],
    };

    expect(renderContentForChat(content)).toBe('```text\nx = 1\n```');
  });
});

describe('normalizeContent', () => {
  it('throws for non-object payloads and empty parts', () => {
    expect(() => normalizeContent(null)).toThrow(/json object/i);
    expect(() => normalizeContent({ role: 'model', parts: ['bad'] })).toThrow(/no parts/i);
  });

  it('keeps known roles and defaults unknown roles to model', () => {
    const userContent = normalizeContent({ role: 'user', parts: [{ text: 'hi' }] });
    expect(userContent.role).toBe('user');

    const defaultedRole = normalizeContent({ role: 'system', parts: [{ text: 'hi' }] });
    expect(defaultedRole.role).toBe('model');
  });
});

describe('composeGeminiGenerateContentRequest', () => {
  it('adds system instructions to request config when provided', () => {
    const settings = createSettingsForToolTests();
    settings.systemInstruction = 'Be concise.';

    const plan = composeGeminiGenerateContentRequest({
      settings,
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.config?.systemInstruction).toEqual({
      parts: [{ text: 'Be concise.' }],
    });
  });
});

describe('completeAssistantTurn', () => {
  it('returns first assistant response when no function calls are present', async () => {
    enqueueGeminiResponses({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Direct answer' }],
          },
        },
      ],
    });

    const session = createSession();
    const settings = createSettingsForToolTests();

    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([{ text: 'Direct answer' }]);
    expect(session.contents).toHaveLength(2);
    expect(fetchRequestBodies).toHaveLength(1);
  });

  it('handles function calls and appends function responses before final answer', async () => {
    enqueueGeminiResponses(
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  function_call: {
                    id: 'tool-call-1',
                    name: 'get_extension_info',
                    args: '{"ignored":true}',
                  },
                },
              ],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Done after tool call' }],
            },
          },
        ],
      },
    );

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    const session = createSession('tool call please');

    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([{ text: 'Done after tool call' }]);
    expect(session.contents).toHaveLength(4);
    expect(session.contents[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'tool-call-1',
            name: 'get_extension_info',
            response: {
              name: 'Speakeasy',
              version: '1.2.3',
              description: 'Test extension',
            },
          },
        },
      ],
    });
    expect(fetchRequestBodies).toHaveLength(2);
  });

  it('returns tool error responses for unknown tools and malformed JSON args', async () => {
    enqueueGeminiResponses({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { id: 'x', name: 'missing_tool', args: 'not json' } }],
          },
        },
      ],
    });

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    settings.maxToolRoundTrips = 1;
    const session = createSession();

    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([
      { functionCall: { id: 'x', name: 'missing_tool', args: 'not json' } },
    ]);
    expect(session.contents[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'x',
            name: 'missing_tool',
            response: { error: 'Unknown function: missing_tool' },
          },
        },
      ],
    });
  });

  it('captures tool runtime errors as function responses', async () => {
    enqueueGeminiResponses({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'bad-tz',
                  name: 'get_current_time',
                  args: { timeZone: 'Invalid/Time_Zone' },
                },
              },
            ],
          },
        },
      ],
    });

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    settings.maxToolRoundTrips = 1;
    const session = createSession();

    await completeAssistantTurn(session, settings);

    const toolResponse = session.contents[2]?.parts[0] as
      | { functionResponse?: { response?: { error?: string } } }
      | undefined;
    expect(toolResponse?.functionResponse?.response?.error).toBeString();
  });

  it('throws if Gemini requests tool calls while function-calling is disabled', async () => {
    enqueueGeminiResponses({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'generate_uuid', args: {} } }],
          },
        },
      ],
    });

    const settings = createSettingsForToolTests();
    const session = createSession();

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(
      /tools are disabled/i,
    );
  });

  it('throws when Gemini returns no candidate content', async () => {
    const settings = createSettingsForToolTests();
    const secondSession = createSession();
    enqueueGeminiResponses({});
    await expect(completeAssistantTurn(secondSession, settings)).rejects.toThrow(
      /did not return any candidate/i,
    );
  });

  it('throws when max tool round-trips is zero', async () => {
    const settings = createSettingsForToolTests();
    settings.maxToolRoundTrips = 0;
    const session = createSession();

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(
      /round-trip limit/i,
    );
  });
});
