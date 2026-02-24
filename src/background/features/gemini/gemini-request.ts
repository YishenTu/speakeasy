import type { GeminiSettings } from '../../../shared/settings';
import { validateGeminiToolConfiguration } from '../../../shared/tool-validation';

export interface GeminiRequestToolSelection {
  tools: Array<Record<string, unknown>>;
  functionCallingEnabled: boolean;
}

export interface GeminiInteractionRequest {
  model: string;
  input: string | Array<Record<string, unknown>>;
  store: boolean;
  previous_interaction_id?: string;
  system_instruction?: string;
  tools?: Array<Record<string, unknown>>;
  generation_config?: {
    thinking_level?: string;
    thinking_summaries?: 'auto' | 'none';
  };
}

interface ComposeGeminiInteractionRequestInput {
  settings: GeminiSettings;
  input: string | Array<Record<string, unknown>>;
  functionDeclarations: Array<Record<string, unknown>>;
  thinkingLevel?: string;
  previousInteractionId?: string;
  includeToolsForFunctionResult?: boolean;
}

export function composeGeminiInteractionRequest(
  input: ComposeGeminiInteractionRequestInput,
): GeminiRequestToolSelection & { request: GeminiInteractionRequest } {
  const selection = buildGeminiRequestToolSelection(input.settings, input.functionDeclarations);
  const request: GeminiInteractionRequest = {
    model: input.settings.model,
    input: input.input,
    store: input.settings.storeInteractions,
  };

  if (input.previousInteractionId) {
    request.previous_interaction_id = input.previousInteractionId;
  }

  if (input.settings.systemInstruction) {
    request.system_instruction = input.settings.systemInstruction;
  }

  if (
    selection.tools.length > 0 &&
    (input.includeToolsForFunctionResult || !isFunctionResultOnlyInput(input.input))
  ) {
    request.tools = selection.tools;
  }

  const generationConfig: NonNullable<GeminiInteractionRequest['generation_config']> = {
    thinking_summaries: 'auto',
  };
  if (input.thinkingLevel) {
    generationConfig.thinking_level = input.thinkingLevel;
  }
  request.generation_config = generationConfig;

  return {
    request,
    ...selection,
  };
}

export function buildGeminiRequestToolSelection(
  settings: GeminiSettings,
  functionDeclarations: Array<Record<string, unknown>>,
): GeminiRequestToolSelection {
  const toolConfigurationError = validateGeminiToolConfiguration(settings);
  if (toolConfigurationError) {
    throw new Error(toolConfigurationError);
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

  if (settings.tools.computerUse) {
    const computerUseTool: Record<string, unknown> = {
      type: 'computer_use',
      environment: 'browser',
    };
    if (settings.computerUseExcludedActions.length > 0) {
      computerUseTool.excludedPredefinedFunctions = [...settings.computerUseExcludedActions];
    }
    tools.push(computerUseTool);
  }

  return {
    tools,
    functionCallingEnabled: settings.tools.functionCalling,
  };
}

function isFunctionResultOnlyInput(input: string | Array<Record<string, unknown>>): boolean {
  if (!Array.isArray(input) || input.length === 0) {
    return false;
  }

  return input.every(
    (item) => !!item && typeof item === 'object' && item.type === 'function_result',
  );
}
