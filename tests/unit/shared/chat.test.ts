import { beforeEach, describe, expect, it } from 'bun:test';
import {
  captureCurrentTabFullPageScreenshot,
  captureTabFullPageScreenshotById,
  createNewChat,
  deleteChatById,
  extractTabTextById,
  forkChat,
  listChatSessions,
  listOpenTabsForMention,
  loadChatMessages,
  loadChatMessagesById,
  regenerateAssistantMessage,
  sendMessage,
  switchAssistantBranch,
  uploadChatFiles,
} from '../../../src/shared/chat';
import type { RuntimeRequest } from '../../../src/shared/runtime';
import { ACTIVE_CHAT_STORAGE_KEY } from '../../../src/shared/settings';
import {
  createChromeRuntimeSendMessageMock,
  createChromeStorageLocalMock,
} from '../helpers/chrome-mock';

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
        ...createChromeStorageLocalMock(storageState),
      },
    },
    runtime: {
      ...createChromeRuntimeSendMessageMock((request: RuntimeRequest) => {
        runtimeRequests.push(request);
        return runtimeResponses.shift();
      }),
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
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({ fallback: 'chat-2' });
  });

  it('isolates active chat selection across tabs with independent storage slots', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = {
      '101': 'chat-tab-a',
      '202': 'chat-tab-b',
      fallback: 'chat-fallback',
    };
    queueRuntimeResponses(
      {
        ok: true,
        payload: {
          chatId: 'chat-tab-a-next',
          assistantMessage: {
            id: 'assistant-a',
            role: 'assistant',
            content: 'tab a',
          },
        },
      },
      {
        ok: true,
        payload: {
          chatId: 'chat-tab-b-next',
          assistantMessage: {
            id: 'assistant-b',
            role: 'assistant',
            content: 'tab b',
          },
        },
      },
    );

    await sendMessage(
      'hello from tab a',
      'gemini-3-flash-preview',
      undefined,
      undefined,
      undefined,
      { tabId: 101 },
    );
    await sendMessage(
      'hello from tab b',
      'gemini-3-flash-preview',
      undefined,
      undefined,
      undefined,
      { tabId: 202 },
    );

    expect(runtimeRequests).toEqual([
      {
        type: 'chat/send',
        text: 'hello from tab a',
        model: 'gemini-3-flash-preview',
        chatId: 'chat-tab-a',
      },
      {
        type: 'chat/send',
        text: 'hello from tab b',
        model: 'gemini-3-flash-preview',
        chatId: 'chat-tab-b',
      },
    ]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({
      '101': 'chat-tab-a-next',
      '202': 'chat-tab-b-next',
      fallback: 'chat-fallback',
    });
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

  it('uses the fallback slot when tab context is not provided', async () => {
    storageState[ACTIVE_CHAT_STORAGE_KEY] = {
      '44': 'chat-tab-44',
      fallback: 'chat-fallback',
    };
    queueRuntimeResponses({
      ok: true,
      payload: {
        chatId: 'chat-fallback-next',
        messages: [],
      },
    });

    const payload = await loadChatMessages();

    expect(payload).toEqual({ chatId: 'chat-fallback-next', messages: [] });
    expect(runtimeRequests).toEqual([{ type: 'chat/load', chatId: 'chat-fallback' }]);
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({
      '44': 'chat-tab-44',
      fallback: 'chat-fallback-next',
    });
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
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({ fallback: 'chat-explicit' });
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
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({ fallback: 'chat-new' });
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
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({ fallback: 'chat-11' });
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
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({ fallback: 'chat-active' });
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
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({ fallback: 'chat-active' });
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
    expect(storageState[ACTIVE_CHAT_STORAGE_KEY]).toEqual({ fallback: 'chat-active' });
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

  it('returns empty upload payload when no files are provided', async () => {
    const payload = await uploadChatFiles([]);

    expect(payload).toEqual({
      attachments: [],
      failures: [],
    });
    expect(runtimeRequests).toEqual([]);
  });

  it('sends upload payloads through runtime bridge', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    queueRuntimeResponses({
      ok: true,
      payload: {
        attachments: [
          {
            name: 'note.txt',
            mimeType: 'text/plain',
            fileUri: 'https://example.invalid/files/note',
          },
        ],
        failures: [],
      },
    });

    const payload = await uploadChatFiles([file]);

    expect(runtimeRequests).toHaveLength(1);
    const request = runtimeRequests[0];
    expect(request).toMatchObject({
      type: 'chat/upload-files',
      files: [
        {
          name: 'note.txt',
          mimeType: expect.stringContaining('text/plain'),
        },
      ],
    });
    if (request.type !== 'chat/upload-files') {
      throw new Error('Expected upload files runtime request.');
    }
    expect(request.files[0]?.bytesBase64).toBe('aGVsbG8=');
    expect(payload).toEqual({
      attachments: [
        {
          name: 'note.txt',
          mimeType: 'text/plain',
          fileUri: 'https://example.invalid/files/note',
        },
      ],
      failures: [],
    });
  });

  it('requests full-page screenshots from background runtime', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        dataUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        fileName: 'speakeasy-full-page.png',
        width: 1200,
        height: 3400,
      },
    });

    const payload = await captureCurrentTabFullPageScreenshot();

    expect(runtimeRequests).toEqual([{ type: 'tab/capture-full-page' }]);
    expect(payload).toEqual({
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      fileName: 'speakeasy-full-page.png',
      width: 1200,
      height: 3400,
    });
  });

  it('requests open tabs for mention suggestions from background runtime', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        tabs: [
          {
            tabId: 88,
            windowId: 5,
            active: true,
            title: 'Example',
            url: 'https://example.com',
            hostname: 'example.com',
          },
        ],
      },
    });

    const payload = await listOpenTabsForMention();

    expect(runtimeRequests).toEqual([{ type: 'tab/list-open' }]);
    expect(payload).toEqual({
      tabs: [
        {
          tabId: 88,
          windowId: 5,
          active: true,
          title: 'Example',
          url: 'https://example.com',
          hostname: 'example.com',
        },
      ],
    });
  });

  it('requests full-page screenshots for explicit tab ids from background runtime', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        dataUrl: 'data:image/png;base64,BBBB',
        mimeType: 'image/png',
        fileName: 'selected-tab.png',
        width: 1110,
        height: 2900,
      },
    });

    const payload = await captureTabFullPageScreenshotById(88);

    expect(runtimeRequests).toEqual([{ type: 'tab/capture-full-page-by-id', tabId: 88 }]);
    expect(payload).toEqual({
      dataUrl: 'data:image/png;base64,BBBB',
      mimeType: 'image/png',
      fileName: 'selected-tab.png',
      width: 1110,
      height: 2900,
    });
  });

  it('requests tab text extraction for explicit tab ids from background runtime', async () => {
    queueRuntimeResponses({
      ok: true,
      payload: {
        markdown: '# Extracted page',
        title: 'Example Page',
        url: 'https://example.com/page',
      },
    });

    const payload = await extractTabTextById(88);

    expect(runtimeRequests).toEqual([{ type: 'tab/extract-text-by-id', tabId: 88 }]);
    expect(payload).toEqual({
      markdown: '# Extracted page',
      title: 'Example Page',
      url: 'https://example.com/page',
    });
  });
});
