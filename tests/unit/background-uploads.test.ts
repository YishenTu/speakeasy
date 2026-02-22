import { describe, expect, it } from 'bun:test';
import { uploadFilesToGemini } from '../../src/background/uploads';
import type { UploadFilePayload } from '../../src/shared/runtime';

async function toUploadPayload(file: File): Promise<UploadFilePayload> {
  return {
    name: file.name,
    mimeType: file.type,
    bytes: await file.arrayBuffer(),
  };
}

describe('background uploads', () => {
  it('returns empty upload payload when no files are provided', async () => {
    const payload = await uploadFilesToGemini([], 'test-key');

    expect(payload).toEqual({
      attachments: [],
      failures: [],
    });
  });

  it('throws when Gemini API key is missing', async () => {
    const file = await toUploadPayload(new File(['hello'], 'note.txt', { type: 'text/plain' }));

    await expect(uploadFilesToGemini([file], '   ')).rejects.toThrow(/api key is missing/i);
  });

  it('trims upload metadata and applies local mime-type fallbacks', async () => {
    const typedFile = await toUploadPayload(
      new File(['hello'], 'typed.txt', { type: 'text/plain' }),
    );
    const untypedFile = await toUploadPayload(new File([new Uint8Array([1, 2, 3])], 'bytes.bin'));

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

    const payload = await uploadFilesToGemini([typedFile, untypedFile], 'test-key', {
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

    expect(payload).toEqual({
      attachments: [
        {
          name: 'typed.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/typed',
        },
        {
          name: 'bytes.bin',
          mimeType: 'application/octet-stream',
          fileUri: 'https://example.invalid/files/untyped',
          fileName: 'remote-name',
        },
      ],
      failures: [],
    });
  });

  it('ignores remote mime-type overrides from upload responses', async () => {
    const file = await toUploadPayload(new File(['hello'], 'note.txt', { type: 'text/plain' }));

    const payload = await uploadFilesToGemini([file], 'test-key', {
      getGeminiClient: () => ({
        files: {
          upload: async () => ({
            uri: 'https://example.invalid/files/note',
            mimeType: 'image/svg+xml',
          }),
        },
      }),
    });

    expect(payload).toEqual({
      attachments: [
        {
          name: 'note.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/note',
        },
      ],
      failures: [],
    });
  });

  it('collects per-file failures without aborting remaining uploads', async () => {
    const okFile = await toUploadPayload(new File(['ok'], 'ok.txt', { type: 'text/plain' }));
    const badFile = await toUploadPayload(new File(['bad'], 'bad.txt', { type: 'text/plain' }));

    const payload = await uploadFilesToGemini([okFile, badFile], 'test-key', {
      getGeminiClient: () => ({
        files: {
          upload: async (input) => {
            if (input.file.name === 'ok.txt') {
              return {
                uri: 'https://example.invalid/files/ok',
                mimeType: 'text/plain',
              };
            }
            throw new Error('network unavailable');
          },
        },
      }),
    });

    expect(payload).toEqual({
      attachments: [
        {
          name: 'ok.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/ok',
        },
      ],
      failures: [{ index: 1, fileName: 'bad.txt', message: 'network unavailable' }],
    });
  });

  it('treats missing file URI responses as failures', async () => {
    const file = await toUploadPayload(new File(['hello'], 'note.txt', { type: 'text/plain' }));

    const payload = await uploadFilesToGemini([file], 'test-key', {
      getGeminiClient: () => ({
        files: {
          upload: async () => ({
            mimeType: 'text/plain',
          }),
        },
      }),
    });

    expect(payload.attachments).toEqual([]);
    expect(payload.failures).toEqual([
      {
        index: 0,
        fileName: 'note.txt',
        message: 'Failed to upload "note.txt": Gemini did not return a file URI.',
      },
    ]);
  });

  it('waits for processing uploads to become active before returning attachments', async () => {
    const file = await toUploadPayload(new File(['hello'], 'note.txt', { type: 'text/plain' }));
    let getCalls = 0;

    const payload = await uploadFilesToGemini(
      [file],
      'test-key',
      {
        getGeminiClient: () => ({
          files: {
            upload: async () => ({
              uri: 'https://example.invalid/files/note',
              mimeType: 'text/plain',
              name: 'files/123',
              state: 'PROCESSING',
            }),
            get: async () => {
              getCalls += 1;
              return {
                uri: 'https://example.invalid/files/note',
                mimeType: 'text/plain',
                name: 'files/123',
                state: getCalls < 2 ? 'PROCESSING' : 'ACTIVE',
              };
            },
          },
        }),
      },
      {
        uploadTimeoutMs: 2000,
      },
    );

    expect(getCalls).toBe(2);
    expect(payload).toEqual({
      attachments: [
        {
          name: 'note.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/note',
          fileName: 'files/123',
        },
      ],
      failures: [],
    });
  });

  it('returns a failure when uploaded file processing transitions to failed', async () => {
    const file = await toUploadPayload(new File(['hello'], 'note.txt', { type: 'text/plain' }));

    const payload = await uploadFilesToGemini(
      [file],
      'test-key',
      {
        getGeminiClient: () => ({
          files: {
            upload: async () => ({
              uri: 'https://example.invalid/files/note',
              mimeType: 'text/plain',
              name: 'files/123',
              state: 'PROCESSING',
            }),
            get: async () => ({
              uri: 'https://example.invalid/files/note',
              mimeType: 'text/plain',
              name: 'files/123',
              state: 'FAILED',
            }),
          },
        }),
      },
      {
        uploadTimeoutMs: 2000,
      },
    );

    expect(payload.attachments).toEqual([]);
    expect(payload.failures).toEqual([
      {
        index: 0,
        fileName: 'note.txt',
        message: 'Failed to process "note.txt" after upload.',
      },
    ]);
  });

  it('applies upload timeouts so stalled uploads do not hang forever', async () => {
    const file = await toUploadPayload(
      new File(['stalled'], 'stalled.txt', { type: 'text/plain' }),
    );

    const payload = await uploadFilesToGemini(
      [file],
      'test-key',
      {
        getGeminiClient: () => ({
          files: {
            upload: async () =>
              new Promise<{
                uri?: string;
                mimeType?: string;
                name?: string;
              }>(() => {}),
          },
        }),
      },
      {
        uploadTimeoutMs: 5,
      },
    );

    expect(payload.attachments).toEqual([]);
    expect(payload.failures).toEqual([
      {
        index: 0,
        fileName: 'stalled.txt',
        message: 'Upload timed out for "stalled.txt".',
      },
    ]);
  });
});
