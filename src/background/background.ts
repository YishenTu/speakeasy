import { GoogleGenAI } from '@google/genai';
import type { ChatMessage } from '../shared/chat';
import type {
  ChatLoadPayload,
  ChatNewPayload,
  ChatSendPayload,
  OpenOptionsPayload,
  RuntimeRequest,
  RuntimeResponse,
} from '../shared/runtime';
import {
  GEMINI_SETTINGS_STORAGE_KEY,
  type GeminiSettings,
  normalizeGeminiSettings,
} from '../shared/settings';

const CHAT_SESSIONS_STORAGE_KEY = 'chatSessions';
const MAX_SESSION_COUNT = 25;
const MAX_GEMINI_CLIENT_CACHE_SIZE = 4;

type SDKGenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];
type SDKGenerateContentConfig = NonNullable<SDKGenerateContentRequest['config']>;

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart = Record<string, unknown>;

interface GeminiFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

interface ChatSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  contents: GeminiContent[];
}

interface GenerateContentCandidate {
  content?: GeminiContent;
}

interface GenerateContentResponse {
  candidates?: GenerateContentCandidate[];
}

interface LocalToolDefinition {
  declaration: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const geminiClients = new Map<string, GoogleGenAI>();

const LOCAL_FUNCTION_TOOLS: Record<string, LocalToolDefinition> = {
  get_current_time: {
    declaration: {
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
    execute: async (args) => {
      const timeZone = typeof args.timeZone === 'string' ? args.timeZone.trim() : '';
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
        ...(timeZone ? { timeZone } : {}),
      });

      return {
        iso: now.toISOString(),
        formatted: formatter.format(now),
        timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  },
  get_extension_info: {
    declaration: {
      name: 'get_extension_info',
      description: 'Get extension metadata such as version and manifest name.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async () => {
      const manifest = chrome.runtime.getManifest();
      return {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
      };
    },
  },
  generate_uuid: {
    declaration: {
      name: 'generate_uuid',
      description: 'Generate a random UUID.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async () => ({
      uuid: crypto.randomUUID(),
    }),
  },
};

chrome.runtime.onInstalled.addListener(() => {
  console.info('Speakeasy installed.');
});

chrome.runtime.onStartup.addListener(() => {
  console.info('Speakeasy background service worker started.');
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== 'number') {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'overlay/toggle' }, () => {
    if (chrome.runtime.lastError) {
      console.debug(
        `Speakeasy overlay is not available on this page: ${chrome.runtime.lastError.message}`,
      );
    }
  });
});

chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
  if (!isRuntimeRequest(request)) {
    return false;
  }

  void handleRuntimeRequest(request)
    .then((payload) => {
      const response: RuntimeResponse<typeof payload> = {
        ok: true,
        payload,
      };
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const response: RuntimeResponse<never> = {
        ok: false,
        error: toErrorMessage(error),
      };
      sendResponse(response);
    });

  return true;
});

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value)) {
    return false;
  }

  const type = value.type;
  return (
    type === 'chat/send' ||
    type === 'chat/load' ||
    type === 'chat/new' ||
    type === 'app/open-options'
  );
}

async function handleRuntimeRequest(
  request: RuntimeRequest,
): Promise<ChatLoadPayload | ChatNewPayload | ChatSendPayload | OpenOptionsPayload> {
  switch (request.type) {
    case 'chat/load':
      return handleLoadChat(request.chatId);
    case 'chat/new':
      return handleNewChat();
    case 'chat/send':
      return handleSendMessage(request.text, request.chatId);
    case 'app/open-options':
      await openOptionsPage();
      return {
        opened: true,
      };
    default:
      return assertNever(request);
  }
}

async function handleLoadChat(chatId: string | undefined): Promise<ChatLoadPayload> {
  if (!chatId) {
    return {
      chatId: null,
      messages: [],
    };
  }

  const sessions = await readSessions();
  const session = sessions[chatId];
  if (!session) {
    return {
      chatId: null,
      messages: [],
    };
  }

  return {
    chatId: session.id,
    messages: mapSessionToChatMessages(session),
  };
}

async function handleNewChat(): Promise<ChatNewPayload> {
  const sessions = await readSessions();
  const session = createSession();
  sessions[session.id] = session;
  await writeSessions(sessions);
  return {
    chatId: session.id,
  };
}

async function handleSendMessage(
  text: string,
  chatId: string | undefined,
): Promise<ChatSendPayload> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error('Cannot send an empty message.');
  }

  const settings = await readGeminiSettings();
  if (!settings.apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }

  const sessions = await readSessions();
  const session = getOrCreateSession(sessions, chatId);
  session.contents.push({
    role: 'user',
    parts: [{ text: normalizedText }],
  });

  const assistantContent = await completeAssistantTurn(session, settings);
  session.updatedAt = new Date().toISOString();
  sessions[session.id] = session;
  await writeSessions(sessions);

  return {
    chatId: session.id,
    assistantMessage: toAssistantChatMessage(assistantContent),
  };
}

async function readGeminiSettings(): Promise<GeminiSettings> {
  const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
  return normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
}

function openOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.openOptionsPage(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

async function completeAssistantTurn(
  session: ChatSession,
  settings: GeminiSettings,
): Promise<GeminiContent> {
  const toolSelection = buildToolSelection(settings);
  let latestAssistantContent: GeminiContent | null = null;

  for (let roundTrip = 0; roundTrip < settings.maxToolRoundTrips; roundTrip += 1) {
    const response = await callGeminiGenerateContent(
      toolSelection.toolConfig
        ? {
            settings,
            contents: session.contents,
            tools: toolSelection.tools,
            toolConfig: toolSelection.toolConfig,
          }
        : {
            settings,
            contents: session.contents,
            tools: toolSelection.tools,
          },
    );

    const candidateContent = extractFirstCandidateContent(response);
    session.contents.push(candidateContent);
    latestAssistantContent = candidateContent;

    const functionCalls = extractFunctionCalls(candidateContent.parts);
    if (functionCalls.length === 0) {
      return candidateContent;
    }

    if (!toolSelection.functionCallingEnabled) {
      throw new Error('Gemini requested function calls, but function-calling tools are disabled.');
    }

    const functionResponseParts = await executeFunctionCalls(functionCalls);
    session.contents.push({
      role: 'user',
      parts: functionResponseParts,
    });
  }

  if (latestAssistantContent) {
    return latestAssistantContent;
  }

  throw new Error('Gemini did not produce a final response before the tool round-trip limit.');
}

function buildToolSelection(settings: GeminiSettings): {
  tools: Array<Record<string, unknown>>;
  toolConfig?: Record<string, unknown>;
  functionCallingEnabled: boolean;
} {
  const nativeToolFlags = {
    googleSearch: settings.tools.googleSearch,
    googleMaps: settings.tools.googleMaps,
    codeExecution: settings.tools.codeExecution,
    urlContext: settings.tools.urlContext,
    fileSearch: settings.tools.fileSearch,
    mcpServers: settings.tools.mcpServers,
    computerUse: settings.tools.computerUse,
  };

  const nativeToolCount = Object.values(nativeToolFlags).filter(Boolean).length;
  if (settings.tools.functionCalling && nativeToolCount > 0) {
    throw new Error(
      'Native Gemini tools and function calling cannot be enabled together in generateContent. Disable one set in Settings.',
    );
  }

  if (settings.tools.fileSearch && settings.fileSearchStoreNames.length === 0) {
    throw new Error('File Search is enabled but no file store names were configured.');
  }

  if (settings.tools.mcpServers && settings.mcpServerUrls.length === 0) {
    throw new Error('MCP servers are enabled but no MCP server URLs were configured.');
  }

  if (settings.tools.computerUse) {
    throw new Error(
      'Computer Use requires a dedicated action/screenshot loop and is not yet wired in this extension backend.',
    );
  }

  const tools: Array<Record<string, unknown>> = [];

  if (settings.tools.functionCalling) {
    tools.push({
      functionDeclarations: Object.values(LOCAL_FUNCTION_TOOLS).map((tool) => tool.declaration),
    });
  }

  if (settings.tools.googleSearch) {
    tools.push({ googleSearch: {} });
  }

  if (settings.tools.googleMaps) {
    tools.push({ googleMaps: {} });
  }

  if (settings.tools.codeExecution) {
    tools.push({ codeExecution: {} });
  }

  if (settings.tools.urlContext) {
    tools.push({ urlContext: {} });
  }

  if (settings.tools.fileSearch) {
    tools.push({
      fileSearch: {
        fileSearchStoreNames: settings.fileSearchStoreNames,
      },
    });
  }

  if (settings.tools.mcpServers) {
    tools.push({
      mcpServers: settings.mcpServerUrls.map((url, index) => ({
        name: `mcp_server_${index + 1}`,
        streamableHttpTransport: {
          url,
        },
      })),
    });
  }

  let toolConfig: Record<string, unknown> | undefined;

  if (settings.tools.functionCalling) {
    toolConfig = {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    };
  }

  if (
    settings.tools.googleMaps &&
    settings.mapsLatitude !== null &&
    settings.mapsLongitude !== null
  ) {
    const nextToolConfig = toolConfig ?? {};
    nextToolConfig.retrievalConfig = {
      latLng: {
        latitude: settings.mapsLatitude,
        longitude: settings.mapsLongitude,
      },
    };
    toolConfig = nextToolConfig;
  }

  if (toolConfig) {
    return {
      tools,
      toolConfig,
      functionCallingEnabled: settings.tools.functionCalling,
    };
  }

  return {
    tools,
    functionCallingEnabled: settings.tools.functionCalling,
  };
}

async function callGeminiGenerateContent(input: {
  settings: GeminiSettings;
  contents: GeminiContent[];
  tools: Array<Record<string, unknown>>;
  toolConfig?: Record<string, unknown>;
}): Promise<GenerateContentResponse> {
  const client = getGeminiClient(input.settings.apiKey);

  const config: SDKGenerateContentConfig = {};
  if (input.settings.systemInstruction) {
    config.systemInstruction = {
      parts: [{ text: input.settings.systemInstruction }],
    };
  }

  if (input.tools.length > 0) {
    config.tools = input.tools as unknown as NonNullable<SDKGenerateContentConfig['tools']>;
  }

  if (input.toolConfig) {
    config.toolConfig = input.toolConfig as unknown as NonNullable<
      SDKGenerateContentConfig['toolConfig']
    >;
  }

  const request: SDKGenerateContentRequest = {
    model: input.settings.model,
    contents: input.contents as unknown as SDKGenerateContentRequest['contents'],
  };

  if (!isObjectEmpty(config)) {
    request.config = config;
  }

  const response = (await client.models.generateContent(request)) as unknown;

  if (!isRecord(response)) {
    throw new Error('Gemini response payload was not a JSON object.');
  }

  return response as GenerateContentResponse;
}

function extractFirstCandidateContent(response: GenerateContentResponse): GeminiContent {
  const firstCandidate = response.candidates?.[0];
  if (!firstCandidate?.content) {
    throw new Error('Gemini did not return any candidate content.');
  }

  return normalizeContent(firstCandidate.content);
}

function normalizeContent(value: unknown): GeminiContent {
  if (!isRecord(value)) {
    throw new Error('Gemini content must be a JSON object.');
  }

  const role = value.role === 'user' || value.role === 'model' ? value.role : 'model';
  const rawParts = Array.isArray(value.parts) ? value.parts : [];

  const parts: GeminiPart[] = [];
  for (const rawPart of rawParts) {
    if (isRecord(rawPart)) {
      parts.push({ ...rawPart });
    }
  }

  if (parts.length === 0) {
    throw new Error('Gemini returned content with no parts.');
  }

  return {
    role,
    parts,
  };
}

function extractFunctionCalls(parts: GeminiPart[]): GeminiFunctionCall[] {
  const calls: GeminiFunctionCall[] = [];

  for (const part of parts) {
    const functionCall = parseFunctionCall(part);
    if (functionCall) {
      calls.push(functionCall);
    }
  }

  return calls;
}

function parseFunctionCall(part: GeminiPart): GeminiFunctionCall | null {
  const rawFunctionCall = readFunctionCallObject(part);
  if (!rawFunctionCall) {
    return null;
  }

  const id = typeof rawFunctionCall.id === 'string' ? rawFunctionCall.id.trim() : '';
  const name = typeof rawFunctionCall.name === 'string' ? rawFunctionCall.name.trim() : '';
  if (!name) {
    return null;
  }

  const args = normalizeFunctionCallArgs(rawFunctionCall.args);
  if (id) {
    return { id, name, args };
  }

  return { name, args };
}

function readFunctionCallObject(part: GeminiPart): Record<string, unknown> | null {
  const camel = part.functionCall;
  if (isRecord(camel)) {
    return camel;
  }

  const snake = part.function_call;
  if (isRecord(snake)) {
    return snake;
  }

  return null;
}

function normalizeFunctionCallArgs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return { ...value };
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

async function executeFunctionCalls(functionCalls: GeminiFunctionCall[]): Promise<GeminiPart[]> {
  const responseParts: GeminiPart[] = [];

  for (const functionCall of functionCalls) {
    const tool = LOCAL_FUNCTION_TOOLS[functionCall.name];
    if (!tool) {
      const functionResponse = {
        name: functionCall.name,
        response: {
          error: `Unknown function: ${functionCall.name}`,
        },
      } as Record<string, unknown>;
      if (functionCall.id) {
        functionResponse.id = functionCall.id;
      }

      responseParts.push({
        functionResponse,
      });
      continue;
    }

    try {
      const toolResult = await tool.execute(functionCall.args);
      const functionResponse = {
        name: functionCall.name,
        response: toolResult,
      } as Record<string, unknown>;
      if (functionCall.id) {
        functionResponse.id = functionCall.id;
      }

      responseParts.push({
        functionResponse,
      });
    } catch (error: unknown) {
      const functionResponse = {
        name: functionCall.name,
        response: {
          error: toErrorMessage(error),
        },
      } as Record<string, unknown>;
      if (functionCall.id) {
        functionResponse.id = functionCall.id;
      }

      responseParts.push({
        functionResponse,
      });
    }
  }

  return responseParts;
}

function toAssistantChatMessage(content: GeminiContent): ChatMessage {
  const rendered = renderContentForChat(content).trim();
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: rendered || 'Gemini returned a response with no displayable text.',
  };
}

function mapSessionToChatMessages(session: ChatSession): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const content of session.contents) {
    const text = renderContentForChat(content).trim();
    if (!text) {
      continue;
    }

    const role = content.role === 'user' ? 'user' : 'assistant';
    messages.push({
      id: crypto.randomUUID(),
      role,
      content: text,
    });
  }

  return messages;
}

function renderContentForChat(content: GeminiContent): string {
  const blocks: string[] = [];

  for (const part of content.parts) {
    const text = typeof part.text === 'string' ? part.text.trim() : '';
    if (text) {
      blocks.push(text);
      continue;
    }

    const codeExecutionResult = isRecord(part.codeExecutionResult)
      ? part.codeExecutionResult
      : isRecord(part.code_execution_result)
        ? part.code_execution_result
        : null;
    if (codeExecutionResult) {
      const output =
        typeof codeExecutionResult.output === 'string' ? codeExecutionResult.output.trim() : '';
      if (output) {
        blocks.push(`Code output:\n${output}`);
      }
      continue;
    }

    const executableCode = isRecord(part.executableCode)
      ? part.executableCode
      : isRecord(part.executable_code)
        ? part.executable_code
        : null;
    if (executableCode) {
      const code = typeof executableCode.code === 'string' ? executableCode.code.trim() : '';
      if (code) {
        const language =
          typeof executableCode.language === 'string' && executableCode.language.trim()
            ? executableCode.language.trim().toLowerCase()
            : 'text';
        blocks.push(`\`\`\`${language}\n${code}\n\`\`\``);
      }
    }
  }

  return blocks.join('\n\n');
}

function createSession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    contents: [],
  };
}

function getOrCreateSession(
  sessions: Record<string, ChatSession>,
  chatId: string | undefined,
): ChatSession {
  if (chatId && sessions[chatId]) {
    return sessions[chatId];
  }

  const session = createSession();
  sessions[session.id] = session;
  return session;
}

async function readSessions(): Promise<Record<string, ChatSession>> {
  const stored = await chrome.storage.local.get(CHAT_SESSIONS_STORAGE_KEY);
  const raw = stored[CHAT_SESSIONS_STORAGE_KEY];

  if (!isRecord(raw)) {
    return {};
  }

  const sessions: Record<string, ChatSession> = {};
  for (const [id, value] of Object.entries(raw)) {
    const parsed = parseSession(id, value);
    if (parsed) {
      sessions[id] = parsed;
    }
  }

  return sessions;
}

async function writeSessions(sessions: Record<string, ChatSession>): Promise<void> {
  const entries = Object.values(sessions).sort((left, right) =>
    left.updatedAt < right.updatedAt ? 1 : -1,
  );

  const bounded = entries.slice(0, MAX_SESSION_COUNT);
  const nextStore: Record<string, ChatSession> = {};
  for (const session of bounded) {
    nextStore[session.id] = session;
  }

  await chrome.storage.local.set({
    [CHAT_SESSIONS_STORAGE_KEY]: nextStore,
  });
}

function parseSession(expectedId: string, value: unknown): ChatSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' && value.id ? value.id : expectedId;
  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt
      ? value.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : createdAt;
  const rawContents = Array.isArray(value.contents) ? value.contents : [];

  const contents: GeminiContent[] = [];
  for (const rawContent of rawContents) {
    try {
      contents.push(normalizeContent(rawContent));
    } catch {
      // Skip malformed entries to keep storage resilient to schema changes.
    }
  }

  return {
    id,
    createdAt,
    updatedAt,
    contents,
  };
}

function getGeminiClient(apiKey: string): GoogleGenAI {
  const cached = geminiClients.get(apiKey);
  if (cached) {
    return cached;
  }

  const client = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
  });

  geminiClients.set(apiKey, client);
  if (geminiClients.size > MAX_GEMINI_CLIENT_CACHE_SIZE) {
    const oldestKey = geminiClients.keys().next().value;
    if (oldestKey) {
      geminiClients.delete(oldestKey);
    }
  }

  return client;
}

function isObjectEmpty(value: object): boolean {
  return Object.keys(value).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unexpected error.';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled runtime request: ${String(value)}`);
}
