import { isRecord, toErrorMessage } from '../../../core/utils';
import type { GeminiContent, GeminiFunctionCall, GeminiPart } from '../../session/types';
import {
  inferMediaTypeFromMimeType,
  normalizeFunctionCallArgs,
  readPartRecord,
  readStringField,
  summarizeInteractionOutput,
} from './common';
import type { ExecutedFunctionCall, GeminiInteraction } from './contracts';
import { LOCAL_FUNCTION_TOOLS } from './local-tools';

export function extractAssistantContent(interaction: GeminiInteraction): GeminiContent {
  const parts: GeminiPart[] = [];
  for (const rawOutput of interaction.outputs ?? []) {
    const part = mapInteractionOutputToPart(rawOutput);
    if (part) {
      parts.push(part);
    }
  }

  if (parts.length === 0) {
    throw new Error('Gemini interaction did not return any outputs.');
  }

  return {
    id: crypto.randomUUID(),
    role: 'model',
    parts,
  };
}

function mapInteractionOutputToPart(output: Record<string, unknown>): GeminiPart | null {
  const type = typeof output.type === 'string' ? output.type.trim() : '';
  if (!type) {
    return null;
  }

  switch (type) {
    case 'text': {
      const text = typeof output.text === 'string' ? output.text : '';
      return { text };
    }
    case 'thought': {
      const summary = extractThoughtSummary(output);
      if (!summary) {
        return { interactionOutput: { type: 'thought' } };
      }
      return { thoughtSummary: summary };
    }
    case 'function_call': {
      const name = typeof output.name === 'string' ? output.name.trim() : '';
      if (!name) {
        return { interactionOutput: { type: 'function_call' } };
      }

      const id = typeof output.id === 'string' ? output.id.trim() : '';
      const normalizedFunctionCall: { id?: string; name: string; args: Record<string, unknown> } = {
        name,
        args: normalizeFunctionCallArgs(output.arguments),
      };
      if (id) {
        normalizedFunctionCall.id = id;
      }

      return {
        functionCall: normalizedFunctionCall,
      };
    }
    case 'code_execution_result': {
      const result = typeof output.result === 'string' ? output.result : '';
      return {
        codeExecutionResult: {
          output: result,
        },
      };
    }
    case 'code_execution_call': {
      const args = isRecord(output.arguments) ? output.arguments : null;
      const code = args && typeof args.code === 'string' ? args.code : '';
      if (!code) {
        return { interactionOutput: { type: 'code_execution_call' } };
      }

      const language = args && typeof args.language === 'string' ? args.language : 'text';
      return {
        executableCode: {
          language,
          code,
        },
      };
    }
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
      return mapInteractionMediaOutputToPart(output);
    default:
      return {
        interactionOutput: summarizeInteractionOutput(output),
      };
  }
}

function extractThoughtSummary(output: Record<string, unknown>): string {
  const rawSummary = Array.isArray(output.summary) ? output.summary : [];
  const blocks: string[] = [];

  for (const block of rawSummary) {
    if (!isRecord(block)) {
      continue;
    }

    const type = readStringField(block, 'type');
    if (type !== 'text') {
      continue;
    }

    const text = readStringField(block, 'text');
    if (text) {
      blocks.push(text);
    }
  }

  return blocks.join('\n\n');
}

function mapInteractionMediaOutputToPart(output: Record<string, unknown>): GeminiPart | null {
  const mimeType = readStringField(output, 'mime_type');
  const uri = readStringField(output, 'uri');

  if (mimeType && uri) {
    return {
      fileData: {
        fileUri: uri,
        mimeType,
      },
    };
  }

  if (!mimeType) {
    return {
      interactionOutput: summarizeInteractionOutput(output),
    };
  }

  const data = readStringField(output, 'data');
  const inlineData: { mimeType: string; data?: string } = {
    mimeType,
  };
  if (data) {
    inlineData.data = data;
  }

  return {
    inlineData,
  };
}

export function extractFunctionCalls(parts: GeminiPart[]): GeminiFunctionCall[] {
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
  if (!id) {
    throw new Error(`Gemini function call "${name}" is missing call id.`);
  }

  const args = normalizeFunctionCallArgs(rawFunctionCall.args);
  return { id, name, args };
}

export async function executeFunctionCalls(
  functionCalls: GeminiFunctionCall[],
): Promise<ExecutedFunctionCall[]> {
  const results: ExecutedFunctionCall[] = [];

  for (const call of functionCalls) {
    const tool = LOCAL_FUNCTION_TOOLS[call.name];
    if (!tool) {
      results.push({
        call,
        response: { error: `Unknown function: ${call.name}` },
        isError: true,
      });
      continue;
    }

    try {
      const toolResult = await tool.execute(call.args);
      results.push({
        call,
        response: toolResult,
      });
    } catch (error: unknown) {
      results.push({
        call,
        response: { error: toErrorMessage(error) },
        isError: true,
      });
    }
  }

  return results;
}

export function buildFunctionResponsePart(
  call: GeminiFunctionCall,
  response: Record<string, unknown>,
): GeminiPart {
  const functionResponse: Record<string, unknown> = {
    id: call.id,
    name: call.name,
    response,
  };
  return { functionResponse };
}

export function buildFunctionResultInput(call: ExecutedFunctionCall): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: 'function_result',
    call_id: call.call.id,
    name: call.call.name,
    result: call.response,
  };
  if (call.isError) {
    result.is_error = true;
  }

  return result;
}

export function buildInteractionInputFromContent(
  content: GeminiContent,
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const part of content.parts) {
    const text = typeof part.text === 'string' ? part.text : '';
    if (text.trim()) {
      input.push({
        type: 'text',
        text,
      });
    }

    const fileData = readPartRecord(part, 'fileData', 'file_data');
    if (fileData) {
      const mimeType =
        readStringField(fileData, 'mimeType') || readStringField(fileData, 'mime_type');
      const fileUri = readStringField(fileData, 'fileUri') || readStringField(fileData, 'file_uri');
      if (mimeType && fileUri) {
        input.push({
          type: inferMediaTypeFromMimeType(mimeType),
          mime_type: mimeType,
          uri: fileUri,
        });
      }
    }

    const inlineData = readPartRecord(part, 'inlineData', 'inline_data');
    if (inlineData) {
      const mimeType =
        readStringField(inlineData, 'mimeType') || readStringField(inlineData, 'mime_type');
      if (!mimeType) {
        continue;
      }

      const data = readStringField(inlineData, 'data');
      const mediaInput: Record<string, unknown> = {
        type: inferMediaTypeFromMimeType(mimeType),
        mime_type: mimeType,
      };
      if (data) {
        mediaInput.data = data;
      }

      input.push(mediaInput);
    }
  }

  if (input.length === 0) {
    throw new Error('Cannot send a user message with no text or attachment content.');
  }

  return input;
}
