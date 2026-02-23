import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import {
  createAttachmentManager,
  withAttachmentPreviewDataUrls,
} from '../../../src/chatpanel/attachment-manager';
import { ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH } from '../../../src/shared/attachment-preview';
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
    let resizeCount = 0;
    const errorMessages: string[] = [];

    const createObjectUrlSpy = spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    const revokeObjectUrlSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const manager = createAttachmentManager({
      filePreviews,
      localAttachmentPreviewUrls,
      onResizeComposer: () => {
        resizeCount += 1;
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
    const previewImage = filePreviews.querySelector('img');
    expect(previewImage?.getAttribute('src')).toBe('blob:preview');
    expect(previewImage?.classList.contains('previewable-image')).toBe(true);
    expect((previewImage as HTMLImageElement | null)?.dataset.speakeasyPreviewImage).toBe('true');
    expect(errorMessages).toEqual([]);
    expect(resizeCount).toBeGreaterThan(0);

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  test('generates downscaled preview data URLs for oversized images to keep previews persistent', async () => {
    const originalImage = (globalThis as { Image?: typeof Image }).Image;
    const originalCreateElement = document.createElement.bind(document);
    let dataUrlCallCount = 0;

    const createObjectUrlSpy = spyOn(URL, 'createObjectURL').mockReturnValue(
      'blob:oversized-image',
    );
    const revokeObjectUrlSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const createElementSpy = spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      if (tagName.toLowerCase() !== 'canvas') {
        return originalCreateElement(tagName, options);
      }

      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          clearRect: () => {},
          drawImage: () => {},
        }),
        toDataURL: () => {
          dataUrlCallCount += 1;
          const base64Length =
            dataUrlCallCount === 1 ? ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH : 128;
          return `data:image/png;base64,${'A'.repeat(base64Length)}`;
        },
      };

      return canvas as unknown as HTMLElement;
    }) as typeof document.createElement);

    class MockImage {
      width = 2400;
      height = 1800;
      naturalWidth = 2400;
      naturalHeight = 1800;
      onload: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      set src(_value: string) {
        this.onload?.(new Event('load'));
      }
    }

    (globalThis as { Image?: typeof Image }).Image = MockImage as unknown as typeof Image;

    try {
      const oversizedImage = new env.window.File([new Uint8Array(400 * 1024)], 'capture.png', {
        type: 'image/png',
      }) as unknown as File;

      const attachments = await withAttachmentPreviewDataUrls(
        [
          {
            fileUri: 'file-1',
            name: 'capture.png',
            mimeType: 'image/png',
          },
        ],
        [
          {
            id: 'staged-1',
            file: oversizedImage,
            name: 'capture.png',
            mimeType: 'image/png',
            uploadState: 'uploaded',
          },
        ],
      );

      expect(dataUrlCallCount).toBeGreaterThan(1);
      expect(attachments[0]?.previewDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(attachments[0]?.previewDataUrl?.length ?? 0).toBeLessThanOrEqual(
        ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH,
      );
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as { Image?: typeof Image }).Image = originalImage;
      createElementSpy.mockRestore();
      createObjectUrlSpy.mockRestore();
      revokeObjectUrlSpy.mockRestore();
    }
  });

  test('copies markdown preview text into uploaded attachment metadata', async () => {
    const markdownFile = new env.window.File(['# Hello\n\nworld'], 'notes.md', {
      type: 'text/plain',
    }) as unknown as File;

    const attachments = await withAttachmentPreviewDataUrls(
      [
        {
          fileUri: 'file-1',
          name: 'notes.md',
          mimeType: 'text/plain',
        },
      ],
      [
        {
          id: 'staged-1',
          file: markdownFile,
          name: 'notes.md',
          mimeType: 'text/plain',
          previewText: '# Hello\n\nworld',
          uploadState: 'uploaded',
        },
      ],
    );

    expect(attachments).toEqual([
      {
        fileUri: 'file-1',
        name: 'notes.md',
        mimeType: 'text/plain',
        previewText: '# Hello\n\nworld',
      },
    ]);
  });
});
