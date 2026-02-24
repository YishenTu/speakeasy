import { describe, expect, it, spyOn } from 'bun:test';
import { createLocalAttachmentPreviewCache } from '../../../src/chatpanel/features/preview/local-preview-cache';
import type { ChatMessage } from '../../../src/shared/chat';

describe('chatpanel local attachment preview cache', () => {
  it('applies remembered local preview url and preview text to reloaded messages', () => {
    const cache = createLocalAttachmentPreviewCache();
    cache.remember({
      id: 'assistant-live',
      role: 'assistant',
      content: 'streaming',
      attachments: [
        {
          name: 'shot.png',
          mimeType: 'image/png',
          fileUri: 'file://shot',
          previewUrl: 'blob://shot-preview',
          previewText: '# draft',
        },
      ],
    });

    const reloaded = cache.apply([
      {
        id: 'assistant-saved',
        role: 'assistant',
        content: 'saved',
        attachments: [
          {
            name: 'shot.png',
            mimeType: 'image/png',
            fileUri: 'file://shot',
          },
        ],
      },
    ] satisfies ChatMessage[]);

    expect(reloaded[0]?.attachments).toEqual([
      {
        name: 'shot.png',
        mimeType: 'image/png',
        fileUri: 'file://shot',
        previewUrl: 'blob://shot-preview',
        previewText: '# draft',
      },
    ]);
  });

  it('keeps existing blob previews when later payloads provide non-blob previews', () => {
    const cache = createLocalAttachmentPreviewCache();
    cache.remember({
      id: 'assistant-live',
      role: 'assistant',
      content: 'streaming',
      attachments: [
        {
          name: 'shot.png',
          mimeType: 'image/png',
          fileUri: 'file://shot',
          previewUrl: 'blob://shot-preview',
        },
      ],
    });
    cache.remember({
      id: 'assistant-saved',
      role: 'assistant',
      content: 'saved',
      attachments: [
        {
          name: 'shot.png',
          mimeType: 'image/png',
          fileUri: 'file://shot',
          previewUrl: 'data:image/png;base64,aGVsbG8=',
        },
      ],
    });

    expect(cache.previewUrlsByFileUri.get('file://shot')).toBe('blob://shot-preview');
  });

  it('prunes stale blob previews and revokes object urls', () => {
    const revokeSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const cache = createLocalAttachmentPreviewCache();
    cache.remember({
      id: 'assistant-live',
      role: 'assistant',
      content: 'streaming',
      attachments: [
        {
          name: 'shot.png',
          mimeType: 'image/png',
          fileUri: 'file://shot',
          previewUrl: 'blob://shot-preview',
        },
      ],
    });
    cache.remember({
      id: 'assistant-live-2',
      role: 'assistant',
      content: 'streaming',
      attachments: [
        {
          name: 'doc.txt',
          mimeType: 'text/plain',
          fileUri: 'file://doc',
          previewText: 'notes',
        },
      ],
    });

    cache.prune([
      {
        id: 'assistant-saved',
        role: 'assistant',
        content: 'saved',
        attachments: [
          {
            name: 'doc.txt',
            mimeType: 'text/plain',
            fileUri: 'file://doc',
            previewText: 'notes',
          },
        ],
      },
    ]);

    expect(revokeSpy).toHaveBeenCalledWith('blob://shot-preview');
    expect(cache.previewUrlsByFileUri.has('file://shot')).toBe(false);
    revokeSpy.mockRestore();
  });
});
