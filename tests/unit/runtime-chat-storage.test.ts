import { beforeEach, describe, expect, it } from 'bun:test';
import type { ChatRepository } from '../../src/background/chat-repository';
import { InvalidPreviousInteractionIdError } from '../../src/background/gemini';
import { createRuntimeRequestHandler } from '../../src/background/runtime';
import type { ChatSession, GeminiContent } from '../../src/background/types';
import type { RuntimeRequest } from '../../src/shared/runtime';
import type { GeminiSettings } from '../../src/shared/settings';
import { defaultGeminiSettings } from '../../src/shared/settings';

class InMemoryChatRepository implements ChatRepository {
  readonly sessions = new Map<string, ChatSession>();
  readonly upsertCalls: ChatSession[] = [];
  readonly deleteCalls: string[] = [];
  pruneCallCount = 0;

  async getSession(chatId: string): Promise<ChatSession | null> {
    const existing = this.sessions.get(chatId);
    return existing ? cloneSession(existing) : null;
  }

  async upsertSession(session: ChatSession): Promise<void> {
    const cloned = cloneSession(session);
    this.upsertCalls.push(cloned);
    this.sessions.set(cloned.id, cloned);
  }

  async deleteSession(chatId: string): Promise<boolean> {
    this.deleteCalls.push(chatId);
    return this.sessions.delete(chatId);
  }

  async listSessions(): Promise<ChatSession[]> {
    return [...this.sessions.values()]
      .map((session) => cloneSession(session))
      .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  }

  async pruneExpiredSessions(): Promise<number> {
    this.pruneCallCount += 1;
    return 0;
  }
}

function createSettings(): GeminiSettings {
  const settings = defaultGeminiSettings();
  settings.apiKey = 'test-api-key';
  settings.model = 'gemini-3-flash-preview';
  return settings;
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    contents: session.contents.map((content) => ({
      role: content.role,
      parts: content.parts.map((part) => ({ ...part })),
    })),
  };
}

function createSession(id: string): ChatSession {
  return {
    id,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
  };
}

describe('runtime chat storage handler', () => {
  let repository: InMemoryChatRepository;
  let bootstrapCalls: number;
  let settingsReadCalls: number;

  beforeEach(() => {
    repository = new InMemoryChatRepository();
    bootstrapCalls = 0;
    settingsReadCalls = 0;
  });

  it('supports new/load/list/delete flow against repository storage', async () => {
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {
        bootstrapCalls += 1;
      },
      readGeminiSettings: async () => {
        settingsReadCalls += 1;
        return createSettings();
      },
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'assistant reply' }],
        };
        session.contents.push(assistantContent);
        session.lastInteractionId = 'interaction-1';
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    });

    const newPayload = await handler({ type: 'chat/new' });
    const rawChatId = (newPayload as { chatId: unknown }).chatId;
    expect(typeof rawChatId === 'string' || rawChatId instanceof String).toBe(true);
    const chatId = typeof rawChatId === 'string' ? rawChatId : rawChatId.valueOf();
    expect(chatId.length).toBeGreaterThan(0);
    expect(repository.upsertCalls.at(0)?.id).toBe(chatId);
    expect(repository.sessions.has(chatId)).toBe(true);
    const loadPayload = await handler({ type: 'chat/load', chatId });
    expect(loadPayload).toMatchObject({ chatId, messages: [] });

    repository.sessions.set('chat-send', createSession('chat-send'));
    const sendPayload = await handler({
      type: 'chat/send',
      chatId: 'chat-send',
      text: 'next',
      model: 'gemini-3-flash-preview',
    });
    expect(sendPayload).toMatchObject({
      chatId: 'chat-send',
      assistantMessage: { role: 'assistant', content: 'assistant reply' },
    });

    const deletePayload = await handler({ type: 'chat/delete', chatId: 'chat-send' });
    expect(deletePayload).toEqual({ deleted: true, chatId: null });

    const listPayload = await handler({ type: 'chat/list' });
    expect(listPayload).toMatchObject({
      sessions: [{ chatId, title: expect.anything(), updatedAt: expect.anything() }],
    });
    expect((listPayload as { sessions: Array<{ chatId: string }> }).sessions).toHaveLength(1);
    expect(bootstrapCalls).toBe(1);
    expect(settingsReadCalls).toBe(1);
  });

  it('serializes mutations and makes load wait for in-flight send', async () => {
    repository.sessions.set('chat-1', createSession('chat-1'));
    let releaseSend: (() => void) | null = null;

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        await new Promise<void>((resolve) => {
          releaseSend = resolve;
        });
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'queued assistant reply' }],
        };
        session.contents.push(assistantContent);
        session.lastInteractionId = 'interaction-2';
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    });

    const sendPromise = handler({
      type: 'chat/send',
      chatId: 'chat-1',
      text: 'queued',
      model: 'gemini-3-flash-preview',
    });

    let loadResolved = false;
    const loadPromise = handler({ type: 'chat/load', chatId: 'chat-1' }).then((payload) => {
      loadResolved = true;
      return payload;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(loadResolved).toBe(false);

    while (!releaseSend) {
      await Promise.resolve();
    }

    releaseSend();
    await sendPromise;
    const loadPayload = await loadPromise;

    expect(loadPayload).toMatchObject({
      chatId: 'chat-1',
    });
    expect(loadPayload.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'queued assistant reply',
    });
  });

  it('does not persist failed send attempts', async () => {
    repository.sessions.set('chat-2', createSession('chat-2'));

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('Gemini unavailable');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    });

    await expect(
      handler({
        type: 'chat/send',
        chatId: 'chat-2',
        text: 'will fail',
        model: 'gemini-3-flash-preview',
      }),
    ).rejects.toThrow(/unavailable/i);

    expect(repository.upsertCalls).toHaveLength(0);
    expect(repository.sessions.get('chat-2')?.contents).toHaveLength(1);
  });

  it('resets continuation token on invalid previous interaction id errors', async () => {
    const chained = createSession('chat-3');
    chained.lastInteractionId = 'interaction-old';
    repository.sessions.set('chat-3', chained);

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new InvalidPreviousInteractionIdError('invalid previous interaction id', {
          status: 400,
        });
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    });

    await expect(
      handler({
        type: 'chat/send',
        chatId: 'chat-3',
        text: 'retry',
        model: 'gemini-3-flash-preview',
      }),
    ).rejects.toThrow(/resend your last message/i);

    const resetSession = repository.sessions.get('chat-3');
    expect(resetSession?.lastInteractionId).toBeUndefined();
    expect(resetSession?.contents).toHaveLength(1);
    expect(repository.upsertCalls).toHaveLength(1);
  });

  it('opens options through runtime request', async () => {
    let opened = false;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      openOptionsPage: async () => {
        opened = true;
      },
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    });

    const payload = await handler({ type: 'app/open-options' } as RuntimeRequest);
    expect(payload).toEqual({ opened: true });
    expect(opened).toBe(true);
  });
});
