import { GoogleGenAI } from '@google/genai';
import type { FileDataAttachmentPayload } from '../shared/runtime';
import { GEMINI_SETTINGS_STORAGE_KEY, normalizeGeminiSettings } from '../shared/settings';

const MAX_GEMINI_CLIENT_CACHE_SIZE = 2;
const geminiClients = new Map<string, GoogleGenAI>();

export async function uploadFilesToGemini(files: File[]): Promise<FileDataAttachmentPayload[]> {
  if (files.length === 0) {
    return [];
  }

  const apiKey = await readGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }

  const client = getGeminiClient(apiKey);
  const uploadedAttachments: FileDataAttachmentPayload[] = [];

  for (const file of files) {
    const upload = await client.files.upload({
      file,
      config: {
        displayName: file.name,
        ...(file.type ? { mimeType: file.type } : {}),
      },
    });

    const fileUri = typeof upload.uri === 'string' ? upload.uri.trim() : '';
    if (!fileUri) {
      throw new Error(`Failed to upload "${file.name}": Gemini did not return a file URI.`);
    }

    const mimeType = typeof upload.mimeType === 'string' ? upload.mimeType.trim() : '';
    const normalizedMimeType = mimeType || file.type || 'application/octet-stream';
    const fileName = typeof upload.name === 'string' ? upload.name.trim() : '';

    uploadedAttachments.push({
      name: file.name,
      mimeType: normalizedMimeType,
      fileUri,
      ...(fileName ? { fileName } : {}),
    });
  }

  return uploadedAttachments;
}

async function readGeminiApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get(GEMINI_SETTINGS_STORAGE_KEY);
  const settings = normalizeGeminiSettings(stored[GEMINI_SETTINGS_STORAGE_KEY]);
  return settings.apiKey.trim();
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
