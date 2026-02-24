import { isRecord } from '../../../core/utils';
import { normalizeFunctionCallArgs, readStringField } from './common';
import type { GeminiInteraction, GeminiStreamDelta, StreamedFunctionCallDelta } from './contracts';

export function applyStreamOutputFallback(
  interaction: GeminiInteraction,
  fallback: {
    text: string;
    thoughtSummary: string;
    functionCalls: Array<Record<string, unknown>>;
    toolOutputs: Array<Record<string, unknown>>;
  },
): GeminiInteraction {
  if (Array.isArray(interaction.outputs) && interaction.outputs.length > 0) {
    return interaction;
  }

  const fallbackOutputs: Array<Record<string, unknown>> = [];
  if (fallback.functionCalls.length > 0) {
    fallbackOutputs.push(...fallback.functionCalls);
  }
  if (fallback.toolOutputs.length > 0) {
    fallbackOutputs.push(...fallback.toolOutputs);
  }
  if (fallback.thoughtSummary.trim()) {
    fallbackOutputs.push({
      type: 'thought',
      summary: [{ type: 'text', text: fallback.thoughtSummary }],
    });
  }
  if (fallback.text.trim()) {
    fallbackOutputs.push({
      type: 'text',
      text: fallback.text,
    });
  }

  if (fallbackOutputs.length === 0) {
    return interaction;
  }

  return {
    ...interaction,
    outputs: fallbackOutputs,
  };
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return !!value && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
}

export function collectStreamedFunctionCallDelta(
  event: Record<string, unknown>,
  functionCallDeltas: Map<string, StreamedFunctionCallDelta>,
): void {
  const delta = isRecord(event.delta) ? event.delta : null;
  if (!delta || readStringField(delta, 'type') !== 'function_call') {
    return;
  }

  const name = readStringField(delta, 'name');
  if (!name) {
    return;
  }

  const id = readStringField(delta, 'id');
  const streamIndex = readStreamContentIndex(event);
  const key = id || (streamIndex === null ? `name:${name}` : `index:${streamIndex}`);

  const existing = functionCallDeltas.get(key);
  const callDelta: StreamedFunctionCallDelta = existing ?? {
    order: functionCallDeltas.size,
    name,
    argumentChunks: [],
  };

  callDelta.name = name;
  if (id) {
    callDelta.id = id;
  }

  const callArguments = delta.arguments;
  if (isRecord(callArguments)) {
    callDelta.argumentsObject = { ...callArguments };
    callDelta.argumentChunks = [];
  } else if (typeof callArguments === 'string') {
    callDelta.argumentChunks.push(callArguments);
  }

  functionCallDeltas.set(key, callDelta);
}

export interface StreamedToolOutputDelta {
  order: number;
  output: Record<string, unknown>;
}

const STREAMED_TOOL_OUTPUT_TYPES = new Set([
  'google_search_call',
  'google_search_result',
  'code_execution_call',
  'code_execution_result',
]);

export function collectStreamedToolOutputDelta(
  event: Record<string, unknown>,
  toolOutputDeltas: Map<string, StreamedToolOutputDelta>,
): void {
  const delta = isRecord(event.delta) ? event.delta : null;
  if (!delta) {
    return;
  }

  const type = readStringField(delta, 'type');
  if (!STREAMED_TOOL_OUTPUT_TYPES.has(type)) {
    return;
  }

  const streamIndex = readStreamContentIndex(event);
  const id = readToolOutputDeltaId(type, delta);
  const key =
    (id ? `${type}:${id}` : '') ||
    (streamIndex === null ? `${type}:order:${toolOutputDeltas.size}` : `${type}:${streamIndex}`);

  const existing = toolOutputDeltas.get(key);
  const output = mergeStreamedToolOutput(existing?.output, delta, type);
  toolOutputDeltas.set(key, {
    order: existing?.order ?? toolOutputDeltas.size,
    output,
  });
}

function readToolOutputDeltaId(type: string, delta: Record<string, unknown>): string {
  switch (type) {
    case 'google_search_call':
    case 'code_execution_call':
      return readStringField(delta, 'id');
    case 'google_search_result':
      return readStringField(delta, 'call_id', 'id');
    case 'code_execution_result':
      return readStringField(delta, 'call_id', 'callId', 'id');
    default:
      return '';
  }
}

function mergeStreamedToolOutput(
  existingOutput: Record<string, unknown> | undefined,
  delta: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...(existingOutput ?? {}),
    ...delta,
    type,
  };

  if (type === 'code_execution_result') {
    mergeStreamedStringField(existingOutput, delta, merged, 'result');
    mergeStreamedStringField(existingOutput, delta, merged, 'output');
  }

  return merged;
}

function mergeStreamedStringField(
  existingOutput: Record<string, unknown> | undefined,
  delta: Record<string, unknown>,
  mergedOutput: Record<string, unknown>,
  field: string,
): void {
  const nextValue = delta[field];
  if (typeof nextValue !== 'string') {
    return;
  }

  const previousValue = existingOutput?.[field];
  if (
    typeof previousValue === 'string' &&
    previousValue.length > 0 &&
    !nextValue.startsWith(previousValue)
  ) {
    mergedOutput[field] = `${previousValue}${nextValue}`;
    return;
  }

  mergedOutput[field] = nextValue;
}

export function buildStreamedFunctionCallOutputs(
  functionCallDeltas: Map<string, StreamedFunctionCallDelta>,
): Array<Record<string, unknown>> {
  return [...functionCallDeltas.values()]
    .sort((left, right) => left.order - right.order)
    .map((callDelta) => {
      const output: Record<string, unknown> = {
        type: 'function_call',
        name: callDelta.name,
        arguments:
          callDelta.argumentsObject !== undefined
            ? normalizeFunctionCallArgs(callDelta.argumentsObject)
            : normalizeFunctionCallArgs(callDelta.argumentChunks.join('')),
      };
      if (callDelta.id) {
        output.id = callDelta.id;
      }

      return output;
    });
}

export function buildStreamedToolOutputs(
  toolOutputDeltas: Map<string, StreamedToolOutputDelta>,
): Array<Record<string, unknown>> {
  return [...toolOutputDeltas.values()]
    .sort((left, right) => left.order - right.order)
    .map((toolOutput) => ({ ...toolOutput.output }));
}

function readStreamContentIndex(event: Record<string, unknown>): number | null {
  const index = event.index;
  if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) {
    return null;
  }

  return Math.trunc(index);
}

export function extractStreamDelta(event: Record<string, unknown>): GeminiStreamDelta | null {
  const delta = isRecord(event.delta) ? event.delta : null;
  if (!delta) {
    return null;
  }

  const deltaType = readStringField(delta, 'type');
  if (deltaType === 'text') {
    const text = delta.text;
    return typeof text === 'string' && text ? { textDelta: text } : null;
  }

  if (deltaType === 'thought_summary') {
    const content = isRecord(delta.content) ? delta.content : null;
    const text = content?.text;
    return typeof text === 'string' && text ? { thinkingDelta: text } : null;
  }

  if (deltaType === 'thought') {
    const thought = readStringField(delta, 'thought');
    if (thought) {
      return { thinkingDelta: thought };
    }

    const content = isRecord(delta.content) ? delta.content : null;
    const text = content?.text;
    return typeof text === 'string' && text ? { thinkingDelta: text } : null;
  }

  return null;
}
