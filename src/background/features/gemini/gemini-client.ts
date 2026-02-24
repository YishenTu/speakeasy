import { GoogleGenAI } from '@google/genai';
import { getOrCreateBoundedCacheValue } from '../../../shared/bounded-cache';

const MAX_GEMINI_CLIENT_CACHE_SIZE = 6;
const geminiClients = new Map<string, GoogleGenAI>();

export function getGeminiClient(apiKey: string): GoogleGenAI {
  return getOrCreateBoundedCacheValue({
    cache: geminiClients,
    key: apiKey,
    maxSize: MAX_GEMINI_CLIENT_CACHE_SIZE,
    create: () =>
      new GoogleGenAI({
        apiKey,
        apiVersion: 'v1beta',
      }),
  });
}
