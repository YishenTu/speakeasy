import { describe, expect, it } from 'bun:test';
import {
  createSession,
  getOrCreateSession,
  mapSessionToChatMessages,
  toAssistantChatMessage,
} from '../../src/background/sessions';
import type { ChatSession } from '../../src/background/types';

describe('sessions', () => {
  it('creates sessions and returns existing session when chatId is known', () => {
    const sessions: Record<string, ChatSession> = {};

    const created = getOrCreateSession(sessions, undefined);
    expect(created.id.length).toBeGreaterThan(0);
    expect(sessions[created.id]).toBe(created);

    const resolved = getOrCreateSession(sessions, created.id);
    expect(resolved).toBe(created);
  });

  it('maps persisted content to chat messages and keeps attachment-only entries', () => {
    const session: ChatSession = {
      id: 'chat-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      contents: [
        { role: 'user', parts: [{ text: 'Question' }] },
        { role: 'model', parts: [{ text: 'Answer' }] },
        {
          role: 'model',
          parts: [
            {
              fileData: {
                fileUri: 'https://example.invalid/files/image.png',
                mimeType: 'image/png',
                displayName: 'image.png',
              },
            },
          ],
        },
        { role: 'model', parts: [{ unknown: true }] },
      ],
    };

    const messages = mapSessionToChatMessages(session);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'Question',
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Answer',
    });
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: '',
      attachments: [
        {
          name: 'image.png',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/image.png',
        },
      ],
    });
  });

  it('provides a fallback assistant message when content is not displayable', () => {
    const message = toAssistantChatMessage({
      role: 'model',
      parts: [{ someHiddenPayload: true }],
    });

    expect(message.role).toBe('assistant');
    expect(message.content).toBe('Gemini returned a response with no displayable text.');
  });

  it('returns attachment metadata for attachment-only assistant responses', () => {
    const message = toAssistantChatMessage({
      role: 'model',
      parts: [
        {
          fileData: {
            fileUri: 'https://example.invalid/files/report.pdf',
            mimeType: 'application/pdf',
            displayName: 'report.pdf',
          },
        },
      ],
    });

    expect(message.role).toBe('assistant');
    expect(message.content).toBe('');
    expect(message.attachments).toEqual([
      {
        name: 'report.pdf',
        mimeType: 'application/pdf',
        fileUri: 'https://example.invalid/files/report.pdf',
      },
    ]);
  });

  it('createSession produces empty content history', () => {
    const session = createSession();
    expect(session.contents).toEqual([]);
    expect(session.createdAt).toBe(session.updatedAt);
  });
});
