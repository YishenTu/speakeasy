import { beforeEach, describe, expect, it } from 'bun:test';
import {
  createNewChat,
  deleteChatById,
  forkChat,
  listChatSessions,
  loadChatMessages,
  loadChatMessagesById,
  regenerateAssistantMessage,
  sendMessage,
  switchAssistantBranch,
} from '../../src/shared/chat';
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
        remove: async (keys: string | string[]) => {
          if (typeof keys === 'string') {
            delete storageState[keys];
            return;
          }
          for (const key of keys) {
            delete storageState[key];
          }
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
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'stale-chat';
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: null,
        messages: [],
      },
    });

    const payload = await loadChatMessages();

    expect(payload).toEqual({ chatId: null, messages: [] });
    expect(runtimeRequests).toEqual([{ type: 'chat/load', chatId: 'stale-chat' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBeUndefined();
  });

  it('loads chat messages by explicit chat id and persists returned chat id', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-explicit',
        messages: [],
      },
    });

    const payload = await loadChatMessagesById('chat-explicit');

    expect(payload).toEqual({ chatId: 'chat-explicit', messages: [] });
    expect(runtimeRequests).toEqual([{ type: 'chat/load', chatId: 'chat-explicit' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-explicit');
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

  it('sends trimmed user messages and forwards optional stream request ids', async () => {
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
      undefined,
      'stream-req-1',
    );

    expect(runtimeRequests).toEqual([
      {
        type: 'chat/send',
        text: 'hello there',
        model: 'gemini-3-flash-preview',
        thinkingLevel: 'high',
        chatId: 'chat-10',
        streamRequestId: 'stream-req-1',
      },
    ]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-11');
    expect(assistantMessage).toEqual({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hello there',
    });
  });

  it('rejects empty user messages when attachments are not present', async () => {
    await expect(sendMessage('   ', 'gemini-3-flash-preview', undefined, [])).rejects.toThrow(
      /empty message/i,
    );
    expect(runtimeRequests).toEqual([]);
  });

  it('allows attachment-only messages and forwards attachments', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-1',
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
        },
      },
    });

    await sendMessage('', 'gemini-3-flash-preview', undefined, [
      {
        name: 'note.txt',
        mimeType: 'text/plain',
        fileUri: 'https://example.invalid/files/note.txt',
      },
    ]);

    expect(runtimeRequests).toEqual([
      {
        type: 'chat/send',
        text: '',
        model: 'gemini-3-flash-preview',
        attachments: [
          {
            name: 'note.txt',
            mimeType: 'text/plain',
            fileUri: 'https://example.invalid/files/note.txt',
          },
        ],
      },
    ]);
  });

  it('throws when runtime response is missing', async () => {
    queueRuntimeResponses(undefined);

    await expect(loadChatMessages()).rejects.toThrow(/did not return a response/i);
  });

  it('throws runtime error and uses fallback when message is empty', async () => {
    queueRuntimeResponses({ ok: false, error: '' });

    await expect(createNewChat()).rejects.toThrow(/failed to handle the request/i);
  });

  it('deletes an active chat id and clears active chat state', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-123';
    queueRuntimeResponses({
      ok: true,
      payload: {
        deleted: true,
        chatId: null,
      },
    });

    const deleted = await deleteChatById('chat-123');

    expect(deleted).toBe(true);
    expect(runtimeRequests).toEqual([{ type: 'chat/delete', chatId: 'chat-123' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBeUndefined();
  });

  it('returns false when deleting a blank chat id', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-keep';

    const deleted = await deleteChatById('   ');

    expect(deleted).toBe(false);
    expect(runtimeRequests).toEqual([]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-keep');
  });

  it('deletes a specific non-active chat id', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-active';
    queueRuntimeResponses({
      ok: true,
      payload: {
        deleted: true,
        chatId: null,
      },
    });

    const deleted = await deleteChatById('chat-other');

    expect(deleted).toBe(true);
    expect(runtimeRequests).toEqual([{ type: 'chat/delete', chatId: 'chat-other' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-active');
  });

  it('lists chat sessions from runtime', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        sessions: [
          {
            chatId: 'chat-1',
            title: 'First chat',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    const sessions = await listChatSessions();

    expect(sessions).toEqual([
      {
        chatId: 'chat-1',
        title: 'First chat',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
    expect(runtimeRequests).toEqual([{ type: 'chat/list' }]);
  });

  it('forks within the active chat by interaction id', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-active';
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-active',
      },
    });

    const chatId = await forkChat('interaction-123');

    expect(chatId).toBe('chat-active');
    expect(runtimeRequests).toEqual([
      {
        type: 'chat/fork',
        chatId: 'chat-active',
        previousInteractionId: 'interaction-123',
      },
    ]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-active');
  });

  it('rejects fork when no active chat exists', async () => {
    await expect(forkChat('interaction-123')).rejects.toThrow(/active chat/i);
    expect(runtimeRequests).toEqual([]);
  });

  it('regenerates assistant message in the active chat', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-active';
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-active',
        assistantMessage: {
          id: 'assistant-regen',
          role: 'assistant',
          content: 'regenerated',
          interactionId: 'interaction-regen',
        },
      },
    });

    const assistant = await regenerateAssistantMessage(
      'interaction-2',
      'gemini-3.1-pro-preview',
      'high',
      'regen-stream-1',
    );

    expect(assistant).toMatchObject({
      id: 'assistant-regen',
      role: 'assistant',
      content: 'regenerated',
      interactionId: 'interaction-regen',
    });
    expect(runtimeRequests).toEqual([
      {
        type: 'chat/regen',
        chatId: 'chat-active',
        previousInteractionId: 'interaction-2',
        model: 'gemini-3.1-pro-preview',
        thinkingLevel: 'high',
        streamRequestId: 'regen-stream-1',
      },
    ]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-active');
  });

  it('switches assistant branch in the active chat', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-active';
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-active',
      },
    });

    const chatId = await switchAssistantBranch('interaction-2');

    expect(chatId).toBe('chat-active');
    expect(runtimeRequests).toEqual([
      {
        type: 'chat/switch-branch',
        chatId: 'chat-active',
        interactionId: 'interaction-2',
      },
    ]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toBe('chat-active');
  });

  it('rejects branch switching when no active chat exists', async () => {
    await expect(switchAssistantBranch('interaction-2')).rejects.toThrow(/active chat/i);
    expect(runtimeRequests).toEqual([]);
  });

  it('rejects branch switching when interaction id is blank', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-active';

    await expect(switchAssistantBranch('   ')).rejects.toThrow(/interaction id/i);
    expect(runtimeRequests).toEqual([]);
  });

  it('rejects regenerate when no active chat exists', async () => {
    await expect(
      regenerateAssistantMessage('interaction-2', 'gemini-3-flash-preview'),
    ).rejects.toThrow(/active chat/i);
    expect(runtimeRequests).toEqual([]);
  });

  it('rejects regenerate when target interaction id is blank', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = 'chat-active';

    await expect(regenerateAssistantMessage('   ', 'gemini-3-flash-preview')).rejects.toThrow(
      /target interaction id/i,
    );
    expect(runtimeRequests).toEqual([]);
  });
});
