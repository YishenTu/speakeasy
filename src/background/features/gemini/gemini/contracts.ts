import type { GoogleGenAI } from '@google/genai';
import type { GeminiFunctionCall } from '../../session/types';

export type SDKCreateInteractionRequest = Parameters<GoogleGenAI['interactions']['create']>[0];

export interface LocalToolDefinition {
  declaration: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface GeminiInteraction {
  id: string;
  outputs?: Array<Record<string, unknown>>;
  usage?: GeminiInteractionUsage;
}

export interface GeminiStreamDelta {
  textDelta?: string;
  thinkingDelta?: string;
}

export interface GeminiInteractionUsage {
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalThoughtTokens?: number;
  totalToolUseTokens?: number;
  totalCachedTokens?: number;
  totalTokens?: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  toolUseTokens: number;
  cachedTokens: number;
  totalTokens: number;
  hasInputTokens: boolean;
  hasOutputTokens: boolean;
  hasThoughtTokens: boolean;
  hasToolUseTokens: boolean;
  hasCachedTokens: boolean;
  hasTotalTokens: boolean;
}

export interface ExecutedFunctionCall {
  call: GeminiFunctionCall;
  response: Record<string, unknown>;
  isError?: boolean;
}

export interface StreamedFunctionCallDelta {
  order: number;
  id?: string;
  name: string;
  argumentsObject?: Record<string, unknown>;
  argumentChunks: string[];
}
