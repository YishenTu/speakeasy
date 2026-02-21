import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  InvalidPreviousInteractionIdError,
  completeAssistantTurn,
  extractAttachments,
  generateSessionTitle,
  isInvalidPreviousInteractionIdError,
  normalizeContent,
  renderContentForChat,
  renderThinkingSummaryForChat,
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

function enqueueGeminiSseEvents(...events: unknown[]): void {
  const streamBody = [
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    'data: [DONE]\n\n',
  ].join('');
  fetchResponseQueue.push({
    __status: 200,
    __body: streamBody,
    __headers: {
      'content-type': 'text/event-stream',
    },
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
      const headers =
        (payload as { __headers?: Record<string, string> }).__headers ??
        ({ 'content-type': 'application/json' } as Record<string, string>);
      const body = (payload as { __body: unknown }).__body;
      const serializedBody =
        typeof body === 'string' && headers['content-type'] === 'text/event-stream'
          ? body
          : JSON.stringify(body);
      return new Response(serializedBody, {
        status: (payload as { __status: number }).__status,
        headers,
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

  it('keeps thought summaries out of assistant text rendering', () => {
    const content: GeminiContent = {
      role: 'model',
      parts: [{ thoughtSummary: 'Plan: inspect constraints first.' }, { text: 'Final answer' }],
    };

    expect(renderContentForChat(content)).toBe('Final answer');
    expect(renderThinkingSummaryForChat(content)).toBe('Plan: inspect constraints first.');
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

describe('InvalidPreviousInteractionIdError', () => {
  it('uses standard Error.cause semantics', () => {
    const rootCause = new Error('root cause');
    const error = new InvalidPreviousInteractionIdError('outer message', rootCause);

    expect(error.cause).toBe(rootCause);
    expect(Object.prototype.propertyIsEnumerable.call(error, 'cause')).toBe(false);
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
    expect(plan.request.generation_config).toEqual({
      thinking_level: 'high',
      thinking_summaries: 'auto',
    });
    expect(plan.request.previous_interaction_id).toBe('int-1');
    expect(plan.request.store).toBe(true);
  });
});

describe('generateSessionTitle', () => {
  it('uses gemini-flash-lite-latest and sanitizes quoted model output', async () => {
    enqueueGeminiResponses({
      id: 'interaction-title-1',
      outputs: [{ type: 'text', text: '  "Quarterly release planning"  ' }],
    });

    const title = await generateSessionTitle('test-title-key', 'Plan our Q3 release milestones');

    expect(title).toBe('Quarterly release planning');
    expect(fetchRequestBodies).toHaveLength(1);
    expect(fetchRequestBodies[0]?.model).toBe('gemini-flash-lite-latest');
    expect(fetchRequestBodies[0]?.store).toBe(false);

    const requestInput = fetchRequestBodies[0]?.input;
    expect(Array.isArray(requestInput)).toBe(true);
    const firstItem = Array.isArray(requestInput) ? requestInput[0] : null;
    expect(firstItem).toMatchObject({
      type: 'text',
    });
    const prompt = firstItem && typeof firstItem.text === 'string' ? firstItem.text : '';
    expect(prompt).toContain('User query:');
    expect(prompt).toContain('Plan our Q3 release milestones');
  });

  it('returns empty title when model provides no text outputs', async () => {
    enqueueGeminiResponses({
      id: 'interaction-title-2',
      outputs: [{ type: 'function_call', id: 'call-1', name: 'noop', arguments: '{}' }],
    });

    const title = await generateSessionTitle('test-title-key-2', 'What should we prioritize?');
    expect(title).toBe('');
  });

  it('returns empty title without calling Gemini for blank prompts', async () => {
    const title = await generateSessionTitle('test-title-key-3', '   ');
    expect(title).toBe('');
    expect(fetchRequestBodies).toHaveLength(0);
  });

  it('truncates long generated titles to label length', async () => {
    enqueueGeminiResponses({
      id: 'interaction-title-4',
      outputs: [
        {
          type: 'text',
          text: 'Build a detailed migration roadmap for session title persistence across background and storage layers',
        },
      ],
    });

    const title = await generateSessionTitle('test-title-key-4', 'Create migration plan');
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('completeAssistantTurn', () => {
  it('throws when the latest session content is not a user message', async () => {
    const settings = createSettingsForToolTests();
    const session: ChatSession = {
      id: 'session-missing-user',
      createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      contents: [{ role: 'model', parts: [{ text: 'assistant first' }] }],
    };

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(
      /expected a user message/i,
    );
  });

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

  it('parses thought outputs into thinking summaries and excludes them from final text', async () => {
    enqueueGeminiResponses({
      id: 'interaction-thought',
      outputs: [
        {
          type: 'thought',
          summary: [{ type: 'text', text: 'I compared two approaches.' }],
        },
        { type: 'text', text: 'Use the simpler approach.' },
      ],
    });

    const session = createSession();
    const settings = createSettingsForToolTests();
    const content = await completeAssistantTurn(session, settings);

    expect(renderContentForChat(content)).toBe('Use the simpler approach.');
    expect(renderThinkingSummaryForChat(content)).toBe('I compared two approaches.');
  });

  it('streams text and thought deltas when a stream callback is provided', async () => {
    enqueueGeminiSseEvents(
      {
        event_type: 'content.delta',
        delta: { type: 'text', text: 'Draft ' },
      },
      {
        event_type: 'content.delta',
        delta: {
          type: 'thought_summary',
          content: { type: 'text', text: 'Checking assumptions.' },
        },
      },
      {
        event_type: 'interaction.complete',
        interaction: {
          id: 'interaction-stream',
          outputs: [{ type: 'text', text: 'Final response' }],
        },
      },
    );

    const deltas: Array<{ textDelta?: string; thinkingDelta?: string }> = [];
    const session = createSession();
    const settings = createSettingsForToolTests();
    const content = await completeAssistantTurn(session, settings, undefined, (delta) => {
      deltas.push(delta);
    });

    expect(deltas).toEqual([{ textDelta: 'Draft ' }, { thinkingDelta: 'Checking assumptions.' }]);
    expect(content.parts).toEqual([{ text: 'Final response' }]);
    expect(session.lastInteractionId).toBe('interaction-stream');
    expect(fetchRequestBodies[0]).toMatchObject({ stream: true });
  });

  it('uses streamed deltas as fallback when interaction.complete omits outputs', async () => {
    enqueueGeminiSseEvents(
      {
        event_type: 'content.delta',
        delta: { type: 'text', text: 'Partial answer.' },
      },
      {
        event_type: 'content.delta',
        delta: {
          type: 'thought_summary',
          content: { type: 'text', text: 'Checked constraints first.' },
        },
      },
      {
        event_type: 'interaction.complete',
        interaction: {
          id: 'interaction-stream-no-outputs',
        },
      },
    );

    const session = createSession();
    const settings = createSettingsForToolTests();
    const content = await completeAssistantTurn(session, settings, undefined, () => {});

    expect(renderContentForChat(content)).toBe('Partial answer.');
    expect(renderThinkingSummaryForChat(content)).toBe('Checked constraints first.');
    expect(session.lastInteractionId).toBe('interaction-stream-no-outputs');
  });

  it('throws when Gemini returns a non-object payload', async () => {
    enqueueGeminiResponses(42);
    const settings = createSettingsForToolTests();
    const session = createSession();

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(/json object/i);
  });

  it('throws when Gemini response is missing interaction id', async () => {
    enqueueGeminiResponses({
      outputs: [{ type: 'text', text: 'missing id response' }],
    });
    const settings = createSettingsForToolTests();
    const session = createSession();

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(/include an id/i);
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

  it('does not throw when Gemini returns function calls without call ids', async () => {
    enqueueGeminiResponses({
      id: 'interaction-1',
      outputs: [
        {
          type: 'function_call',
          name: 'get_extension_info',
          arguments: {},
        },
      ],
    });

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    const session = createSession('call tool');

    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([
      { functionCall: { name: 'get_extension_info', args: {} } },
    ]);
    expect(fetchRequestBodies).toHaveLength(1);
    expect(session.contents).toHaveLength(2);
    expect(session.lastInteractionId).toBe('interaction-1');
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

  it('maps multimodal outputs into chat attachments', async () => {
    enqueueGeminiResponses({
      id: 'interaction-media',
      outputs: [
        {
          type: 'image',
          mime_type: 'image/png',
          uri: 'https://example.invalid/files/pic.png',
        },
        {
          type: 'audio',
          mime_type: 'audio/wav',
          data: 'AAAB',
        },
      ],
    });

    const settings = createSettingsForToolTests();
    const session = createSession('show attachments');
    const content = await completeAssistantTurn(session, settings);

    expect(extractAttachments(content)).toEqual([
      {
        name: 'pic.png',
        mimeType: 'image/png',
        fileUri: 'https://example.invalid/files/pic.png',
      },
      {
        name: 'attachment',
        mimeType: 'audio/wav',
      },
    ]);
  });

  it('maps code-execution calls and unknown output summaries', async () => {
    enqueueGeminiResponses({
      id: 'interaction-code-output',
      outputs: [
        {
          type: 'code_execution_call',
          arguments: {
            language: 'python',
            code: 'print(7)',
          },
        },
        {
          type: 'unknown_signal',
          name: 'mystery',
          id: 'm-1',
          result: [1, 2],
        },
      ],
    });

    const settings = createSettingsForToolTests();
    const session = createSession('execute');
    const content = await completeAssistantTurn(session, settings);

    expect(content.parts).toEqual([
      {
        executableCode: {
          language: 'python',
          code: 'print(7)',
        },
      },
      {
        interactionOutput: {
          type: 'unknown_signal',
          name: 'mystery',
          id: 'm-1',
          resultCount: 2,
        },
      },
    ]);
  });

  it('maps user attachment mime types to interactions input media types', async () => {
    enqueueGeminiResponses({
      id: 'interaction-input-media',
      outputs: [{ type: 'text', text: 'ok' }],
    });

    const session: ChatSession = {
      id: 'session-media-input',
      createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: 'https://example.invalid/files/clip.wav',
                mimeType: 'audio/wav',
              },
            },
            {
              fileData: {
                fileUri: 'https://example.invalid/files/movie.mp4',
                mimeType: 'video/mp4',
              },
            },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: 'AAAB',
              },
            },
          ],
        },
      ],
    };

    const settings = createSettingsForToolTests();
    await completeAssistantTurn(session, settings);

    expect(fetchRequestBodies[0]?.input).toEqual([
      {
        type: 'audio',
        mime_type: 'audio/wav',
        uri: 'https://example.invalid/files/clip.wav',
      },
      {
        type: 'video',
        mime_type: 'video/mp4',
        uri: 'https://example.invalid/files/movie.mp4',
      },
      {
        type: 'document',
        mime_type: 'application/pdf',
        data: 'AAAB',
      },
    ]);
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
