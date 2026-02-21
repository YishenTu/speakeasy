import { beforeEach, describe, expect, it } from 'bun:test';
import { createNewChat, loadChatMessages, sendMessage } from '../../src/shared/chat';
import type { RuntimeRequest } from '../../src/shared/runtime';
import { ACTIVE_CHAT_STORAGE_KEY } from '../../src/shared/settings';

const storageState: Record<string, unknown> = {};
const runtimeRequests: RuntimeRequest[] = [];
let runtimeResponses: unknown[] = [];

function queueRuntimeResponses(...responses: unknown[]): void {
  runtimeResponses.push(...responses);
}

function clearState(): void {
  for (const key of Object.keys(storageState)) {
    delete storageState[key];
  }
  runtimeRequests.length = 0;
  runtimeResponses = [];
}

function installChromeMock(): void {
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (query?: string) => {
          if (typeof query === 'string') {
            return { [query]: storageState[query] };
          }
          return { ...storageState };
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storageState, items);
        },
      },
    },
    runtime: {
      sendMessage: async (request: RuntimeRequest) => {
        runtimeRequests.push(request);
        return runtimeResponses.shift();
      },
    },
  };
}

describe('shared chat client', () => {
  beforeEach(() => {
    clearState();
    installChromeMock();
  });

  it('loads chat messages with stored chat id and persists returned chat id', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-1';
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-2',
        messages: [{ id: 'm-1', role: 'assistant', content: 'Welcome back' }],
      },
    });

    const payload = await loadChatMessages();

    expect(payload.chatId).toBe('chat-2');
    expect(runtimeRequests).toEqual([{ type: 'chat/load', chatId: 'chat-1' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-2');
  });

  it('loads chat messages without chat id when none is stored', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: null,
        messages: [],
      },
    });

    const payload = await loadChatMessages();

    expect(payload).toEqual({ chatId: null, messages: [] });
    expect(runtimeRequests).toEqual([{ type: 'chat/load' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBeUndefined();
  });

  it('creates a new chat and stores the returned chat id', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-new',
      },
    });

    const chatId = await createNewChat();

    expect(chatId).toBe('chat-new');
    expect(runtimeRequests).toEqual([{ type: 'chat/new' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-new');
  });

  it('sends trimmed user messages and returns the assistant message', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-10';
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-11',
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Hello there',
        },
      },
    });

    const assistantMessage = await sendMessage(
      '   hello there   ',
      'gemini-3-flash-preview',
      'high',
    );

    expect(runtimeRequests).toEqual([
      {
        type: 'chat/send',
        text: 'hello there',
        model: 'gemini-3-flash-preview',
        thinkingLevel: 'high',
        chatId: 'chat-10',
      },
    ]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-11');
    expect(assistantMessage).toEqual({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hello there',
    });
  });

  it('rejects empty user messages before calling runtime', async () => {
    await expect(sendMessage('   ', 'gemini-3-flash-preview')).rejects.toThrow(/empty message/i);
    expect(runtimeRequests).toEqual([]);
  });

  it('throws when runtime response is missing', async () => {
    queueRuntimeResponses(undefined);

    await expect(loadChatMessages()).rejects.toThrow(/did not return a response/i);
  });

  it('throws runtime error and uses fallback when message is empty', async () => {
    queueRuntimeResponses({ ok: false, error: '' });

    await expect(createNewChat()).rejects.toThrow(/failed to handle the request/i);
  });
});
