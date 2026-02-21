import { describe, expect, it } from 'bun:test';
import {
  createSession,
  mapSessionToChatMessages,
  toAssistantChatMessage,
} from '../../src/background/sessions';
import type { ChatSession } from '../../src/background/types';

describe('sessions', () => {
  it('createSession returns independent session objects', () => {
    const first = createSession();
    const second = createSession();

    expect(first.id.length).toBeGreaterThan(0);
    expect(second.id.length).toBeGreaterThan(0);
    expect(first.id).not.toBe(second.id);
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
          parts: [{ text: 'Answer with stats' }],
          metadata: {
            responseStats: {
              requestDurationMs: 800,
              timeToFirstTokenMs: 120,
              outputTokens: 40,
              totalTokens: 90,
              outputTokensPerSecond: 58.5,
              totalTokensPerSecond: 112.5,
              hasStreamingToken: true,
            },
          },
        },
        {
          role: 'model',
          parts: [{ thoughtSummary: 'Compared two parsing strategies.' }],
        },
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

    expect(messages).toHaveLength(5);
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
      content: 'Answer with stats',
      stats: {
        requestDurationMs: 800,
        timeToFirstTokenMs: 120,
        outputTokens: 40,
        totalTokens: 90,
        outputTokensPerSecond: 58.5,
        totalTokensPerSecond: 112.5,
        hasStreamingToken: true,
      },
    });
    expect(messages[3]).toMatchObject({
      role: 'assistant',
      content: '',
      thinkingSummary: 'Compared two parsing strategies.',
    });
    expect(messages[4]).toMatchObject({
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

  it('does not use fallback content when thinking summary exists', () => {
    const message = toAssistantChatMessage({
      role: 'model',
      parts: [{ thoughtSummary: 'Validated boundary behavior.' }],
    });

    expect(message.role).toBe('assistant');
    expect(message.content).toBe('');
    expect(message.thinkingSummary).toBe('Validated boundary behavior.');
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

  it('maps assistant response stats from content metadata', () => {
    const message = toAssistantChatMessage({
      role: 'model',
      parts: [{ text: 'Measured answer' }],
      metadata: {
        responseStats: {
          requestDurationMs: 950,
          timeToFirstTokenMs: 140,
          inputTokens: 21,
          outputTokens: 44,
          totalTokens: 95,
          outputTokensPerSecond: 54.32,
          totalTokensPerSecond: 100,
          hasStreamingToken: true,
        },
      },
    });

    expect(message.stats).toEqual({
      requestDurationMs: 950,
      timeToFirstTokenMs: 140,
      inputTokens: 21,
      outputTokens: 44,
      totalTokens: 95,
      outputTokensPerSecond: 54.32,
      totalTokensPerSecond: 100,
      hasStreamingToken: true,
    });
  });

  it('createSession produces empty content history', () => {
    const session = createSession();
    expect(session.contents).toEqual([]);
    expect(session.createdAt).toBe(session.updatedAt);
  });
});
