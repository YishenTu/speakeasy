import { GoogleGenAI } from '@google/genai';
import type { GeminiSettings } from '../shared/settings';
import { composeGeminiGenerateContentRequest } from './gemini-request';
import type {
  ChatSession,
  GeminiContent,
  GeminiFunctionCall,
  GeminiPart,
  GenerateContentResponse,
} from './types';
import { isRecord, toErrorMessage } from './utils';

const MAX_GEMINI_CLIENT_CACHE_SIZE = 4;

type SDKGenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];

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
  const functionDeclarations = Object.values(LOCAL_FUNCTION_TOOLS).map((tool) => tool.declaration);
  const { functionCallingEnabled } = composeGeminiGenerateContentRequest({
    settings,
    contents: session.contents,
    functionDeclarations,
  });
  let latestAssistantContent: GeminiContent | null = null;

  for (let roundTrip = 0; roundTrip < settings.maxToolRoundTrips; roundTrip += 1) {
    const response = await callGeminiGenerateContent({
      settings,
      contents: session.contents,
      functionDeclarations,
    });

    const candidateContent = extractFirstCandidateContent(response);
    session.contents.push(candidateContent);
    latestAssistantContent = candidateContent;

    const functionCalls = extractFunctionCalls(candidateContent.parts);
    if (functionCalls.length === 0) {
      return candidateContent;
    }

    if (!functionCallingEnabled) {
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

    const codeExecutionResult = readPartRecord(
      part,
      'codeExecutionResult',
      'code_execution_result',
    );
    if (codeExecutionResult) {
      const output =
        typeof codeExecutionResult.output === 'string' ? codeExecutionResult.output.trim() : '';
      if (output) {
        blocks.push(`Code output:\n${output}`);
      }
      continue;
    }

    const executableCode = readPartRecord(part, 'executableCode', 'executable_code');
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

async function callGeminiGenerateContent(input: {
  settings: GeminiSettings;
  contents: GeminiContent[];
  functionDeclarations: Array<Record<string, unknown>>;
}): Promise<GenerateContentResponse> {
  const client = getGeminiClient(input.settings.apiKey);
  const { request } = composeGeminiGenerateContentRequest({
    settings: input.settings,
    contents: input.contents,
    functionDeclarations: input.functionDeclarations,
  });

  const response = (await client.models.generateContent(
    request as unknown as SDKGenerateContentRequest,
  )) as unknown;
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
  return parts.map(parseFunctionCall).filter((call): call is GeminiFunctionCall => call !== null);
}

function parseFunctionCall(part: GeminiPart): GeminiFunctionCall | null {
  const rawFunctionCall = readPartRecord(part, 'functionCall', 'function_call');
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

function readPartRecord(
  part: GeminiPart,
  camelKey: string,
  snakeKey: string,
): Record<string, unknown> | null {
  if (isRecord(part[camelKey])) {
    return part[camelKey] as Record<string, unknown>;
  }
  if (isRecord(part[snakeKey])) {
    return part[snakeKey] as Record<string, unknown>;
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

  for (const call of functionCalls) {
    const tool = LOCAL_FUNCTION_TOOLS[call.name];
    if (!tool) {
      responseParts.push(
        buildFunctionResponsePart(call, { error: `Unknown function: ${call.name}` }),
      );
      continue;
    }

    try {
      const toolResult = await tool.execute(call.args);
      responseParts.push(buildFunctionResponsePart(call, toolResult));
    } catch (error: unknown) {
      responseParts.push(buildFunctionResponsePart(call, { error: toErrorMessage(error) }));
    }
  }

  return responseParts;
}

function buildFunctionResponsePart(
  call: GeminiFunctionCall,
  response: Record<string, unknown>,
): GeminiPart {
  const functionResponse: Record<string, unknown> = {
    name: call.name,
    response,
  };
  if (call.id) {
    functionResponse.id = call.id;
  }
  return { functionResponse };
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
