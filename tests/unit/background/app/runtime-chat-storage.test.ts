import { beforeEach, describe, expect, it } from 'bun:test';
import { createRuntimeRequestHandler } from '../../../../src/background/app/runtime';
import type { ChatRepository } from '../../../../src/background/features/chat-storage/chat-repository';
import {
  InvalidPreviousInteractionIdError,
  completeAssistantTurn,
} from '../../../../src/background/features/gemini/gemini';
import type { ChatSession, GeminiContent } from '../../../../src/background/features/session/types';
import type {
  ChatLoadPayload,
  ChatNewPayload,
  ChatSendPayload,
  RuntimeRequest,
} from '../../../../src/shared/runtime';
import type { GeminiSettings } from '../../../../src/shared/settings';
import { defaultGeminiSettings } from '../../../../src/shared/settings';

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
  const clonedBranchTree = session.branchTree
    ? {
        rootNodeId: session.branchTree.rootNodeId,
        activeLeafNodeId: session.branchTree.activeLeafNodeId,
        nodes: Object.fromEntries(
          Object.entries(session.branchTree.nodes).map(([nodeId, node]) => [
            nodeId,
            {
              id: node.id,
              ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
              childNodeIds: [...node.childNodeIds],
              ...(node.content
                ? {
                    content: {
                      ...(node.content.id ? { id: node.content.id } : {}),
                      role: node.content.role,
                      parts: node.content.parts.map((part) => ({ ...part })),
                      ...(node.content.metadata
                        ? { metadata: structuredClone(node.content.metadata) }
                        : {}),
                    },
                  }
                : {}),
            },
          ]),
        ),
      }
    : undefined;

  return {
    ...session,
    contents: session.contents.map((content) => ({
      ...(content.id ? { id: content.id } : {}),
      role: content.role,
      parts: content.parts.map((part) => ({ ...part })),
      ...(content.metadata ? { metadata: structuredClone(content.metadata) } : {}),
    })),
    ...(clonedBranchTree ? { branchTree: clonedBranchTree } : {}),
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

function createMultiTurnSession(id: string): ChatSession {
  return {
    id,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    contents: [
      {
        id: 'u1',
        role: 'user',
        parts: [{ text: 'first prompt' }],
      },
      {
        id: 'm1',
        role: 'model',
        parts: [{ text: 'first answer' }],
        metadata: {
          interactionId: 'interaction-1',
          sourceModel: 'gemini-3-flash-preview',
        },
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ text: 'second prompt' }],
      },
      {
        id: 'm2',
        role: 'model',
        parts: [{ text: 'second answer' }],
        metadata: {
          interactionId: 'interaction-2',
          sourceModel: 'gemini-3.1-pro-preview',
        },
      },
    ],
    lastInteractionId: 'interaction-2',
  };
}

function findBranchNodeByInteractionId(
  session: ChatSession,
  interactionId: string,
): { id: string; parentNodeId?: string } | null {
  const nodes = session.branchTree?.nodes;
  if (!nodes) {
    return null;
  }

  for (const node of Object.values(nodes)) {
    if (node.content?.role !== 'model') {
      continue;
    }
    if (node.content.metadata?.interactionId === interactionId) {
      return { id: node.id, ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}) };
    }
  }

  return null;
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

    const newPayload = (await handler({ type: 'chat/new' })) as ChatNewPayload;
    const chatId = newPayload.chatId;
    expect(chatId.length).toBeGreaterThan(0);
    expect(repository.upsertCalls.at(0)?.id).toBe(chatId);
    expect(repository.sessions.has(chatId)).toBe(true);
    const loadPayload = (await handler({ type: 'chat/load', chatId })) as ChatLoadPayload;
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
              turnTokensPerSecond: 120.5,
              outputTokensPerSecond: 85.71,
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
          turnTokensPerSecond: 120.5,
          outputTokensPerSecond: 85.71,
          hasStreamingToken: true,
        },
      },
    });

    const loadPayload = (await handler({
      type: 'chat/load',
      chatId: 'chat-stats',
    })) as ChatLoadPayload;
    expect(loadPayload.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'answer with metrics',
      stats: {
        requestDurationMs: 1200,
        timeToFirstTokenMs: 180,
        outputTokens: 90,
        totalTokens: 200,
        turnTokensPerSecond: 120.5,
        outputTokensPerSecond: 85.71,
        hasStreamingToken: true,
      },
    });
  });

  it('rejects chat requests when bootstrap initialization fails', async () => {
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

      await expect(handler({ type: 'chat/load' })).rejects.toThrow(/storage is unavailable/i);
      await expect(handler({ type: 'chat/new' })).rejects.toThrow(/storage is unavailable/i);
    } finally {
      console.error = originalError;
    }
  });

  it('rejects chat requests while bootstrap is still in progress', async () => {
    const bootstrapGate = new Promise<void>(() => {});
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: () => bootstrapGate,
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(handler({ type: 'chat/load' })).rejects.toThrow(/still initializing/i);
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
    const loadPayload = (await loadPromise) as ChatLoadPayload;

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

  it('expands slash commands for Gemini while keeping the slash text in stored chat history', async () => {
    let observedUserContent: GeminiContent | undefined;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => {
        const settings = createSettings();
        settings.slashCommands = [
          {
            name: 'summarize',
            prompt: 'Summarize this carefully:\n\n$ARGUMENTS',
          },
        ];
        return settings;
      },
      completeAssistantTurn: async (session) => {
        observedUserContent = session.contents.at(-1);
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'Done' }],
        };
        session.contents.push(assistantContent);
        session.lastInteractionId = 'interaction-slash';
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const sendPayload = (await handler({
      type: 'chat/send',
      text: '/summarize release notes',
      model: 'gemini-3-flash-preview',
    })) as ChatSendPayload;

    expect(observedUserContent).toMatchObject({
      role: 'user',
      parts: [{ text: 'Summarize this carefully:\n\nrelease notes' }],
      metadata: {
        userDisplayText: '/summarize release notes',
      },
    });

    const loadPayload = (await handler({
      type: 'chat/load',
      chatId: sendPayload.chatId,
    })) as ChatLoadPayload;
    expect(loadPayload.messages[0]).toMatchObject({
      role: 'user',
      content: '/summarize release notes',
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

  it('generates titles for attachment-only first sends', async () => {
    let titleCalls = 0;
    let resolveTitleGeneration: (() => void) | undefined;
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
      generateSessionTitle: async (_apiKey, _firstQuery, attachments) => {
        titleCalls += 1;
        expect(attachments).toHaveLength(1);
        expect(attachments?.[0]).toMatchObject({
          name: 'img',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/image.png',
        });
        await new Promise<void>((resolve) => {
          resolveTitleGeneration = resolve;
        });
        return 'Image upload chat';
      },
    });

    const sendPayload = await handler({
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

    const chatId = (sendPayload as { chatId: string }).chatId;
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
          title: 'Image upload chat',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(repository.sessions.get(chatId)?.title).toBe('Image upload chat');
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

  it('logs a warning when generated title persistence fails', async () => {
    repository.upsertFailurePredicate = (session) =>
      session.title === 'Persisted title' ? new Error('upsert failed') : null;
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async (session) => {
          const assistantContent: GeminiContent = {
            role: 'model',
            parts: [{ text: 'assistant reply for title persistence error' }],
          };
          session.contents.push(assistantContent);
          return assistantContent;
        },
        openOptionsPage: async () => {},
        now: () => new Date('2025-01-01T00:00:00.000Z'),
        generateSessionTitle: async () => 'Persisted title',
      });

      await handler({
        type: 'chat/send',
        text: 'generate title',
        model: 'gemini-3-flash-preview',
      });
      await handler({ type: 'chat/list' });

      expect(
        warnCalls.some((call) =>
          String(call[0]).includes('Failed to persist generated chat session title.'),
        ),
      ).toBe(true);
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
          previewDataUrl: 'data:image/png;base64,aGVsbG8=',
        },
        {
          name: 'notes.md',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/notes.md',
          previewText: '  # Notes\n\n- one\n- two  ',
        },
        {
          name: '',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/skip.png',
        },
        {
          name: 'bad-preview',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/bad-preview.png',
          previewDataUrl: 'data:text/plain;base64,aGVsbG8=',
        },
        {
          name: 'empty-preview',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/empty-preview.md',
          previewText: '   ',
        },
      ],
    });

    expect(payload).toMatchObject({
      assistantMessage: { content: 'attachment accepted' },
    });
    expect(capturedSession?.contents.at(-1)).toMatchObject({
      role: 'user',
      parts: [
        {
          fileData: {
            fileUri: 'https://example.invalid/files/image.png',
            mimeType: 'image/png',
            displayName: 'img',
          },
        },
        {
          fileData: {
            fileUri: 'https://example.invalid/files/notes.md',
            mimeType: 'text/plain',
            displayName: 'notes.md',
          },
        },
        {
          fileData: {
            fileUri: 'https://example.invalid/files/bad-preview.png',
            mimeType: 'image/png',
            displayName: 'bad-preview',
          },
        },
        {
          fileData: {
            fileUri: 'https://example.invalid/files/empty-preview.md',
            mimeType: 'text/plain',
            displayName: 'empty-preview',
          },
        },
      ],
      metadata: {
        attachmentPreviewByFileUri: {
          'https://example.invalid/files/image.png': 'data:image/png;base64,aGVsbG8=',
        },
        attachmentPreviewTextByFileUri: {
          'https://example.invalid/files/notes.md': '# Notes\n\n- one\n- two',
        },
      },
    });
    expect(typeof capturedSession?.contents.at(-1)?.id).toBe('string');
  });

  it('preserves uploaded attachment names across persistence instead of inferring from file URI ids', async () => {
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          role: 'model',
          parts: [{ text: 'received' }],
        };
        session.contents.push(assistantContent);
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const sendPayload = (await handler({
      type: 'chat/send',
      text: '',
      model: 'gemini-3-flash-preview',
      attachments: [
        {
          name: 'invoice.pdf',
          mimeType: 'application/pdf',
          fileUri: 'https://example.invalid/files/gemini-generated-id-123',
          fileName: 'gemini-generated-id-123',
        },
      ],
    })) as ChatSendPayload;

    const loadPayload = (await handler({
      type: 'chat/load',
      chatId: sendPayload.chatId,
    })) as ChatLoadPayload;

    const userMessage = loadPayload.messages.find((message) => message.role === 'user');
    expect(userMessage).toBeDefined();
    expect(userMessage?.attachments).toEqual([
      {
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        fileUri: 'https://example.invalid/files/gemini-generated-id-123',
      },
    ]);
  });

  it('drops oversized preview metadata while still sending attachment fileData', async () => {
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

    await handler({
      type: 'chat/send',
      text: '',
      model: 'gemini-3-flash-preview',
      attachments: [
        {
          name: 'img',
          mimeType: 'image/png',
          fileUri: 'https://example.invalid/files/image.png',
          previewDataUrl: `data:image/png;base64,${'A'.repeat(500_000)}`,
        },
      ],
    });

    expect(capturedSession?.contents.at(-1)).toMatchObject({
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
    expect(capturedSession?.contents.at(-1)?.metadata).toBeUndefined();
  });

  it('uploads files through background upload dependency', async () => {
    const uploadedCalls: Array<{
      apiKey: string;
      timeout: number | undefined;
      fileCount: number;
      bytes: number[];
    }> = [];
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      uploadFilesToGemini: async (files, apiKey, uploadTimeoutMs) => {
        uploadedCalls.push({
          apiKey,
          timeout: uploadTimeoutMs,
          fileCount: files.length,
          bytes: files[0] ? Array.from(new Uint8Array(files[0].bytes)) : [],
        });
        return {
          attachments: [
            {
              name: files[0]?.name ?? 'attachment',
              mimeType: files[0]?.mimeType ?? 'application/octet-stream',
              fileUri: 'https://example.invalid/files/uploaded',
            },
          ],
          failures: [],
        };
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const payload = await handler({
      type: 'chat/upload-files',
      uploadTimeoutMs: 77,
      files: [
        {
          name: ' note.txt ',
          mimeType: ' text/plain ',
          bytesBase64: 'AQID',
        },
      ],
    } as RuntimeRequest);

    expect(payload).toEqual({
      attachments: [
        {
          name: 'note.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/uploaded',
        },
      ],
      failures: [],
    });
    expect(uploadedCalls).toEqual([
      { apiKey: 'test-api-key', timeout: 77, fileCount: 1, bytes: [1, 2, 3] },
    ]);
  });

  it('accepts legacy typed-array byte payloads for chat upload requests', async () => {
    const uploadedCalls: Array<{ apiKey: string; timeout: number | undefined; fileCount: number }> =
      [];
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      uploadFilesToGemini: async (files, apiKey, uploadTimeoutMs) => {
        uploadedCalls.push({
          apiKey,
          timeout: uploadTimeoutMs,
          fileCount: files.length,
        });
        return {
          attachments: [
            {
              name: files[0]?.name ?? 'attachment',
              mimeType: files[0]?.mimeType ?? 'application/octet-stream',
              fileUri: 'https://example.invalid/files/uploaded',
            },
          ],
          failures: [],
        };
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const payload = await handler({
      type: 'chat/upload-files',
      uploadTimeoutMs: 77,
      files: [
        {
          name: ' note.txt ',
          mimeType: ' text/plain ',
          bytes: new Uint8Array([1, 2, 3]) as unknown as ArrayBuffer,
        },
      ],
    } as unknown as RuntimeRequest);

    expect(payload).toEqual({
      attachments: [
        {
          name: 'note.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/uploaded',
        },
      ],
      failures: [],
    });
    expect(uploadedCalls).toEqual([{ apiKey: 'test-api-key', timeout: 77, fileCount: 1 }]);
  });

  it('reports malformed upload byte payloads instead of silently dropping them', async () => {
    let uploadCalls = 0;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      uploadFilesToGemini: async () => {
        uploadCalls += 1;
        return {
          attachments: [],
          failures: [],
        };
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const payload = await handler({
      type: 'chat/upload-files',
      files: [
        {
          name: 'note.txt',
          mimeType: 'text/plain',
          bytesBase64: '$$$not-base64$$$',
        },
      ],
    } as RuntimeRequest);

    expect(payload).toEqual({
      attachments: [],
      failures: [
        {
          index: 0,
          fileName: 'note.txt',
          message: 'Failed to upload "note.txt": file bytes were malformed.',
        },
      ],
    });
    expect(uploadCalls).toBe(0);
  });

  it('rejects file upload requests when Gemini API key is missing', async () => {
    const missingKeySettings = createSettings();
    missingKeySettings.apiKey = '';
    let uploadCalls = 0;
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => missingKeySettings,
      completeAssistantTurn: async () => {
        throw new Error('not used');
      },
      uploadFilesToGemini: async () => {
        uploadCalls += 1;
        return {
          attachments: [],
          failures: [],
        };
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/upload-files',
        files: [
          {
            name: 'note.txt',
            mimeType: 'text/plain',
            bytesBase64: 'AQ==',
          },
        ],
      } as RuntimeRequest),
    ).rejects.toThrow(/api key is missing/i);
    expect(uploadCalls).toBe(0);
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

  it('logs stream forwarding failures without failing the chat send request', async () => {
    repository.sessions.set('chat-stream-send-error', createSession('chat-stream-send-error'));
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
      },
      tabs: {
        sendMessage: () => {
          throw new Error('tab disconnected');
        },
      },
    };

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async (session, _settings, _thinkingLevel, onStreamDelta) => {
          onStreamDelta?.({ textDelta: 'chunk' });
          const assistantContent: GeminiContent = {
            role: 'model',
            parts: [{ text: 'stream completed' }],
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
          chatId: 'chat-stream-send-error',
          text: 'stream please',
          model: 'gemini-3-flash-preview',
          streamRequestId: 'stream-send-error',
        },
        {
          sender: {
            tab: { id: 12 } as chrome.tabs.Tab,
          },
        },
      );

      expect(payload).toMatchObject({
        assistantMessage: {
          content: 'stream completed',
        },
      });
      expect(
        warnCalls.some((call) =>
          String(call[0]).includes('Failed to forward stream delta to the chat panel tab.'),
        ),
      ).toBe(true);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
      console.warn = originalWarn;
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

  it('rejects fork when chat id or target interaction id is blank', async () => {
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

    await expect(
      handler({
        type: 'chat/fork',
        chatId: '   ',
        previousInteractionId: 'interaction-1',
      } as RuntimeRequest),
    ).rejects.toThrow(/requires both a chat id and a target interaction id/i);

    await expect(
      handler({
        type: 'chat/fork',
        chatId: 'chat-base',
        previousInteractionId: '   ',
      } as RuntimeRequest),
    ).rejects.toThrow(/requires both a chat id and a target interaction id/i);
  });

  it('rejects fork when the source chat does not exist', async () => {
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

    await expect(
      handler({
        type: 'chat/fork',
        chatId: 'missing-chat',
        previousInteractionId: 'interaction-1',
      } as RuntimeRequest),
    ).rejects.toThrow(/chat that does not exist/i);
  });

  it('forwards stream deltas without frame options when only sender tab is available', async () => {
    repository.sessions.set('chat-stream-tab-only', createSession('chat-stream-tab-only'));
    const sentEvents: Array<{ tabId: number; payload: unknown }> = [];
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
      },
      tabs: {
        sendMessage: (tabId: number, payload: unknown, callback?: (response?: unknown) => void) => {
          sentEvents.push({ tabId, payload });
          callback?.();
        },
      },
    };

    try {
      const handler = createRuntimeRequestHandler({
        repository,
        bootstrapChatStorage: async () => {},
        readGeminiSettings: async () => createSettings(),
        completeAssistantTurn: async (session, _settings, _thinkingLevel, onStreamDelta) => {
          onStreamDelta?.({});
          onStreamDelta?.({ textDelta: 'tab-only-stream' });
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

      await handler(
        {
          type: 'chat/send',
          chatId: 'chat-stream-tab-only',
          text: 'stream this',
          model: 'gemini-3-flash-preview',
          streamRequestId: 'stream-tab-only',
        },
        {
          sender: {
            tab: { id: 123 } as chrome.tabs.Tab,
          },
        },
      );

      expect(sentEvents).toEqual([
        {
          tabId: 123,
          payload: {
            type: 'chat/stream-delta',
            requestId: 'stream-tab-only',
            textDelta: 'tab-only-stream',
          },
        },
      ]);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it('forks a chat from a selected user prompt within the same chat session', async () => {
    repository.sessions.set('chat-base', createMultiTurnSession('chat-base'));

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

    const payload = await handler({
      type: 'chat/fork',
      chatId: 'chat-base',
      previousInteractionId: 'interaction-1',
    } as RuntimeRequest);

    const branchedChatId = (payload as { chatId: string }).chatId;
    expect(branchedChatId).toBeString();
    expect(branchedChatId).toBe('chat-base');

    const branch = repository.sessions.get(branchedChatId);
    expect(branch).toBeDefined();
    expect(branch?.lastInteractionId).toBe('interaction-1');
    expect(branch?.contents.map((content) => content.id)).toEqual(['u1', 'm1']);
    if (!branch) {
      throw new Error('Expected branched session to exist.');
    }
    expect(branch.branchTree?.activeLeafNodeId).toBe(
      findBranchNodeByInteractionId(branch, 'interaction-1')?.id,
    );
  });

  it('rejects fork when the target interaction id is not found', async () => {
    repository.sessions.set('chat-base', createMultiTurnSession('chat-base'));

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

    await expect(
      handler({
        type: 'chat/fork',
        chatId: 'chat-base',
        previousInteractionId: 'nonexistent-interaction',
      } as RuntimeRequest),
    ).rejects.toThrow(/target assistant message was not found/i);
  });

  it('returns branch switch metadata after sending on a forked prompt branch', async () => {
    repository.sessions.set('chat-base', createMultiTurnSession('chat-base'));

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async (session) => {
        const assistantContent: GeminiContent = {
          id: 'm-fork',
          role: 'model',
          parts: [{ text: 'forked follow-up answer' }],
          metadata: {
            interactionId: 'interaction-fork',
            sourceModel: 'gemini-3-flash-preview',
          },
        };
        session.contents.push(assistantContent);
        session.lastInteractionId = 'interaction-fork';
        return assistantContent;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await handler({
      type: 'chat/fork',
      chatId: 'chat-base',
      previousInteractionId: 'interaction-1',
    } as RuntimeRequest);

    await handler({
      type: 'chat/send',
      chatId: 'chat-base',
      text: 'edited second prompt',
      model: 'gemini-3-flash-preview',
    } as RuntimeRequest);

    const loadPayload = await handler({ type: 'chat/load', chatId: 'chat-base' } as RuntimeRequest);
    const messages = (loadPayload as { chatId: string; messages: unknown[] }).messages;
    const forkedPrompt = messages.find(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        (message as { role?: string }).role === 'user' &&
        (message as { content?: string }).content === 'edited second prompt',
    );
    const finalAssistant = messages.at(-1);
    expect(forkedPrompt).toMatchObject({
      role: 'user',
      branchOptionCount: 2,
      branchOptionIndex: 2,
      branchOptionInteractionIds: ['interaction-2', 'interaction-fork'],
    });
    expect(finalAssistant).toMatchObject({
      role: 'assistant',
      interactionId: 'interaction-fork',
    });
    expect((finalAssistant as { branchOptionCount?: number })?.branchOptionCount).toBeUndefined();
  });

  it('regenerates as a sibling assistant branch in the same chat with model override', async () => {
    repository.sessions.set('chat-base', createMultiTurnSession('chat-base'));
    const settings = createSettings();
    let capturedModel: string | null = null;
    let capturedSessionSnapshot: ChatSession | null = null;

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => settings,
      completeAssistantTurn: async (session, inputSettings) => {
        capturedModel = inputSettings.model;
        capturedSessionSnapshot = cloneSession(session);
        const regenerated: GeminiContent = {
          id: 'm-regen',
          role: 'model',
          parts: [{ text: 'regenerated answer' }],
          metadata: {
            interactionId: 'interaction-regen',
            sourceModel: inputSettings.model,
          },
        };
        session.contents.push(regenerated);
        session.lastInteractionId = 'interaction-regen';
        return regenerated;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    const payload = await handler({
      type: 'chat/regen',
      chatId: 'chat-base',
      previousInteractionId: 'interaction-2',
      model: 'gemini-3.1-pro-preview',
      thinkingLevel: 'high',
    } as RuntimeRequest);

    const branchedChatId = (payload as { chatId: string }).chatId;
    expect(branchedChatId).toBeString();
    expect(branchedChatId).toBe('chat-base');
    expect(payload).toMatchObject({
      assistantMessage: {
        role: 'assistant',
        content: 'regenerated answer',
      },
    });
    expect(capturedModel).toBe('gemini-3.1-pro-preview');
    expect(capturedSessionSnapshot?.contents.map((content) => content.id)).toEqual([
      'u1',
      'm1',
      'u2',
    ]);
    expect(capturedSessionSnapshot?.contents.at(-1)?.role).toBe('user');
    expect(capturedSessionSnapshot?.lastInteractionId).toBe('interaction-1');

    const branch = repository.sessions.get(branchedChatId);
    expect(branch).toBeDefined();
    expect(branch?.lastInteractionId).toBe('interaction-regen');
    expect(branch?.contents.map((content) => content.id)).toEqual(['u1', 'm1', 'u2', 'm-regen']);
    if (!branch) {
      throw new Error('Expected regenerated session to exist.');
    }
    const originalAssistantNode = findBranchNodeByInteractionId(branch, 'interaction-2');
    const regeneratedAssistantNode = findBranchNodeByInteractionId(branch, 'interaction-regen');
    expect(originalAssistantNode).not.toBeNull();
    expect(regeneratedAssistantNode).not.toBeNull();
    expect(regeneratedAssistantNode?.parentNodeId).toBe(originalAssistantNode?.parentNodeId);
  });

  it('switches active branch to a selected assistant interaction inside the same chat', async () => {
    repository.sessions.set('chat-base', createMultiTurnSession('chat-base'));
    const settings = createSettings();

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => settings,
      completeAssistantTurn: async (session, inputSettings) => {
        const regenerated: GeminiContent = {
          id: 'm-regen',
          role: 'model',
          parts: [{ text: 'regenerated answer' }],
          metadata: {
            interactionId: 'interaction-regen',
            sourceModel: inputSettings.model,
          },
        };
        session.contents.push(regenerated);
        session.lastInteractionId = 'interaction-regen';
        return regenerated;
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await handler({
      type: 'chat/regen',
      chatId: 'chat-base',
      previousInteractionId: 'interaction-2',
      model: 'gemini-3.1-pro-preview',
    } as RuntimeRequest);

    const switched = await handler({
      type: 'chat/switch-branch',
      chatId: 'chat-base',
      interactionId: 'interaction-2',
    } as RuntimeRequest);

    expect(switched).toMatchObject({ chatId: 'chat-base' });
    const session = repository.sessions.get('chat-base');
    expect(session?.contents.map((content) => content.id)).toEqual(['u1', 'm1', 'u2', 'm2']);
    expect(session?.lastInteractionId).toBe('interaction-2');
  });

  it('rejects regenerate when target interaction id is missing', async () => {
    repository.sessions.set('chat-base', createMultiTurnSession('chat-base'));

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('completeAssistantTurn should not be called');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/regen',
        chatId: 'chat-base',
        model: 'gemini-3-flash-preview',
      } as RuntimeRequest),
    ).rejects.toThrow(/target interaction id/i);
  });

  it('rejects regenerate when chat does not exist', async () => {
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('completeAssistantTurn should not be called');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/regen',
        chatId: 'missing-chat',
        previousInteractionId: 'interaction-1',
        model: 'gemini-3-flash-preview',
      } as RuntimeRequest),
    ).rejects.toThrow(/chat that does not exist/i);
  });

  it('rejects regenerate when target assistant interaction is not found', async () => {
    repository.sessions.set('chat-base', createMultiTurnSession('chat-base'));
    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('completeAssistantTurn should not be called');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/regen',
        chatId: 'chat-base',
        previousInteractionId: 'missing-interaction',
        model: 'gemini-3-flash-preview',
      } as RuntimeRequest),
    ).rejects.toThrow(/target assistant message was not found/i);
  });

  it('rejects regenerate when no originating user prompt exists', async () => {
    repository.sessions.set('chat-assistant-only', {
      id: 'chat-assistant-only',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      contents: [
        {
          id: 'assistant-1',
          role: 'model',
          parts: [{ text: 'assistant answer without prompt' }],
          metadata: {
            interactionId: 'interaction-1',
          },
        },
      ],
      lastInteractionId: 'interaction-1',
    });

    const handler = createRuntimeRequestHandler({
      repository,
      bootstrapChatStorage: async () => {},
      readGeminiSettings: async () => createSettings(),
      completeAssistantTurn: async () => {
        throw new Error('completeAssistantTurn should not be called');
      },
      openOptionsPage: async () => {},
      now: () => new Date('2025-01-01T00:00:00.000Z'),
      generateSessionTitle: async () => '',
    });

    await expect(
      handler({
        type: 'chat/regen',
        chatId: 'chat-assistant-only',
        previousInteractionId: 'interaction-1',
        model: 'gemini-3-flash-preview',
      } as RuntimeRequest),
    ).rejects.toThrow(/no originating user prompt was found/i);
  });
});
