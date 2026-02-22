import { describe, expect, it } from 'bun:test';
import type { ChatMessage } from '../../src/shared/chat';
import {
  buildOptimisticUserMessage,
  findLatestAssistantInteractionId,
} from '../../src/chatpanel/optimistic-message';

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
