import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  completeAssistantTurn,
  extractAttachments,
  isInvalidPreviousInteractionIdError,
  normalizeContent,
  renderContentForChat,
} from '../../src/background/gemini';
import {
  buildGeminiRequestToolSelection,
  composeGeminiInteractionRequest,
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

function enqueueGeminiHttpResponse(status: number, body: unknown): void {
  fetchResponseQueue.push({
    __status: status,
    __body: body,
  });
}

function createSession(prompt = 'hello', lastInteractionId?: string): ChatSession {
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
    ...(lastInteractionId ? { lastInteractionId } : {}),
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
    if (
      payload &&
      typeof payload === 'object' &&
      '__status' in payload &&
      '__body' in payload &&
      typeof (payload as { __status?: unknown }).__status === 'number'
    ) {
      return new Response(JSON.stringify((payload as { __body: unknown }).__body), {
        status: (payload as { __status: number }).__status,
        headers: { 'content-type': 'application/json' },
      });
    }

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
    (globalThis as { chrome?: unknown }).chrome = undefined;
  } else {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

describe('buildGeminiRequestToolSelection', () => {
  it('allows mixing local function tools with native interactions tools', () => {
    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    settings.tools.googleSearch = true;

    const selection = buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS);
    expect(selection.tools).toEqual([
      {
        type: 'function',
        ...FUNCTION_DECLARATIONS[0],
      },
      { type: 'google_search' },
    ]);
    expect(selection.functionCallingEnabled).toBe(true);
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

  it('rejects google maps because interactions tooling does not expose it yet', () => {
    const settings = createSettingsForToolTests();
    settings.tools.googleMaps = true;

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).toThrow(
      /google maps/i,
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

describe('extractAttachments', () => {
  it('extracts fileData attachments in camel and snake case', () => {
    const content: GeminiContent = {
      role: 'model',
      parts: [
        {
          fileData: {
            fileUri: 'https://example.invalid/files/photo.jpg',
            mimeType: 'image/jpeg',
            displayName: 'photo.jpg',
          },
        },
        {
          file_data: {
            file_uri: 'https://example.invalid/files/report.pdf',
            mime_type: 'application/pdf',
          },
        },
      ],
    };

    expect(extractAttachments(content)).toEqual([
      {
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileUri: 'https://example.invalid/files/photo.jpg',
      },
      {
        name: 'report.pdf',
        mimeType: 'application/pdf',
        fileUri: 'https://example.invalid/files/report.pdf',
      },
    ]);
  });

  it('extracts inlineData metadata without embedding payload bytes', () => {
    const content: GeminiContent = {
      role: 'model',
      parts: [
        {
          inlineData: {
            mimeType: 'image/png',
            data: 'AAAABBBB',
            displayName: 'preview.png',
          },
        },
      ],
    };

    expect(extractAttachments(content)).toEqual([
      {
        name: 'preview.png',
        mimeType: 'image/png',
      },
    ]);
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

describe('composeGeminiInteractionRequest', () => {
  it('adds system instructions and thinking config when provided', () => {
    const settings = createSettingsForToolTests();
    settings.systemInstruction = 'Be concise.';

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'hello' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
      thinkingLevel: 'high',
      previousInteractionId: 'int-1',
    });

    expect(plan.request.system_instruction).toBe('Be concise.');
    expect(plan.request.generation_config).toEqual({ thinking_level: 'high' });
    expect(plan.request.previous_interaction_id).toBe('int-1');
    expect(plan.request.store).toBe(true);
  });
});

describe('completeAssistantTurn', () => {
  it('returns first assistant response and persists interaction id', async () => {
    enqueueGeminiResponses({
      id: 'interaction-1',
      outputs: [{ type: 'text', text: 'Direct answer' }],
    });

    const session = createSession();
    const settings = createSettingsForToolTests();

    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([{ text: 'Direct answer' }]);
    expect(session.contents).toHaveLength(2);
    expect(session.lastInteractionId).toBe('interaction-1');
    expect(fetchRequestBodies).toHaveLength(1);
    expect(fetchRequestBodies[0]?.input).toEqual([{ type: 'text', text: 'hello' }]);
    expect(fetchRequestBodies[0]?.previous_interaction_id).toBeUndefined();
  });

  it('continues from the stored previous interaction id', async () => {
    enqueueGeminiResponses({
      id: 'interaction-2',
      outputs: [{ type: 'text', text: 'Continued answer' }],
    });

    const session = createSession('continue', 'interaction-1');
    const settings = createSettingsForToolTests();

    await completeAssistantTurn(session, settings);

    expect(fetchRequestBodies[0]?.previous_interaction_id).toBe('interaction-1');
    expect(session.lastInteractionId).toBe('interaction-2');
  });

  it('handles function calls and appends function responses before final answer', async () => {
    enqueueGeminiResponses(
      {
        id: 'interaction-1',
        outputs: [
          {
            type: 'function_call',
            id: 'tool-call-1',
            name: 'get_extension_info',
            arguments: { ignored: true },
          },
        ],
      },
      {
        id: 'interaction-2',
        outputs: [{ type: 'text', text: 'Done after tool call' }],
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
    expect(fetchRequestBodies[1]?.previous_interaction_id).toBe('interaction-1');
    expect(fetchRequestBodies[1]?.input).toEqual([
      {
        type: 'function_result',
        call_id: 'tool-call-1',
        name: 'get_extension_info',
        result: {
          name: 'Speakeasy',
          version: '1.2.3',
          description: 'Test extension',
        },
      },
    ]);
    expect(session.lastInteractionId).toBe('interaction-2');
  });

  it('returns tool error responses for unknown tools and malformed JSON args', async () => {
    enqueueGeminiResponses({
      id: 'interaction-1',
      outputs: [
        {
          type: 'function_call',
          id: 'x',
          name: 'missing_tool',
          arguments: 'not json',
        },
      ],
    });

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    settings.maxToolRoundTrips = 1;
    const session = createSession();

    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([
      { functionCall: { id: 'x', name: 'missing_tool', args: {} } },
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
    expect(fetchRequestBodies).toHaveLength(1);
  });

  it('captures tool runtime errors as function responses', async () => {
    enqueueGeminiResponses({
      id: 'interaction-1',
      outputs: [
        {
          type: 'function_call',
          id: 'bad-tz',
          name: 'get_current_time',
          arguments: { timeZone: 'Invalid/Time_Zone' },
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
      id: 'interaction-1',
      outputs: [
        {
          type: 'function_call',
          id: 'call-1',
          name: 'generate_uuid',
          arguments: {},
        },
      ],
    });

    const settings = createSettingsForToolTests();
    const session = createSession();

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(/tools are disabled/i);
  });

  it('throws when Gemini returns no outputs', async () => {
    const settings = createSettingsForToolTests();
    const session = createSession();
    enqueueGeminiResponses({ id: 'interaction-1' });

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(
      /did not return any outputs/i,
    );
  });

  it('throws when max tool round-trips is zero', async () => {
    const settings = createSettingsForToolTests();
    settings.maxToolRoundTrips = 0;
    const session = createSession();

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(/round-trip limit/i);
  });

  it('classifies previous interaction id failures from Gemini responses', async () => {
    enqueueGeminiHttpResponse(400, {
      error: {
        message: 'Invalid previous_interaction_id: interaction not found.',
      },
    });

    const settings = createSettingsForToolTests();
    const session = createSession('continue', 'interaction-old');

    let caught: unknown;
    try {
      await completeAssistantTurn(session, settings);
    } catch (error: unknown) {
      caught = error;
    }

    expect(isInvalidPreviousInteractionIdError(caught)).toBe(true);
  });
});
