import { describe, expect, it } from 'bun:test';
import { uploadFilesToGemini } from '../../src/chatpanel/uploads';
import type { RuntimeRequest } from '../../src/shared/runtime';

describe('chatpanel uploads', () => {
  it('returns empty list when no files were provided', async () => {
    let uploadCalls = 0;
    const attachments = await uploadFilesToGemini([], {
      uploadChatFiles: async () => {
        uploadCalls += 1;
        return {
          attachments: [],
          failures: [],
        };
      },
    });

    expect(attachments).toEqual([]);
    expect(uploadCalls).toBe(0);
  });

  it('forwards upload timeout option through chat upload bridge', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    let receivedTimeout: number | undefined;

    await uploadFilesToGemini(
      [file],
      {
        uploadChatFiles: async (_files, options) => {
          receivedTimeout = options.uploadTimeoutMs;
          return {
            attachments: [],
            failures: [{ index: 0, fileName: 'note.txt', message: 'timed out' }],
          };
        },
      },
      { uploadTimeoutMs: 50 },
    ).catch(() => undefined);

    expect(receivedTimeout).toBe(50);
  });

  it('returns successful uploaded attachments', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });

    const attachments = await uploadFilesToGemini([file], {
      uploadChatFiles: async () => ({
        attachments: [
          {
            name: 'note.txt',
            mimeType: 'text/plain',
            fileUri: 'https://example.invalid/files/note',
            fileName: 'remote-note',
          },
        ],
        failures: [],
      }),
    });

    expect(attachments).toEqual([
      {
        name: 'note.txt',
        mimeType: 'text/plain',
        fileUri: 'https://example.invalid/files/note',
        fileName: 'remote-note',
      },
    ]);
  });

  it('reports partial upload failures while returning successful attachments', async () => {
    const okFile = new File(['ok'], 'ok.txt', { type: 'text/plain' });
    const badFile = new File(['bad'], 'bad.txt', { type: 'text/plain' });
    const failureReports: Array<{ fileName: string; message: string }> = [];

    const attachments = await uploadFilesToGemini(
      [okFile, badFile],
      {
        uploadChatFiles: async () => ({
          attachments: [
            {
              name: 'ok.txt',
              mimeType: 'text/plain',
              fileUri: 'https://example.invalid/files/ok',
            },
          ],
          failures: [{ index: 1, fileName: 'bad.txt', message: 'network unavailable' }],
        }),
      },
      {
        onPartialFailure: (failures) => {
          for (const failure of failures) {
            failureReports.push({
              fileName: failure.file.name,
              message: failure.message,
            });
          }
        },
      },
    );

    expect(attachments).toEqual([
      {
        name: 'ok.txt',
        mimeType: 'text/plain',
        fileUri: 'https://example.invalid/files/ok',
      },
    ]);
    expect(failureReports).toEqual([
      {
        fileName: 'bad.txt',
        message: 'network unavailable',
      },
    ]);
  });

  it('throws when all file uploads fail', async () => {
    const file = new File(['bad'], 'bad.txt', { type: 'text/plain' });

    await expect(
      uploadFilesToGemini([file], {
        uploadChatFiles: async () => ({
          attachments: [],
          failures: [{ index: 0, fileName: 'bad.txt', message: 'request failed' }],
        }),
      }),
    ).rejects.toThrow(/request failed/i);
  });

  it('throws when upload bridge returns no attachments and no failures', async () => {
    const file = new File(['bad'], 'bad.txt', { type: 'text/plain' });

    await expect(
      uploadFilesToGemini([file], {
        uploadChatFiles: async () => ({
          attachments: [],
          failures: [],
        }),
      }),
    ).rejects.toThrow('Failed to upload selected file(s).');
  });

  it('uses background runtime upload path by default', async () => {
    const file = new File(['hello'], 'default.txt', { type: 'text/plain' });
    const runtimeRequests: RuntimeRequest[] = [];
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async (request: RuntimeRequest) => {
          runtimeRequests.push(request);
          return {
            ok: true,
            payload: {
              attachments: [
                {
                  name: 'default.txt',
                  mimeType: 'text/plain',
                  fileUri: 'https://example.invalid/files/default',
                },
              ],
              failures: [],
            },
          };
        },
      },
    };

    try {
      const attachments = await uploadFilesToGemini([file], {}, { uploadTimeoutMs: 44 });

      expect(attachments).toEqual([
        {
          name: 'default.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/default',
        },
      ]);
      expect(runtimeRequests).toHaveLength(1);
      expect(runtimeRequests[0]).toMatchObject({
        type: 'chat/upload-files',
        files: [{ name: 'default.txt', mimeType: expect.stringContaining('text/plain') }],
        uploadTimeoutMs: 44,
      });
      const firstRequest = runtimeRequests[0];
      if (firstRequest?.type !== 'chat/upload-files') {
        throw new Error('Expected upload runtime request.');
      }
      expect(firstRequest.files[0]?.bytesBase64).toBe('aGVsbG8=');
    } finally {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });
});
