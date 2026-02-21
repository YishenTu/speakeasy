import type { GeminiSettings } from '../shared/settings';
import type { GeminiContent } from './types';
import { isObjectEmpty } from './utils';

export interface GeminiRequestToolSelection {
  tools: Array<Record<string, unknown>>;
  toolConfig?: Record<string, unknown>;
  functionCallingEnabled: boolean;
}

export interface GeminiGenerateContentRequest {
  model: string;
  contents: GeminiContent[];
  config?: {
    systemInstruction?: {
      parts: Array<{
        text: string;
      }>;
    };
    tools?: Array<Record<string, unknown>>;
    toolConfig?: Record<string, unknown>;
    thinkingConfig?: {
      thinkingLevel: string;
    };
  };
}

interface ComposeGeminiRequestInput {
  settings: GeminiSettings;
  contents: GeminiContent[];
  functionDeclarations: Array<Record<string, unknown>>;
  thinkingLevel?: string;
}

export function composeGeminiGenerateContentRequest(
  input: ComposeGeminiRequestInput,
): GeminiRequestToolSelection & { request: GeminiGenerateContentRequest } {
  const selection = buildGeminiRequestToolSelection(input.settings, input.functionDeclarations);
  const request: GeminiGenerateContentRequest = {
    model: input.settings.model,
    contents: input.contents,
  };

  const config: NonNullable<GeminiGenerateContentRequest['config']> = {};
  if (input.settings.systemInstruction) {
    config.systemInstruction = {
      parts: [{ text: input.settings.systemInstruction }],
    };
  }

  if (selection.tools.length > 0) {
    config.tools = selection.tools;
  }

  if (selection.toolConfig) {
    config.toolConfig = selection.toolConfig;
  }

  if (input.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: input.thinkingLevel };
  }

  if (!isObjectEmpty(config)) {
    request.config = config;
  }

  return {
    request,
    ...selection,
  };
}

export function buildGeminiRequestToolSelection(
  settings: GeminiSettings,
  functionDeclarations: Array<Record<string, unknown>>,
): GeminiRequestToolSelection {
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
      functionDeclarations,
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
    toolConfig = {
      ...toolConfig,
      retrievalConfig: {
        latLng: {
          latitude: settings.mapsLatitude,
          longitude: settings.mapsLongitude,
        },
      },
    };
  }

  return {
    tools,
    ...(toolConfig ? { toolConfig } : {}),
    functionCallingEnabled: settings.tools.functionCalling,
  };
}
