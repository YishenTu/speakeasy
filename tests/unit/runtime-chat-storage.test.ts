import { beforeEach, describe, expect, it } from 'bun:test';
import type { ChatRepository } from '../../src/background/chat-repository';
import {
  InvalidPreviousInteractionIdError,
  completeAssistantTurn,
} from '../../src/background/gemini';
import { createRuntimeRequestHandler } from '../../src/background/runtime';
import type { ChatSession, GeminiContent } from '../../src/background/types';
import type { RuntimeRequest } from '../../src/shared/runtime';
import type { GeminiSettings } from '../../src/shared/settings';
import { defaultGeminiSettings } from '../../src/shared/settings';

class InMemoryChatRepository implements ChatRepository {
  readonly sessions = new Map<string, ChatSession>();
  readonly upsertCalls: ChatSession[] = [];
  readonly deleteCalls: string[] = [];
  upsertFailurePredicate: ((session: ChatSession) => Error | null) | null = null;
  readonly pruneFailureCalls = new Set<number>();
  pruneFailureError: Error = new Error('prune failed');
  pruneCallCount = 0;

  async getSession(chatId: string): Promise<ChatSession | null> {
    const existing = this.sessions.get(chatId);
    return existing ? cloneSession(existing) : null;
  }

  async upsertSession(session: ChatSession): Promise<void> {
    const maybeError = this.upsertFailurePredicate?.(session) ?? null;
    if (maybeError) {
      throw maybeError;
    }

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
    if (this.pruneFailureCalls.has(this.pruneCallCount)) {
      throw this.pruneFailureError;
    }
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
      ...(content.metadata ? { metadata: structuredClone(content.metadata) } : {}),
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
      generateSessionTitle: async () => '',
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

  it('persists assistant response stats in send payload and subsequent loads', async () => {
    repository.sessions.set('chat-stats', createSession('chat-stats'));

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'answer with metrics' }],
          metadata: {
            responseStats: {
              requestDurationMs: 1200,
              timeToFirstTokenMs: 180,
              outputTokens: 90,
              totalTokens: 200,
              outputTokensPerSecond: 85.71,
              totalTokensPerSecond: 166.67,
              hasStreamingToken: true,
            },
          },
        };
        session.contents.push(assistantContent);
        session.lastInteractionId = 'interaction-stats';
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const sendPayload = await handler({
      type: 'chat/send',
      chatId: 'chat-stats',
      text: 'show me stats',
      model: 'gemini-3-flash-preview',
    });

    expect(sendPayload).toMatchObject({
      chatId: 'chat-stats',
      assistantMessage: {
        role: 'assistant',
        content: 'answer with metrics',
        stats: {
          requestDurationMs: 1200,
          timeToFirstTokenMs: 180,
          outputTokens: 90,
          totalTokens: 200,
          outputTokensPerSecond: 85.71,
          totalTokensPerSecond: 166.67,
          hasStreamingToken: true,
        },
      },
    });

    const loadPayload = await handler({ type: 'chat/load', chatId: 'chat-stats' });
    expect(loadPayload.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'answer with metrics',
      stats: {
        requestDurationMs: 1200,
        timeToFirstTokenMs: 180,
        outputTokens: 90,
        totalTokens: 200,
        outputTokensPerSecond: 85.71,
        totalTokensPerSecond: 166.67,
        hasStreamingToken: true,
      },
    });
  });

  it('does not block requests when bootstrap initialization fails', async () => {
    const originalError = console.error;
    console.error = () => {};

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {
          throw new Error('bootstrap failed');
        },
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async () => {
          throw new Error('not used');
        },
        openOptionsPage: async () => {},
        now: () => new Date('2025-01-01T00:00:00.000Z'),
        generateSessionTitle: async () => '',
      });

      await expect(handler({ type: 'chat/load' })).resolves.toEqual({ chatId: null, messages: [] });
    } finally {
      console.error = originalError;
    }
  });

  it('treats prune failures after startup as best-effort', async () => {
    repository.pruneFailureCalls.add(2);
    repository.pruneFailureCalls.add(3);
    repository.pruneFailureCalls.add(4);
    repository.sessions.set('chat-prune', createSession('chat-prune'));

    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async (session) => {
          const assistantContent: GeminiContent = {
            role: 'model',
            parts: [{ text: 'assistant reply after prune failure' }],
          };
          session.contents.push(assistantContent);
          session.lastInteractionId = 'interaction-prune';
          return assistantContent;
        },
        openOptionsPage: async () => {},
        now: () => new Date('2025-01-01T00:00:00.000Z'),
        generateSessionTitle: async () => '',
      });

      const newPayload = await handler({ type: 'chat/new' });
      expect((newPayload as { chatId: string }).chatId).toBeString();

      const sendPayload = await handler({
        type: 'chat/send',
        chatId: 'chat-prune',
        text: 'message',
        model: 'gemini-3-flash-preview',
      });
      expect(sendPayload).toMatchObject({
        chatId: 'chat-prune',
        assistantMessage: {
          role: 'assistant',
          content: 'assistant reply after prune failure',
        },
      });

      const deletePayload = await handler({ type: 'chat/delete', chatId: 'chat-prune' });
      expect(deletePayload).toEqual({ deleted: true, chatId: null });
    } finally {
      console.warn = originalWarn;
    }
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
      generateSessionTitle: async () => '',
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
      generateSessionTitle: async () => '',
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
      generateSessionTitle: async () => '',
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

  it('resets continuation token when streamed Gemini errors report invalid previous interaction id', async () => {
    const chained = createSession('chat-stream-expired');
    chained.lastInteractionId = 'interaction-old';
    repository.sessions.set(chained.id, chained);

    const originalFetch = globalThis.fetch;
    let capturedRequestBody: Record<string, unknown> | undefined;
    const streamBody = [
      `data: ${JSON.stringify({
        event_type: 'error',
        error: {
          message: 'Invalid previous_interaction_id: interaction not found.',
        },
      })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    (globalThis as { fetch: typeof fetch }).fetch = (async (_input, init) => {
      capturedRequestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      return new Response(streamBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn,
        openOptionsPage: async () => {},
        now: () => new Date('2025-01-01T00:00:00.000Z'),
        generateSessionTitle: async () => '',
      });

      await expect(
        handler(
          {
            type: 'chat/send',
            chatId: chained.id,
            text: 'retry',
            model: 'gemini-3-flash-preview',
            streamRequestId: 'stream-1',
          },
          {
            sender: {
              tab: { id: 321 } as chrome.tabs.Tab,
              frameId: 7,
            },
          },
        ),
      ).rejects.toThrow(/resend your last message/i);

      expect(capturedRequestBody).toMatchObject({
        stream: true,
        previous_interaction_id: 'interaction-old',
      });
      const resetSession = repository.sessions.get(chained.id);
      expect(resetSession?.lastInteractionId).toBeUndefined();
      expect(resetSession?.contents).toHaveLength(1);
      expect(repository.upsertCalls).toHaveLength(1);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it('surfaces reset persistence failures separately from expired interaction errors', async () => {
    const chained = createSession('chat-reset-failure');
    chained.lastInteractionId = 'interaction-old';
    repository.sessions.set(chained.id, chained);
    repository.upsertFailurePredicate = (session) =>
      session.id === chained.id && !session.lastInteractionId
        ? new Error('failed to persist reset session')
        : null;

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
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/send',
        chatId: chained.id,
        text: 'retry',
        model: 'gemini-3-flash-preview',
      }),
    ).rejects.toThrow(/failed to reset expired conversation context/i);

    expect(repository.sessions.get(chained.id)?.lastInteractionId).toBe('interaction-old');
  });

  it('creates a chat session on send when no chat id is provided', async () => {
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'assistant reply for auto-created session' }],
        };
        session.contents.push(assistantContent);
        session.lastInteractionId = 'interaction-auto-create';
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const sendPayload = await handler({
      type: 'chat/send',
      text: 'start new conversation',
      model: 'gemini-3-flash-preview',
    });

    const chatId = (sendPayload as { chatId: string }).chatId;
    expect(chatId).toBeString();
    expect(repository.sessions.has(chatId)).toBe(true);
    expect(sendPayload).toMatchObject({
      assistantMessage: {
        role: 'assistant',
        content: 'assistant reply for auto-created session',
      },
    });
  });

  it('generates and persists title for first textual sends without blocking send response', async () => {
    let resolveTitleGeneration: (() => void) | null = null;
    let titleCalls = 0;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'assistant reply for titled chat' }],
        };
        session.contents.push(assistantContent);
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async (_apiKey, firstPrompt) => {
        titleCalls += 1;
        expect(firstPrompt).toBe('start titled conversation');
        await new Promise<void>((resolve) => {
          resolveTitleGeneration = resolve;
        });
        return 'Titled conversation';
      },
    });

    const sendPayload = await handler({
      type: 'chat/send',
      text: 'start titled conversation',
      model: 'gemini-3-flash-preview',
    });

    const chatId = (sendPayload as { chatId: string }).chatId;
    expect(sendPayload).toMatchObject({
      assistantMessage: {
        role: 'assistant',
        content: 'assistant reply for titled chat',
      },
    });
    expect(titleCalls).toBe(1);
    expect(repository.sessions.get(chatId)?.title).toBeUndefined();

    if (!resolveTitleGeneration) {
      throw new Error('expected title generation to be scheduled');
    }
    resolveTitleGeneration();
    await Promise.resolve();

    const payload = await handler({ type: 'chat/list' });
    expect(payload).toEqual({
      sessions: [
        {
          chatId,
          title: 'Titled conversation',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(repository.sessions.get(chatId)?.title).toBe('Titled conversation');
  });

  it('does not generate titles for attachment-only first sends', async () => {
    let titleCalls = 0;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'attachment accepted' }],
        };
        session.contents.push(assistantContent);
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => {
        titleCalls += 1;
        return 'Should not be used';
      },
    });

    await handler({
      type: 'chat/send',
      text: '   ',
      model: 'gemini-3-flash-preview',
      attachments: [
        {
          name: 'img',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/image.png',
        },
      ],
    });

    expect(titleCalls).toBe(0);
  });

  it('does not generate a title for non-first sends on existing chats', async () => {
    repository.sessions.set('chat-existing', createSession('chat-existing'));
    let titleCalls = 0;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'follow-up reply' }],
        };
        session.contents.push(assistantContent);
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => {
        titleCalls += 1;
        return 'Should not be used';
      },
    });

    const payload = await handler({
      type: 'chat/send',
      chatId: 'chat-existing',
      text: 'follow up',
      model: 'gemini-3-flash-preview',
    });

    expect(payload).toMatchObject({
      chatId: 'chat-existing',
      assistantMessage: { content: 'follow-up reply' },
    });
    expect(titleCalls).toBe(0);
  });

  it('keeps send successful when title generation fails', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async (session) => {
          const assistantContent: GeminiContent = {
            role: 'model',
            parts: [{ text: 'assistant reply for failed title generation' }],
          };
          session.contents.push(assistantContent);
          return assistantContent;
        },
        openOptionsPage: async () => {},
        now: () => new Date('2025-01-01T00:00:00.000Z'),
        generateSessionTitle: async () => {
          throw new Error('title generation failed');
        },
      });

      const sendPayload = await handler({
        type: 'chat/send',
        text: 'start new conversation',
        model: 'gemini-3-flash-preview',
      });

      const chatId = (sendPayload as { chatId: string }).chatId;
      expect(sendPayload).toMatchObject({
        assistantMessage: {
          role: 'assistant',
          content: 'assistant reply for failed title generation',
        },
      });
      await handler({ type: 'chat/list' });
      expect(repository.sessions.get(chatId)?.title).toBeUndefined();
    } finally {
      console.warn = originalWarn;
    }
  });

  it('prefers persisted session title in chat list summaries', async () => {
    repository.sessions.set('chat-with-custom-title', {
      id: 'chat-with-custom-title',
      title: 'Team Weekly Planning',
      createdAt: '2025-01-01T03:00:00.000Z',
      updatedAt: '2025-01-01T03:04:05.000Z',
      contents: [
        {
          role: 'user',
          parts: [{ text: 'old fallback text that should not appear in list' }],
        },
      ],
    });

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const payload = await handler({ type: 'chat/list' });
    expect(payload).toEqual({
      sessions: [
        {
          chatId: 'chat-with-custom-title',
          title: 'Team Weekly Planning',
          updatedAt: '2025-01-01T03:04:05.000Z',
        },
      ],
    });
  });

  it('uses timestamp fallback titles for sessions without text parts', async () => {
    repository.sessions.set('chat-without-text', {
      id: 'chat-without-text',
      createdAt: '2025-01-01T03:00:00.000Z',
      updatedAt: '2025-01-01T03:04:05.000Z',
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: 'https://example.invalid/files/note.txt',
                mimeType: 'text/plain',
              },
            },
          ],
        },
      ],
    });

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const payload = await handler({ type: 'chat/list' });
    expect(payload).toEqual({
      sessions: [
        {
          chatId: 'chat-without-text',
          title: 'Chat 2025-01-01 03:04',
          updatedAt: '2025-01-01T03:04:05.000Z',
        },
      ],
    });
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
      generateSessionTitle: async () => '',
    });

    const payload = await handler({ type: 'app/open-options' } as RuntimeRequest);
    expect(payload).toEqual({ opened: true });
    expect(opened).toBe(true);
  });

  it('rejects empty sends before hitting Gemini', async () => {
    let calledGemini = false;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        calledGemini = true;
        throw new Error('not used');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/send',
        text: '   ',
        model: 'gemini-3-flash-preview',
      }),
    ).rejects.toThrow(/empty message/i);

    expect(calledGemini).toBe(false);
  });

  it('rejects sends when Gemini API key is missing from settings', async () => {
    const settings = createSettings();
    settings.apiKey = '';
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => settings,
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/send',
        text: 'hello',
        model: 'gemini-3-flash-preview',
      }),
    ).rejects.toThrow(/api key is missing/i);
  });

  it('supports attachment-only sends and filters invalid attachment entries', async () => {
    let capturedSession: ChatSession | null = null;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        capturedSession = cloneSession(session);
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'attachment accepted' }],
        };
        session.contents.push(assistantContent);
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const payload = await handler({
      type: 'chat/send',
      text: '  ',
      model: 'gemini-3-flash-preview',
      attachments: [
        {
          name: 'img',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/image.png',
          fileName: 'gemini-file-1',
        },
        {
          name: '',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/skip.png',
        },
      ],
    });

    expect(payload).toMatchObject({
      assistantMessage: { content: 'attachment accepted' },
    });
    expect(capturedSession?.contents.at(-1)).toEqual({
      role: 'user',
      parts: [
        {
          fileData: {
            fileUri: 'https://example.invalid/files/image.png',
            mimeType: 'image/png',
          },
        },
      ],
    });
  });

  it('forwards streaming deltas to the originating tab frame when stream request id is provided', async () => {
    repository.sessions.set('chat-stream', createSession('chat-stream'));
    const sentEvents: Array<{
      tabId: number;
      payload: unknown;
      options?: chrome.tabs.MessageSendOptions;
    }> = [];
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
      },
      tabs: {
        sendMessage: (
          tabId: number,
          payload: unknown,
          optionsOrCallback?: chrome.tabs.MessageSendOptions | ((response?: unknown) => void),
          callback?: (response?: unknown) => void,
        ) => {
          const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
          sentEvents.push({ tabId, payload, ...(options ? { options } : {}) });
          if (typeof optionsOrCallback === 'function') {
            optionsOrCallback();
          } else {
            callback?.();
          }
        },
      },
    };

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async (session, _settings, _thinkingLevel, onStreamDelta) => {
          onStreamDelta?.({ textDelta: 'Draft' });
          onStreamDelta?.({ thinkingDelta: 'Reasoning' });
          const assistantContent: GeminiContent = {
            role: 'model',
            parts: [{ text: 'Final answer' }],
          };
          session.contents.push(assistantContent);
          return assistantContent;
        },
        openOptionsPage: async () => {},
        now: () => new Date('2025-01-01T00:00:00.000Z'),
        generateSessionTitle: async () => '',
      });

      const payload = await handler(
        {
          type: 'chat/send',
          chatId: 'chat-stream',
          text: 'stream this',
          model: 'gemini-3-flash-preview',
          streamRequestId: 'stream-1',
        },
        {
          sender: {
            tab: { id: 321 } as chrome.tabs.Tab,
            frameId: 7,
          },
        },
      );

      expect(payload).toMatchObject({
        assistantMessage: {
          content: 'Final answer',
        },
      });
      expect(sentEvents).toEqual([
        {
          tabId: 321,
          payload: {
            type: 'chat/stream-delta',
            requestId: 'stream-1',
            textDelta: 'Draft',
          },
          options: { frameId: 7 },
        },
        {
          tabId: 321,
          payload: {
            type: 'chat/stream-delta',
            requestId: 'stream-1',
            thinkingDelta: 'Reasoning',
          },
          options: { frameId: 7 },
        },
      ]);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('does not forward streaming deltas when sender tab context is unavailable', async () => {
    repository.sessions.set(
      'chat-stream-missing-sender',
      createSession('chat-stream-missing-sender'),
    );
    let sendMessageCalls = 0;
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
      },
      tabs: {
        sendMessage: () => {
          sendMessageCalls += 1;
        },
      },
    };

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async (session, _settings, _thinkingLevel, onStreamDelta) => {
          onStreamDelta?.({ textDelta: 'Draft' });
          const assistantContent: GeminiContent = {
            role: 'model',
            parts: [{ text: 'Done' }],
          };
          session.contents.push(assistantContent);
          return assistantContent;
        },
        openOptionsPage: async () => {},
        now: () => new Date('2025-01-01T00:00:00.000Z'),
        generateSessionTitle: async () => '',
      });

      await handler({
        type: 'chat/send',
        chatId: 'chat-stream-missing-sender',
        text: 'stream this',
        model: 'gemini-3-flash-preview',
        streamRequestId: 'stream-2',
      });

      expect(sendMessageCalls).toBe(0);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('surfaces options-page failures to callers', async () => {
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      openOptionsPage: async () => {
        throw new Error('options unavailable');
      },
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(handler({ type: 'app/open-options' })).rejects.toThrow(/options unavailable/i);
  });
});
