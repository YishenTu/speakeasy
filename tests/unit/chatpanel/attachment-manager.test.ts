import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createAttachmentManager } from '../../../src/chatpanel/attachment-manager';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

let env: InstalledDomEnvironment;

beforeAll(() => {
  env = installDomTestEnvironment();
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => 'blob:preview',
      writable: true,
    });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: () => {},
      writable: true,
    });
  }
});

afterAll(() => {
  env.restore();
});

describe('createAttachmentManager', () => {
  test('creates image previews for normalized image MIME types', () => {
    const filePreviews = document.createElement('div');
    const localAttachmentPreviewUrls = new Map<string, string>();
    const resizeCalls: number[] = [];
    const errorMessages: string[] = [];

    const createObjectUrlSpy = spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    const revokeObjectUrlSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const manager = createAttachmentManager({
      filePreviews,
      localAttachmentPreviewUrls,
      onResizeComposer: () => {
        resizeCalls.push(1);
      },
      onError: (message) => {
        errorMessages.push(message);
      },
      uploadFiles: async (files) =>
        files.map((file, index) => ({
          fileUri: `file-${index}`,
          name: file.name,
          mimeType: 'text/plain',
        })),
    });

    const file = new env.window.File(['data'], 'image.png', {
      type: 'IMAGE/PNG; charset=utf-8',
    }) as unknown as File;
    manager.stageFromFiles([file]);

    const staged = manager.getStaged();
    expect(staged).toHaveLength(1);
    expect(staged[0]?.previewUrl).toBe('blob:preview');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(filePreviews.querySelector('img')?.getAttribute('src')).toBe('blob:preview');
    expect(errorMessages).toEqual([]);
    expect(resizeCalls.length).toBeGreaterThan(0);

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });
});
