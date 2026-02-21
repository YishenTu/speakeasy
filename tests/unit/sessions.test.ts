import { beforeEach, describe, expect, it } from 'bun:test';
import {
  createSession,
  getOrCreateSession,
  mapSessionToChatMessages,
  readSessions,
  toAssistantChatMessage,
  writeSessions,
} from '../../src/background/sessions';
import type { ChatSession } from '../../src/background/types';

const CHAT_SESSIONS_STORAGE_KEY = 'chatSessions';

const storageState: Record<string, unknown> = {};

function installChromeStorageMock(): void {
  const chromeMock = {
    storage: {
      local: {
        get: async (query?: string | string[] | Record<string, unknown>) => {
          if (typeof query === 'string') {
            return { [query]: storageState[query] };
          }

          if (Array.isArray(query)) {
            const result: Record<string, unknown> = {};
            for (const key of query) {
              result[key] = storageState[key];
            }
            return result;
          }

          if (query && typeof query === 'object') {
            const result: Record<string, unknown> = {};
            for (const key of Object.keys(query)) {
              result[key] = storageState[key] ?? query[key];
            }
            return result;
          }

          return { ...storageState };
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storageState, items);
        },
      },
    },
  };

  (globalThis as { chrome?: unknown }).chrome = chromeMock;
}

function clearStorage(): void {
  for (const key of Object.keys(storageState)) {
    delete storageState[key];
  }
}

function buildSession(id: string, updatedAt: string): ChatSession {
  return {
    id,
    createdAt: updatedAt,
    updatedAt,
    contents: [
      {
        role: 'user',
        parts: [{ text: `prompt-${id}` }],
      },
    ],
  };
}

describe('sessions', () => {
  beforeEach(() => {
    clearStorage();
    installChromeStorageMock();
  });

  it('creates sessions and returns existing session when chatId is known', () => {
    const sessions: Record<string, ChatSession> = {};

    const created = getOrCreateSession(sessions, undefined);
    expect(created.id.length).toBeGreaterThan(0);
    expect(sessions[created.id]).toBe(created);

    const resolved = getOrCreateSession(sessions, created.id);
    expect(resolved).toBe(created);
  });

  it('writes only the most recent bounded set of sessions', async () => {
    const sessions: Record<string, ChatSession> = {};

    for (let index = 0; index < 30; index += 1) {
      const timestamp = new Date(Date.UTC(2024, 0, 1, 0, index, 0)).toISOString();
      const id = `session-${index}`;
      sessions[id] = buildSession(id, timestamp);
    }

    await writeSessions(sessions);

    const stored = (storageState[CHAT_SESSIONS_STORAGE_KEY] ?? {}) as Record<string, ChatSession>;
    expect(Object.keys(stored)).toHaveLength(25);
    expect(stored['session-29']).toBeDefined();
    expect(stored['session-5']).toBeDefined();
    expect(stored['session-4']).toBeUndefined();
  });

  it('skips malformed persisted sessions and malformed content parts', async () => {
    const malformedPersisted = {
      good: {
        id: 'good',
        createdAt: '',
        updatedAt: 123,
        contents: [
          { role: 'model', parts: [{ text: 'valid reply' }] },
          { role: 'model', parts: [] },
          { role: 'model' },
          'not-an-object',
        ],
      },
      bad: 'not-a-session',
    };

    storageState[CHAT_SESSIONS_STORAGE_KEY] = malformedPersisted;

    const sessions = await readSessions();
    expect(Object.keys(sessions)).toEqual(['good']);

    const parsed = sessions.good;
    expect(parsed).toBeDefined();
    expect(parsed?.id).toBe('good');
    expect(parsed?.contents).toEqual([{ role: 'model', parts: [{ text: 'valid reply' }] }]);
    expect(typeof parsed?.createdAt).toBe('string');
    expect(parsed?.createdAt.length).toBeGreaterThan(0);
    expect(parsed?.updatedAt).toBe(parsed?.createdAt);
  });

  it('returns empty sessions when persisted data is not an object', async () => {
    storageState[CHAT_SESSIONS_STORAGE_KEY] = 'invalid-store';

    const sessions = await readSessions();

    expect(sessions).toEqual({});
  });

  it('preserves persisted interaction ids for server-side conversation continuity', async () => {
    storageState[CHAT_SESSIONS_STORAGE_KEY] = {
      chained: {
        id: 'chained',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        lastInteractionId: 'interaction-123',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
    };

    const sessions = await readSessions();

    expect(sessions.chained?.lastInteractionId).toBe('interaction-123');
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
