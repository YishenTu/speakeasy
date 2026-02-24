import type { GeminiSettings } from '../../../../shared/settings';
import { isRecord } from '../../../core/utils';
import { getGeminiClient } from '../gemini-client';
import { readStringField } from './common';
import type {
  GeminiInteraction,
  GeminiStreamDelta,
  SDKCreateInteractionRequest,
  StreamedFunctionCallDelta,
} from './contracts';
import { asInvalidPreviousInteractionIdError } from './errors';
import { normalizeGeminiInteractionResponse } from './interaction-normalize';
import {
  type StreamedToolOutputDelta,
  applyStreamOutputFallback,
  buildStreamedFunctionCallOutputs,
  buildStreamedToolOutputs,
  collectStreamedFunctionCallDelta,
  collectStreamedToolOutputDelta,
  extractStreamDelta,
  isAsyncIterable,
} from './streaming';

export async function callGeminiInteraction(input: {
  settings: GeminiSettings;
  request: unknown;
}): Promise<GeminiInteraction> {
  const response = await createInteraction(input.settings.apiKey, input.request);
  return normalizeGeminiInteractionResponse(response);
}

export async function callGeminiInteractionStream(input: {
  settings: GeminiSettings;
  request: unknown;
  onStreamDelta: (delta: GeminiStreamDelta) => void;
}): Promise<GeminiInteraction> {
  const streamRequest = {
    ...(input.request as Record<string, unknown>),
    stream: true,
  };

  const stream = await createInteraction(input.settings.apiKey, streamRequest);

  if (!isAsyncIterable(stream)) {
    throw new Error('Gemini streaming response payload was not an async iterable.');
  }

  let completedInteraction: GeminiInteraction | null = null;
  const streamedTextChunks: string[] = [];
  const streamedThoughtChunks: string[] = [];
  const streamedFunctionCallDeltas = new Map<string, StreamedFunctionCallDelta>();
  const streamedToolOutputDeltas = new Map<string, StreamedToolOutputDelta>();
  for await (const rawEvent of stream) {
    if (!isRecord(rawEvent)) {
      continue;
    }

    switch (readStringField(rawEvent, 'event_type')) {
      case 'content.delta': {
        collectStreamedFunctionCallDelta(rawEvent, streamedFunctionCallDeltas);
        collectStreamedToolOutputDelta(rawEvent, streamedToolOutputDeltas);
        const delta = extractStreamDelta(rawEvent);
        if (delta) {
          input.onStreamDelta(delta);
          if (delta.textDelta) streamedTextChunks.push(delta.textDelta);
          if (delta.thinkingDelta) streamedThoughtChunks.push(delta.thinkingDelta);
        }
        break;
      }
      case 'interaction.complete': {
        if (!isRecord(rawEvent.interaction)) {
          throw new Error(
            'Gemini interaction.complete event did not include an interaction payload.',
          );
        }
        completedInteraction = normalizeGeminiInteractionResponse(rawEvent.interaction);
        break;
      }
      case 'error': {
        const rawError = rawEvent.error;
        const errorRecord = isRecord(rawError) ? rawError : null;
        const message =
          typeof rawError === 'string'
            ? rawError.trim()
            : errorRecord
              ? readStringField(errorRecord, 'message')
              : '';
        const streamError = new Error(message || 'Gemini streaming interaction failed.');
        const classifiedError = asInvalidPreviousInteractionIdError(
          errorRecord ?? (typeof rawError === 'string' ? rawError : rawEvent),
          streamError,
        );
        if (classifiedError) {
          throw classifiedError;
        }
        throw streamError;
      }
    }
  }

  if (!completedInteraction) {
    throw new Error('Gemini stream ended before interaction.complete was received.');
  }

  return applyStreamOutputFallback(completedInteraction, {
    text: streamedTextChunks.join(''),
    thoughtSummary: streamedThoughtChunks.join(''),
    functionCalls: buildStreamedFunctionCallOutputs(streamedFunctionCallDeltas),
    toolOutputs: buildStreamedToolOutputs(streamedToolOutputDeltas),
  });
}

async function createInteraction(apiKey: string, request: unknown): Promise<unknown> {
  const client = getGeminiClient(apiKey);
  try {
    return (await client.interactions.create(
      request as unknown as SDKCreateInteractionRequest,
    )) as unknown;
  } catch (error: unknown) {
    const classifiedError = asInvalidPreviousInteractionIdError(error);
    if (classifiedError) {
      throw classifiedError;
    }
    throw error;
  }
}
