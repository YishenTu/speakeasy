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
} from '../../../../../src/background/features/gemini/gemini';
import {
  buildGeminiRequestToolSelection,
  composeGeminiInteractionRequest,
} from '../../../../../src/background/features/gemini/gemini-request';
import {
  extractAssistantContent,
  extractGroundingSources,
} from '../../../../../src/background/features/gemini/gemini/function-calls';
import type {
  ChatSession,
  GeminiContent,
} from '../../../../../src/background/features/session/types';
import { defaultGeminiSettings } from '../../../../../src/shared/settings';

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
  it('rejects mixing local function tools with native interactions tools', () => {
    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    settings.tools.googleSearch = true;

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).toThrow(
      /function calling.*native tools/i,
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

  it('rejects combining mcp servers with built-in tools', () => {
    const settings = createSettingsForToolTests();
    settings.model = 'gemini-2.5-flash';
    settings.tools.mcpServers = true;
    settings.mcpServerUrls = ['https://mcp.example.com/stream'];
    settings.tools.googleSearch = true;

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).toThrow(
      /mcp servers cannot be combined/i,
    );
  });

  it('rejects mcp server usage on gemini 3 models', () => {
    const settings = createSettingsForToolTests();
    settings.model = 'gemini-3-flash-preview';
    settings.tools.mcpServers = true;
    settings.mcpServerUrls = ['https://mcp.example.com/stream'];

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).toThrow(
      /remote mcp is not supported on gemini 3/i,
    );
  });

  it('builds a computer_use tool payload with excluded actions', () => {
    const settings = createSettingsForToolTests();
    settings.model = 'gemini-2.5-computer-use-preview-10-2025';
    settings.tools.computerUse = true;
    settings.computerUseExcludedActions = ['drag_and_drop', 'scroll_down'];

    const selection = buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS);
    expect(selection.tools).toContainEqual({
      type: 'computer_use',
      environment: 'browser',
      excludedPredefinedFunctions: ['drag_and_drop', 'scroll_down'],
    });
    expect(selection.functionCallingEnabled).toBe(false);
  });

  it('omits excludedPredefinedFunctions when no actions are excluded', () => {
    const settings = createSettingsForToolTests();
    settings.model = 'gemini-2.5-computer-use-preview-10-2025';
    settings.tools.computerUse = true;

    const selection = buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS);
    expect(selection.tools).toContainEqual({
      type: 'computer_use',
      environment: 'browser',
    });
  });

  it('accepts computer use with default model configuration', () => {
    const settings = createSettingsForToolTests();
    settings.tools.computerUse = true;

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).not.toThrow();
  });

  it('uses snake_case mcp server names', () => {
    const settings = createSettingsForToolTests();
    settings.model = 'gemini-2.5-flash';
    settings.tools.mcpServers = true;
    settings.mcpServerUrls = ['https://mcp.example.com/stream'];

    const selection = buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS);
    expect(selection.tools).toContainEqual({
      type: 'mcp_server',
      name: 'mcp_server_1',
      url: 'https://mcp.example.com/stream',
    });
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

  it('renders function call outputs as readable tool-call lines', () => {
    const content: GeminiContent = {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'call-1',
            name: 'click',
            args: { x: 120, y: 240 },
          },
        },
      ],
    };

    expect(renderContentForChat(content)).toBe('Tool call requested: click {"x":120,"y":240}');
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

describe('extractGroundingSources', () => {
  it('returns empty array when no google_search_result outputs exist', () => {
    const interaction = {
      id: 'test-id',
      outputs: [{ type: 'text', text: 'hello' }],
    };

    expect(extractGroundingSources(interaction)).toEqual([]);
  });

  it('returns empty array when outputs are undefined', () => {
    const interaction = { id: 'test-id' };
    expect(extractGroundingSources(interaction)).toEqual([]);
  });

  it('extracts title and url from google_search_result outputs', () => {
    const interaction = {
      id: 'test-id',
      outputs: [
        { type: 'text', text: 'response' },
        {
          type: 'google_search_result',
          result: [
            { title: 'Example', url: 'https://example.com' },
            { title: 'Other', url: 'https://other.com' },
          ],
        },
      ],
    };

    expect(extractGroundingSources(interaction)).toEqual([
      { title: 'Example', url: 'https://example.com' },
      { title: 'Other', url: 'https://other.com' },
    ]);
  });

  it('skips entries with no url', () => {
    const interaction = {
      id: 'test-id',
      outputs: [
        {
          type: 'google_search_result',
          result: [{ title: 'No URL' }, { title: 'Has URL', url: 'https://example.com' }],
        },
      ],
    };

    expect(extractGroundingSources(interaction)).toEqual([
      { title: 'Has URL', url: 'https://example.com' },
    ]);
  });

  it('deduplicates by url', () => {
    const interaction = {
      id: 'test-id',
      outputs: [
        {
          type: 'google_search_result',
          result: [
            { title: 'First', url: 'https://example.com' },
            { title: 'Duplicate', url: 'https://example.com' },
          ],
        },
      ],
    };

    expect(extractGroundingSources(interaction)).toEqual([
      { title: 'First', url: 'https://example.com' },
    ]);
  });

  it('uses url as title fallback when title is empty', () => {
    const interaction = {
      id: 'test-id',
      outputs: [
        {
          type: 'google_search_result',
          result: [{ title: '  ', url: 'https://example.com' }],
        },
      ],
    };

    expect(extractGroundingSources(interaction)).toEqual([
      { title: 'https://example.com', url: 'https://example.com' },
    ]);
  });

  it('skips google_search_result and google_search_call from assistant parts', () => {
    const interaction = {
      id: 'test-id',
      outputs: [
        { type: 'text', text: 'hello' },
        {
          type: 'google_search_result',
          result: [{ title: 'X', url: 'https://x.com' }],
        },
        { type: 'google_search_call', id: 'call-1', arguments: { query: 'test' } },
      ],
    };

    expect(extractAssistantContent(interaction).parts).toEqual([{ text: 'hello' }]);
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

  it('normalizes snake_case function calls and opaque unknown parts', () => {
    const content = normalizeContent({
      role: 'model',
      parts: [{ function_call: { id: 'call-1', name: 'lookup', args: '{"q":"x"}' } }, { foo: 1 }],
    });

    const functionCallPart = content.parts[0];
    expect(functionCallPart?.functionCall).toEqual({
      id: 'call-1',
      name: 'lookup',
      args: '{"q":"x"}',
    });

    const unknownPart = content.parts[1];
    expect(unknownPart?.interactionOutput).toEqual({
      type: 'unknown_part',
      keys: ['foo'],
    });
  });

  it('keeps valid response stats metadata and drops invalid metadata', () => {
    const withStats = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        responseStats: {
          requestDurationMs: 1000,
          timeToFirstTokenMs: 140,
          outputTokens: 21,
          outputTokensPerSecond: 33.3,
          hasStreamingToken: true,
        },
      },
    });
    expect(withStats.metadata?.responseStats).toEqual({
      requestDurationMs: 1000,
      timeToFirstTokenMs: 140,
      outputTokens: 21,
      outputTokensPerSecond: 33.3,
      hasStreamingToken: true,
    });

    const withoutStats = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        responseStats: {
          requestDurationMs: 'bad',
          timeToFirstTokenMs: 120,
        },
      },
    });
    expect(withoutStats.metadata).toBeUndefined();
  });

  it('keeps createdAt metadata in both camelCase and snake_case forms', () => {
    const createdAt = '2026-02-22T18:20:00.000Z';
    const camelCaseMetadata = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        createdAt,
      },
    });
    expect(camelCaseMetadata.metadata?.createdAt).toBe(createdAt);

    const snakeCaseMetadata = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        created_at: createdAt,
      },
    });
    expect(snakeCaseMetadata.metadata?.createdAt).toBe(createdAt);
  });

  it('keeps valid interactionId metadata and drops empty or non-string values', () => {
    const withCamelCaseInteractionId = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        interactionId: ' interaction-123 ',
      },
    });
    expect(withCamelCaseInteractionId.metadata?.interactionId).toBe('interaction-123');

    const withSnakeCaseInteractionId = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        interaction_id: ' interaction-456 ',
      },
    });
    expect(withSnakeCaseInteractionId.metadata?.interactionId).toBe('interaction-456');

    const withInvalidInteractionId = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        interactionId: { bad: true },
      },
    });
    expect(withInvalidInteractionId.metadata).toBeUndefined();

    const withNumericInteractionId = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        interactionId: 42,
      },
    });
    expect(withNumericInteractionId.metadata).toBeUndefined();

    const withEmptyInteractionId = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        interactionId: '   ',
      },
    });
    expect(withEmptyInteractionId.metadata).toBeUndefined();
  });

  it('keeps valid image preview metadata and drops invalid preview metadata entries', () => {
    const withPreviewMetadata = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        attachmentPreviewByFileUri: {
          ' https://example.invalid/files/image-1 ': ' data:image/png;base64,aGVsbG8= ',
          'https://example.invalid/files/text': 'data:text/plain;base64,aGVsbG8=',
          'https://example.invalid/files/empty': '   ',
          'https://example.invalid/files/too-large': `data:image/png;base64,${'A'.repeat(500_000)}`,
        },
        attachmentPreviewTextByFileUri: {
          ' https://example.invalid/files/note ': ' # Note\n\nbody ',
          'https://example.invalid/files/empty-note': '   ',
        },
      },
    });

    expect(withPreviewMetadata.metadata?.attachmentPreviewByFileUri).toEqual({
      'https://example.invalid/files/image-1': 'data:image/png;base64,aGVsbG8=',
    });
    expect(withPreviewMetadata.metadata?.attachmentPreviewTextByFileUri).toEqual({
      'https://example.invalid/files/note': '# Note\n\nbody',
    });

    const withOnlyInvalidPreviewMetadata = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        attachmentPreviewByFileUri: {
          'https://example.invalid/files/image': 'not-a-data-url',
        },
        attachmentPreviewTextByFileUri: {
          'https://example.invalid/files/note': '   ',
        },
      },
    });

    expect(withOnlyInvalidPreviewMetadata.metadata).toBeUndefined();
  });

  it('normalizes grounding source metadata in camelCase and snake_case forms', () => {
    const withCamelCaseSources = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        groundingSources: [
          { title: ' Example ', url: ' https://example.com ' },
          { title: 'Missing URL' },
          { url: 'https://fallback.com' },
        ],
      },
    });
    expect(withCamelCaseSources.metadata?.groundingSources).toEqual([
      { title: 'Example', url: 'https://example.com' },
      { title: 'https://fallback.com', url: 'https://fallback.com' },
    ]);

    const withSnakeCaseSources = normalizeContent({
      role: 'model',
      parts: [{ text: 'ok' }],
      metadata: {
        grounding_sources: [{ title: 'Other', url: 'https://other.com' }],
      },
    });
    expect(withSnakeCaseSources.metadata?.groundingSources).toEqual([
      { title: 'Other', url: 'https://other.com' },
    ]);
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

  it('uses the store flag from settings', () => {
    const settings = createSettingsForToolTests();
    settings.storeInteractions = false;

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [{ type: 'text', text: 'hello' }],
      functionDeclarations: FUNCTION_DECLARATIONS,
    });

    expect(plan.request.store).toBe(false);
  });

  it('omits tools on function_result turns by default', () => {
    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;

    const plan = composeGeminiInteractionRequest({
      settings,
      input: [
        {
          type: 'function_result',
          call_id: 'call-1',
          name: 'get_current_time',
          result: { iso: '2026-02-22T00:00:00.000Z' },
        },
      ],
      functionDeclarations: FUNCTION_DECLARATIONS,
      previousInteractionId: 'int-1',
    });

    expect(plan.request.tools).toBeUndefined();
    expect(plan.tools).toHaveLength(1);
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

  it('returns empty title without calling Gemini for blank prompts and no attachments', async () => {
    const title = await generateSessionTitle('test-title-key-3', '   ');
    expect(title).toBe('');
    expect(fetchRequestBodies).toHaveLength(0);
  });

  it('generates title from attachments when text is blank', async () => {
    enqueueGeminiResponses({
      id: 'interaction-title-attach',
      outputs: [{ type: 'text', text: 'Sunset beach photo' }],
    });

    const title = await generateSessionTitle('test-title-key-attach', '', [
      { name: 'sunset.jpg', mimeType: 'image/jpeg', fileUri: 'https://example.invalid/sunset.jpg' },
    ]);

    expect(title).toBe('Sunset beach photo');
    expect(fetchRequestBodies).toHaveLength(1);

    const requestInput = fetchRequestBodies[0]?.input;
    expect(Array.isArray(requestInput)).toBe(true);
    const items = Array.isArray(requestInput) ? requestInput : [];
    const textItem = items.find((i: Record<string, unknown>) => i.type === 'text');
    expect(textItem).toBeDefined();
    const prompt = textItem && typeof textItem.text === 'string' ? textItem.text : '';
    expect(prompt).toContain('Generate a concise session title');

    const fileItem = items.find((i: Record<string, unknown>) => i.type === 'file');
    expect(fileItem).toMatchObject({
      type: 'file',
      file: {
        fileUri: 'https://example.invalid/sunset.jpg',
        mimeType: 'image/jpeg',
      },
    });
  });

  it('includes both text and attachments in title generation input', async () => {
    enqueueGeminiResponses({
      id: 'interaction-title-both',
      outputs: [{ type: 'text', text: 'Sunset analysis request' }],
    });

    const title = await generateSessionTitle('test-title-key-both', 'Describe this image', [
      { name: 'sunset.jpg', mimeType: 'image/jpeg', fileUri: 'https://example.invalid/sunset.jpg' },
    ]);

    expect(title).toBe('Sunset analysis request');
    const requestInput = fetchRequestBodies[0]?.input;
    const items = Array.isArray(requestInput) ? requestInput : [];
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ type: 'text' });
    expect(items[1]).toMatchObject({ type: 'file' });
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

  it('attaches grounding sources from google_search_result outputs', async () => {
    enqueueGeminiResponses({
      id: 'interaction-grounding-1',
      outputs: [
        { type: 'text', text: 'Grounded answer' },
        { type: 'google_search_call', id: 'search-call-1', arguments: { query: 'test query' } },
        {
          type: 'google_search_result',
          result: [
            { title: 'Example', url: 'https://example.com' },
            { title: '   ', url: 'https://fallback-title.com' },
            { title: 'Duplicate', url: 'https://example.com' },
            { title: 'Missing URL' },
          ],
        },
      ],
    });

    const session = createSession();
    const settings = createSettingsForToolTests();
    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([{ text: 'Grounded answer' }]);
    expect(assistantContent.metadata?.groundingSources).toEqual([
      { title: 'Example', url: 'https://example.com' },
      { title: 'https://fallback-title.com', url: 'https://fallback-title.com' },
    ]);
  });

  it('keeps source-only responses without throwing when only google search outputs are present', async () => {
    enqueueGeminiResponses({
      id: 'interaction-source-only-1',
      outputs: [
        { type: 'google_search_call', id: 'search-call-1', arguments: { query: 'test query' } },
        {
          type: 'google_search_result',
          result: [{ title: 'Example', url: 'https://example.com' }],
        },
      ],
    });

    const session = createSession();
    const settings = createSettingsForToolTests();
    const assistantContent = await completeAssistantTurn(session, settings);

    expect(assistantContent.parts).toEqual([
      { interactionOutput: { type: 'google_search_result' } },
    ]);
    expect(assistantContent.metadata?.groundingSources).toEqual([
      { title: 'Example', url: 'https://example.com' },
    ]);
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

  it('ignores non-string stream delta payload values', async () => {
    enqueueGeminiSseEvents(
      {
        event_type: 'content.delta',
        delta: { type: 'text', text: 123 },
      },
      {
        event_type: 'content.delta',
        delta: {
          type: 'thought_summary',
          content: { type: 'text', text: 456 },
        },
      },
      {
        event_type: 'content.delta',
        delta: {
          type: 'thought',
          thought: 789,
          content: { type: 'text', text: 999 },
        },
      },
      {
        event_type: 'interaction.complete',
        interaction: {
          id: 'interaction-stream-non-string-delta',
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

    expect(deltas).toEqual([]);
    expect(content.parts).toEqual([{ text: 'Final response' }]);
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

  it('preserves streamed google_search_result deltas when interaction.complete omits outputs', async () => {
    enqueueGeminiSseEvents(
      {
        event_type: 'content.delta',
        index: 0,
        delta: { type: 'text', text: 'Grounded answer from stream.' },
      },
      {
        event_type: 'content.delta',
        index: 1,
        delta: {
          type: 'google_search_call',
          id: 'search-call-stream-1',
          arguments: { queries: ['latest ai announcements'] },
        },
      },
      {
        event_type: 'content.delta',
        index: 2,
        delta: {
          type: 'google_search_result',
          call_id: 'search-call-stream-1',
          result: [{ title: 'Example', url: 'https://example.com' }],
        },
      },
      {
        event_type: 'interaction.complete',
        interaction: {
          id: 'interaction-stream-grounding',
          outputs: [],
        },
      },
    );

    const session = createSession();
    const settings = createSettingsForToolTests();
    settings.tools.googleSearch = true;
    const content = await completeAssistantTurn(session, settings, undefined, () => {});

    expect(content.parts).toEqual([{ text: 'Grounded answer from stream.' }]);
    expect(content.metadata?.groundingSources).toEqual([
      { title: 'Example', url: 'https://example.com' },
    ]);
  });

  it('reconstructs streamed function calls from deltas and continues the tool loop', async () => {
    enqueueGeminiSseEvents(
      {
        event_type: 'content.delta',
        delta: {
          type: 'function_call',
          id: 'tool-call-stream-1',
          name: 'get_extension_info',
          arguments: '{"ignored":',
        },
      },
      {
        event_type: 'content.delta',
        delta: {
          type: 'function_call',
          id: 'tool-call-stream-1',
          name: 'get_extension_info',
          arguments: 'true}',
        },
      },
      {
        event_type: 'interaction.complete',
        interaction: {
          id: 'interaction-stream-tools-1',
        },
      },
    );
    enqueueGeminiSseEvents(
      {
        event_type: 'content.delta',
        delta: { type: 'text', text: 'Done after streamed tool call.' },
      },
      {
        event_type: 'interaction.complete',
        interaction: {
          id: 'interaction-stream-tools-2',
        },
      },
    );

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    const session = createSession('call tool through stream');

    const content = await completeAssistantTurn(session, settings, undefined, () => {});

    expect(content.parts).toEqual([{ text: 'Done after streamed tool call.' }]);
    expect(fetchRequestBodies).toHaveLength(2);
    expect(fetchRequestBodies[0]).toMatchObject({
      stream: true,
      input: [{ type: 'text', text: 'call tool through stream' }],
    });
    expect(fetchRequestBodies[1]).toMatchObject({
      stream: true,
      previous_interaction_id: 'interaction-stream-tools-1',
      input: [
        {
          type: 'function_result',
          call_id: 'tool-call-stream-1',
          name: 'get_extension_info',
          result: {
            name: 'Speakeasy',
            version: '1.2.3',
            description: 'Test extension',
          },
        },
      ],
    });
    expect(session.lastInteractionId).toBe('interaction-stream-tools-2');
  });

  it('attaches response stats from non-stream interaction usage', async () => {
    enqueueGeminiResponses({
      id: 'interaction-usage-non-stream',
      usage: {
        total_input_tokens: 9,
        total_output_tokens: 12,
        total_thought_tokens: 40,
        total_tool_use_tokens: 0,
        total_cached_tokens: 3,
        total_tokens: 64,
      },
      outputs: [{ type: 'text', text: 'Measured response' }],
    });

    const session = createSession();
    const settings = createSettingsForToolTests();
    const content = await completeAssistantTurn(session, settings);
    const stats = content.metadata?.responseStats;

    expect(stats).toBeDefined();
    expect(stats).toMatchObject({
      inputTokens: 9,
      outputTokens: 12,
      thoughtTokens: 40,
      toolUseTokens: 0,
      cachedTokens: 3,
      totalTokens: 64,
      hasStreamingToken: false,
    });
    expect(stats?.requestDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats?.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
    expect(stats?.timeToFirstTokenMs).toBe(stats?.requestDurationMs);
    expect(stats?.outputTokensPerSecond).toBeGreaterThan(0);
    expect(stats?.totalTokensPerSecond).toBeGreaterThan(0);
  });

  it('attaches response stats from streamed usage and marks streamed ttft source', async () => {
    enqueueGeminiSseEvents(
      {
        event_type: 'content.delta',
        delta: { type: 'text', text: 'chunk-' },
      },
      {
        event_type: 'interaction.complete',
        interaction: {
          id: 'interaction-usage-stream',
          usage: {
            total_input_tokens: 11,
            total_output_tokens: 15,
            total_thought_tokens: 22,
            total_tool_use_tokens: 0,
            total_cached_tokens: 0,
            total_tokens: 48,
          },
          outputs: [{ type: 'text', text: 'Streamed final response' }],
        },
      },
    );

    const session = createSession();
    const settings = createSettingsForToolTests();
    const content = await completeAssistantTurn(session, settings, undefined, () => {});
    const stats = content.metadata?.responseStats;

    expect(stats).toBeDefined();
    expect(stats).toMatchObject({
      inputTokens: 11,
      outputTokens: 15,
      thoughtTokens: 22,
      totalTokens: 48,
      hasStreamingToken: true,
    });
    expect(stats?.requestDurationMs).toBeGreaterThanOrEqual(0);
    expect(stats?.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
    expect(stats?.timeToFirstTokenMs).toBeLessThanOrEqual(stats?.requestDurationMs ?? 0);
  });

  it('aggregates interaction usage across function-call round trips', async () => {
    enqueueGeminiResponses(
      {
        id: 'interaction-tool-1',
        usage: {
          total_input_tokens: 6,
          total_output_tokens: 5,
          total_thought_tokens: 10,
          total_tool_use_tokens: 0,
          total_cached_tokens: 0,
          total_tokens: 21,
        },
        outputs: [
          {
            type: 'function_call',
            id: 'tool-call-stats-1',
            name: 'get_extension_info',
            arguments: {},
          },
        ],
      },
      {
        id: 'interaction-tool-2',
        usage: {
          total_input_tokens: 8,
          total_output_tokens: 7,
          total_thought_tokens: 12,
          total_tool_use_tokens: 3,
          total_cached_tokens: 0,
          total_tokens: 30,
        },
        outputs: [{ type: 'text', text: 'Done after round trips' }],
      },
    );

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    const session = createSession('tool stats');
    const content = await completeAssistantTurn(session, settings);
    const stats = content.metadata?.responseStats;

    expect(stats).toBeDefined();
    expect(stats).toMatchObject({
      inputTokens: 14,
      outputTokens: 12,
      thoughtTokens: 22,
      toolUseTokens: 3,
      cachedTokens: 0,
      totalTokens: 51,
      hasStreamingToken: false,
    });
    expect(stats?.totalTokensPerSecond).toBeGreaterThan(0);
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
    expect(session.contents[2]).toMatchObject({
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
    expect(typeof session.contents[2]?.id).toBe('string');
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
    expect(fetchRequestBodies[1]?.tools).toBeUndefined();
    expect(session.lastInteractionId).toBe('interaction-2');
  });

  it('retries function_result turns with tools when the first follow-up request fails', async () => {
    enqueueGeminiResponses({
      id: 'interaction-1',
      outputs: [
        {
          type: 'function_call',
          id: 'tool-call-1',
          name: 'get_extension_info',
          arguments: {},
        },
      ],
    });
    enqueueGeminiHttpResponse(400, {
      error: {
        message: 'Tools are required on this function_result request.',
      },
    });
    enqueueGeminiResponses({
      id: 'interaction-2',
      outputs: [{ type: 'text', text: 'Recovered after retry' }],
    });

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    const session = createSession('tool call retry');

    const assistantContent = await completeAssistantTurn(session, settings);
    expect(assistantContent.parts).toEqual([{ text: 'Recovered after retry' }]);
    expect(fetchRequestBodies).toHaveLength(3);
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
    expect(fetchRequestBodies[1]?.tools).toBeUndefined();
    expect(fetchRequestBodies[2]?.tools).toEqual([
      {
        type: 'function',
        name: 'get_current_time',
        description: 'Get the current time, optionally in a specific IANA time zone.',
        parameters: {
          type: 'object',
          properties: {
            timeZone: {
              type: 'string',
              description:
                'Optional IANA time zone identifier, such as America/New_York or Asia/Tokyo.',
            },
          },
        },
      },
      {
        type: 'function',
        name: 'get_extension_info',
        description: 'Get extension metadata such as version and manifest name.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        type: 'function',
        name: 'generate_uuid',
        description: 'Generate a random UUID.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ]);
  });

  it('retries function_result turns for broader 4xx tool-error phrasings', async () => {
    enqueueGeminiResponses({
      id: 'interaction-1',
      outputs: [
        {
          type: 'function_call',
          id: 'tool-call-1',
          name: 'get_extension_info',
          arguments: {},
        },
      ],
    });
    enqueueGeminiHttpResponse(400, {
      error: {
        message: 'Function result payload is invalid for this request.',
      },
    });
    enqueueGeminiResponses({
      id: 'interaction-2',
      outputs: [{ type: 'text', text: 'Recovered after broader retry' }],
    });

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    const session = createSession('tool call retry with broader error');

    const assistantContent = await completeAssistantTurn(session, settings);
    expect(assistantContent.parts).toEqual([{ text: 'Recovered after broader retry' }]);
    expect(fetchRequestBodies).toHaveLength(3);
    expect(fetchRequestBodies[1]?.tools).toBeUndefined();
    expect(fetchRequestBodies[2]?.tools).toEqual([
      {
        type: 'function',
        name: 'get_current_time',
        description: 'Get the current time, optionally in a specific IANA time zone.',
        parameters: {
          type: 'object',
          properties: {
            timeZone: {
              type: 'string',
              description:
                'Optional IANA time zone identifier, such as America/New_York or Asia/Tokyo.',
            },
          },
        },
      },
      {
        type: 'function',
        name: 'get_extension_info',
        description: 'Get extension metadata such as version and manifest name.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        type: 'function',
        name: 'generate_uuid',
        description: 'Generate a random UUID.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ]);
  });

  it('does not retry function_result turns on 5xx failures', async () => {
    enqueueGeminiResponses({
      id: 'interaction-1',
      outputs: [
        {
          type: 'function_call',
          id: 'tool-call-1',
          name: 'get_extension_info',
          arguments: {},
        },
      ],
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      enqueueGeminiHttpResponse(500, {
        error: {
          message: 'Tools are required on this function_result request.',
        },
      });
    }

    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    const session = createSession('tool call 5xx');

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow();
    expect(fetchRequestBodies.length).toBeGreaterThanOrEqual(2);
    for (const body of fetchRequestBodies.slice(1)) {
      expect(body?.tools).toBeUndefined();
    }
  });

  it('throws when Gemini returns function calls without call ids', async () => {
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

    await expect(completeAssistantTurn(session, settings)).rejects.toThrow(/missing call id/i);
    expect(fetchRequestBodies).toHaveLength(1);
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
    expect(session.contents[2]).toMatchObject({
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
    expect(typeof session.contents[2]?.id).toBe('string');
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

  it('returns function-call outputs as final assistant content when local function-calling is disabled', async () => {
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

    const content = await completeAssistantTurn(session, settings);
    expect(content.parts).toEqual([
      {
        functionCall: {
          id: 'call-1',
          name: 'generate_uuid',
          args: {},
        },
      },
    ]);
    expect(session.lastInteractionId).toBe('interaction-1');
    expect(session.contents).toHaveLength(2);
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

  it('classifies previous interaction id failures from Gemini streaming error events', async () => {
    enqueueGeminiSseEvents({
      event_type: 'error',
      error: {
        message: 'Invalid previous_interaction_id: interaction not found.',
      },
    });

    const settings = createSettingsForToolTests();
    const session = createSession('continue', 'interaction-old');

    let caught: unknown;
    try {
      await completeAssistantTurn(session, settings, undefined, () => {});
    } catch (error: unknown) {
      caught = error;
    }

    expect(fetchRequestBodies[0]).toMatchObject({
      stream: true,
      previous_interaction_id: 'interaction-old',
    });
    expect(isInvalidPreviousInteractionIdError(caught)).toBe(true);
  });
});
