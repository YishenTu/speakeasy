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
          },
          {
            file: textFile,
            name: 'note.txt',
            mimeType: 'text/plain',
          },
        ],
        undefined,
      );

      expect(message.attachments).toEqual([
        {
          name: 'photo.png',
          mimeType: 'IMAGE/PNG',
          previewUrl: 'blob://preview/1',
        },
        {
          name: 'note.txt',
          mimeType: 'text/plain',
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
