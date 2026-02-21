import { GoogleGenAI } from '@google/genai';
import type { GeminiSettings } from '../shared/settings';
import type {
  ChatSession,
  GeminiContent,
  GeminiFunctionCall,
  GeminiPart,
  GenerateContentResponse,
} from './types';
import { isObjectEmpty, isRecord, toErrorMessage } from './utils';

const MAX_GEMINI_CLIENT_CACHE_SIZE = 4;

type SDKGenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];
type SDKGenerateContentConfig = NonNullable<SDKGenerateContentRequest['config']>;

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

export async function completeAssistantTurn(
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

export function normalizeContent(value: unknown): GeminiContent {
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

export function renderContentForChat(content: GeminiContent): string {
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
