import { describe, expect, it } from 'bun:test';
import { GoogleGenAI } from '@google/genai';
import { uploadFilesToGemini } from '../../src/chatpanel/uploads';
import { GEMINI_SETTINGS_STORAGE_KEY } from '../../src/shared/settings';

describe('chatpanel uploads', () => {
  it('returns empty list when no files were provided', async () => {
    let readApiKeyCalls = 0;
    const attachments = await uploadFilesToGemini([], {
      readGeminiApiKey: async () => {
        readApiKeyCalls += 1;
        return 'unused';
      },
    });

    expect(attachments).toEqual([]);
    expect(readApiKeyCalls).toBe(0);
  });

  it('throws when Gemini API key is missing', async () => {
    await expect(
      uploadFilesToGemini([new File(['hello'], 'note.txt', { type: 'text/plain' })], {
        readGeminiApiKey: async () => '',
        getGeminiClient: () => {
          throw new Error('should not create client without API key');
        },
      }),
    ).rejects.toThrow(/api key is missing/i);
  });

  it('throws when Gemini upload response has no file URI', async () => {
    await expect(
      uploadFilesToGemini([new File(['hello'], 'note.txt', { type: 'text/plain' })], {
        readGeminiApiKey: async () => 'test-key',
        getGeminiClient: () => ({
          files: {
            upload: async () => ({
              mimeType: 'text/plain',
            }),
          },
        }),
      }),
    ).rejects.toThrow(/did not return a file uri/i);
  });

  it('throws when Gemini upload response has a blank file URI', async () => {
    await expect(
      uploadFilesToGemini([new File(['hello'], 'note.txt', { type: 'text/plain' })], {
        readGeminiApiKey: async () => 'test-key',
        getGeminiClient: () => ({
          files: {
            upload: async () => ({
              uri: '   ',
              mimeType: 'text/plain',
            }),
          },
        }),
      }),
    ).rejects.toThrow(/did not return a file uri/i);
  });

  it('trims upload metadata and applies mime-type fallbacks', async () => {
    const typedFile = new File(['hello'], 'typed.txt', { type: 'text/plain' });
    const untypedFile = new File([new Uint8Array([1, 2, 3])], 'bytes.bin');

    const responses = [
      {
        uri: ' https://example.invalid/files/typed ',
        mimeType: '   ',
        name: '   ',
      },
      {
        uri: ' https://example.invalid/files/untyped ',
        mimeType: ' text/csv ',
        name: ' remote-name ',
      },
    ];

    const attachments = await uploadFilesToGemini([typedFile, untypedFile], {
      readGeminiApiKey: async () => 'test-key',
      getGeminiClient: () => ({
        files: {
          upload: async () => {
            const next = responses.shift();
            if (!next) {
              throw new Error('unexpected upload call');
            }
            return next;
          },
        },
      }),
    });

    expect(attachments).toEqual([
      {
        name: 'typed.txt',
        mimeType: typedFile.type || 'text/plain',
        fileUri: 'https://example.invalid/files/typed',
      },
      {
        name: 'bytes.bin',
        mimeType: 'text/csv',
        fileUri: 'https://example.invalid/files/untyped',
        fileName: 'remote-name',
      },
    ]);
  });

  it('normalizes upload metadata for persisted attachments', async () => {
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const unknownMimeFile = new File([new Uint8Array([1, 2, 3])], 'blob.bin');

    const responses = [
      {
        uri: 'https://example.invalid/files/text',
        mimeType: 'text/markdown',
        name: 'gemini-file-1',
      },
      {
        uri: 'https://example.invalid/files/blob',
      },
    ];

    const attachments = await uploadFilesToGemini([textFile, unknownMimeFile], {
      readGeminiApiKey: async () => 'test-key',
      getGeminiClient: () => ({
        files: {
          upload: async () => {
            const next = responses.shift();
            if (!next) {
              throw new Error('unexpected upload call');
            }
            return next;
          },
        },
      }),
    });

    expect(attachments).toEqual([
      {
        name: 'note.txt',
        mimeType: 'text/markdown',
        fileUri: 'https://example.invalid/files/text',
        fileName: 'gemini-file-1',
      },
      {
        name: 'blob.bin',
        mimeType: 'application/octet-stream',
        fileUri: 'https://example.invalid/files/blob',
      },
    ]);
  });

  it('uses default dependencies to read settings and create Gemini clients', async () => {
    const inputFile = new File(['hello'], 'default.txt', { type: 'text/plain' });
    const probeClient = new GoogleGenAI({ apiKey: 'probe', apiVersion: 'v1beta' });
    const filesPrototype = Object.getPrototypeOf(probeClient.files) as {
      upload: (input: {
        file: File;
        config: {
          displayName: string;
          mimeType?: string;
        };
      }) => Promise<{ uri?: string; mimeType?: string; name?: string }>;
    };
    const originalUpload = filesPrototype.upload;
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const uploadCalls: Array<{
      fileName: string;
      displayName: string;
      mimeType: string | undefined;
    }> = [];

    filesPrototype.upload = async (input) => {
      uploadCalls.push({
        fileName: input.file.name,
        displayName: input.config.displayName,
        mimeType: input.config.mimeType,
      });
      return {
        uri: ' https://example.invalid/files/default ',
      };
    };
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => ({
            [GEMINI_SETTINGS_STORAGE_KEY]: {
              apiKey: '  test-key  ',
            },
          }),
        },
      },
    };

    try {
      const attachments = await uploadFilesToGemini([inputFile]);

      expect(attachments).toEqual([
        {
          name: 'default.txt',
          mimeType: inputFile.type || 'application/octet-stream',
          fileUri: 'https://example.invalid/files/default',
        },
      ]);
      expect(uploadCalls).toEqual([
        {
          fileName: 'default.txt',
          displayName: 'default.txt',
          mimeType: inputFile.type,
        },
      ]);
    } finally {
      filesPrototype.upload = originalUpload;
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });
});
