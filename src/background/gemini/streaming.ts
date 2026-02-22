import { isRecord } from '../utils';
import { normalizeFunctionCallArgs, readStringField } from './common';
import type { GeminiInteraction, GeminiStreamDelta, StreamedFunctionCallDelta } from './contracts';

export function applyStreamOutputFallback(
  interaction: GeminiInteraction,
  fallback: { text: string; thoughtSummary: string; functionCalls: Array<Record<string, unknown>> },
): GeminiInteraction {
  if (Array.isArray(interaction.outputs) && interaction.outputs.length > 0) {
    return interaction;
  }

  const fallbackOutputs: Array<Record<string, unknown>> = [];
  if (fallback.functionCalls.length > 0) {
    fallbackOutputs.push(...fallback.functionCalls);
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
