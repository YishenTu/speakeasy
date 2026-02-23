import { describe, expect, it } from 'bun:test';
import {
  buildOptimisticUserMessage,
  findLatestAssistantInteractionId,
} from '../../src/chatpanel/optimistic-message';
import type { ChatMessage } from '../../src/shared/chat';

describe('chatpanel optimistic message', () => {
  it('keeps previous interaction id on optimistic user messages', () => {
    const message = buildOptimisticUserMessage('Draft prompt', [], ' interaction-1 ');

    expect(message).toMatchObject({
      role: 'user',
      content: 'Draft prompt',
      previousInteractionId: 'interaction-1',
    });
  });

  it('omits previous interaction id when it is blank', () => {
    const message = buildOptimisticUserMessage('Draft prompt', [], '   ');

    expect(message.previousInteractionId).toBeUndefined();
  });

  it('maps staged attachments and includes image preview URLs', () => {
    const imageFile = new File(['image-bytes'], 'photo.png', { type: 'IMAGE/PNG' });
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });

    const originalCreateObjectURL = URL.createObjectURL;
    const createObjectURLCalls: string[] = [];
    URL.createObjectURL = (blob: Blob): string => {
      createObjectURLCalls.push(blob instanceof File ? blob.name : 'blob');
      return `blob://preview/${createObjectURLCalls.length}`;
    };

    try {
      const message = buildOptimisticUserMessage(
        'Draft prompt',
        [
          {
            file: imageFile,
            name: 'photo.png',
            mimeType: 'IMAGE/PNG',
            uploadState: 'uploading',
          },
          {
            file: textFile,
            name: 'note.txt',
            mimeType: 'text/plain',
            uploadState: 'uploading',
          },
        ],
        undefined,
      );

      expect(message.attachments).toEqual([
        {
          name: 'photo.png',
          mimeType: 'IMAGE/PNG',
          previewUrl: 'blob://preview/1',
          uploadState: 'uploading',
        },
        {
          name: 'note.txt',
          mimeType: 'text/plain',
          uploadState: 'uploading',
        },
      ]);
      expect(createObjectURLCalls).toEqual(['photo.png']);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('omits attachments field when no staged files are provided', () => {
    const message = buildOptimisticUserMessage('Draft prompt', [], undefined);

    expect(message.attachments).toBeUndefined();
  });

  it('binds optimistic image previews to uploaded attachment file URIs', () => {
    const imageFile = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => 'blob://preview/uploaded';

    try {
      const message = buildOptimisticUserMessage(
        'Draft prompt',
        [
          {
            file: imageFile,
            name: 'photo.png',
            mimeType: 'image/png',
          },
        ],
        undefined,
        [
          {
            name: 'photo.png',
            mimeType: 'image/png',
            fileUri: 'https://example.invalid/files/photo',
          },
        ],
      );

      expect(message.attachments).toEqual([
        {
          name: 'photo.png',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/photo',
          previewUrl: 'blob://preview/uploaded',
        },
      ]);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('prefers staged blob previews over uploaded previewDataUrl for uploaded images', () => {
    const imageFile = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const originalCreateObjectURL = URL.createObjectURL;
    let createObjectURLCalls = 0;
    URL.createObjectURL = () => {
      createObjectURLCalls += 1;
      return 'blob://preview/uploaded';
    };

    try {
      const message = buildOptimisticUserMessage(
        'Draft prompt',
        [
          {
            file: imageFile,
            name: 'photo.png',
            mimeType: 'image/png',
          },
        ],
        undefined,
        [
          {
            name: 'photo.png',
            mimeType: 'image/png',
            fileUri: 'https://example.invalid/files/photo',
            previewDataUrl: 'data:image/png;base64,aGVsbG8=',
          },
        ],
      );

      expect(message.attachments).toEqual([
        {
          name: 'photo.png',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/photo',
          previewUrl: 'blob://preview/uploaded',
        },
      ]);
      expect(createObjectURLCalls).toBe(1);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('falls back to uploaded previewDataUrl when staged file context is unavailable', () => {
    const message = buildOptimisticUserMessage('Draft prompt', [], undefined, [
      {
        name: 'photo.png',
        mimeType: 'image/png',
        fileUri: 'https://example.invalid/files/photo',
        previewDataUrl: 'data:image/png;base64,aGVsbG8=',
      },
    ]);

    expect(message.attachments).toEqual([
      {
        name: 'photo.png',
        mimeType: 'image/png',
        fileUri: 'https://example.invalid/files/photo',
        previewUrl: 'data:image/png;base64,aGVsbG8=',
      },
    ]);
  });

  it('omits uploaded image preview when staged file context and previewDataUrl are both unavailable', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    let createObjectURLCalls = 0;
    URL.createObjectURL = () => {
      createObjectURLCalls += 1;
      return 'blob://preview/uploaded';
    };

    try {
      const message = buildOptimisticUserMessage('Draft prompt', [], undefined, [
        {
          name: 'photo.png',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/photo',
        },
      ]);

      expect(message.attachments).toEqual([
        {
          name: 'photo.png',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/photo',
        },
      ]);
      expect(createObjectURLCalls).toBe(0);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('finds the latest assistant interaction id in rendered messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'First prompt',
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'First answer',
        interactionId: 'interaction-1',
      },
      {
        id: 'u2',
        role: 'user',
        content: 'Second prompt',
        previousInteractionId: 'interaction-1',
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'Second answer',
        interactionId: ' ',
      },
      {
        id: 'a3',
        role: 'assistant',
        content: 'Third answer',
        interactionId: 'interaction-3',
      },
    ];

    expect(findLatestAssistantInteractionId(messages)).toBe('interaction-3');
  });

  it('returns undefined when no assistant interaction id exists', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Only prompt',
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'No id',
      },
    ];

    expect(findLatestAssistantInteractionId(messages)).toBeUndefined();
  });
});
