import type { GeminiSettings } from '../shared/settings';
import { isObjectEmpty } from './utils';

export interface GeminiRequestToolSelection {
  tools: Array<Record<string, unknown>>;
  functionCallingEnabled: boolean;
}

export interface GeminiInteractionRequest {
  model: string;
  input: string | Array<Record<string, unknown>>;
  store: true;
  previous_interaction_id?: string;
  system_instruction?: string;
  tools?: Array<Record<string, unknown>>;
  generation_config?: {
    thinking_level?: string;
  };
}

interface ComposeGeminiInteractionRequestInput {
  settings: GeminiSettings;
  input: string | Array<Record<string, unknown>>;
  functionDeclarations: Array<Record<string, unknown>>;
  thinkingLevel?: string;
  previousInteractionId?: string;
}

export function composeGeminiInteractionRequest(
  input: ComposeGeminiInteractionRequestInput,
): GeminiRequestToolSelection & { request: GeminiInteractionRequest } {
  const selection = buildGeminiRequestToolSelection(input.settings, input.functionDeclarations);
  const request: GeminiInteractionRequest = {
    model: input.settings.model,
    input: input.input,
    store: true,
  };

  if (input.previousInteractionId) {
    request.previous_interaction_id = input.previousInteractionId;
  }

  if (input.settings.systemInstruction) {
    request.system_instruction = input.settings.systemInstruction;
  }

  if (selection.tools.length > 0) {
    request.tools = selection.tools;
  }

  const generationConfig: NonNullable<GeminiInteractionRequest['generation_config']> = {};
  if (input.thinkingLevel) {
    generationConfig.thinking_level = input.thinkingLevel;
  }

  if (!isObjectEmpty(generationConfig)) {
    request.generation_config = generationConfig;
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

  if (settings.tools.googleMaps) {
    throw new Error('Google Maps is not supported by the Interactions API in this extension yet.');
  }

  const tools: Array<Record<string, unknown>> = [];

  if (settings.tools.functionCalling) {
    for (const declaration of functionDeclarations) {
      const name = typeof declaration.name === 'string' ? declaration.name : '';
      if (!name) {
        continue;
      }

      tools.push({
        type: 'function',
        ...declaration,
      });
    }
  }

  if (settings.tools.googleSearch) {
    tools.push({ type: 'google_search' });
  }

  if (settings.tools.codeExecution) {
    tools.push({ type: 'code_execution' });
  }

  if (settings.tools.urlContext) {
    tools.push({ type: 'url_context' });
  }

  if (settings.tools.fileSearch) {
    tools.push({
      type: 'file_search',
      file_search_store_names: settings.fileSearchStoreNames,
    });
  }

  if (settings.tools.mcpServers) {
    tools.push(
      ...settings.mcpServerUrls.map((url, index) => ({
        type: 'mcp_server',
        name: `mcp_server_${index + 1}`,
        url,
      })),
    );
  }

  return {
    tools,
    functionCallingEnabled: settings.tools.functionCalling,
  };
}
