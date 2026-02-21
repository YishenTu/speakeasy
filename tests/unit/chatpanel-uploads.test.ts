import { describe, expect, it } from 'bun:test';
import { uploadFilesToGemini } from '../../src/chatpanel/uploads';

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
});
