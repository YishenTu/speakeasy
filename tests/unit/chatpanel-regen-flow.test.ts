import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ChatMessage } from '../../src/shared/messages';
import type { RuntimeRequest } from '../../src/shared/runtime';
import { ACTIVE_CHAT_STORAGE_KEY } from '../../src/shared/settings';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  if (!resolve || !reject) {
    throw new Error('Failed to create deferred promise.');
  }

  return { promise, resolve, reject };
}

async function flushMicrotasks(iterations = 6): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('chatpanel regenerate flow', () => {
  let dom: InstalledDomEnvironment | null = null;
  let storageState: Record<string, unknown>;
  let currentMessages: ChatMessage[];
  let listSessionsPayload: { chatId: string; title: string; updatedAt: string }[];
  let openOptionsErrorMessage: string | null;
  let newChatErrorMessage: string | null;
  let sendErrorMessage: string | null;
  let regenRequest: Extract<RuntimeRequest, { type: 'chat/regen' }> | null;
  let regenDeferred: Deferred<{
    ok: true;
    payload: {
      chatId: string;
      assistantMessage: ChatMessage;
    };
  }>;

  beforeEach(() => {
    dom = installDomTestEnvironment();
    storageState = { [ACTIVE_CHAT_STORAGE_KEY]: 'chat-seed' };
    currentMessages = [
      { id: 'user-1', role: 'user', content: 'Tell me a joke.' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Original flash answer',
        interactionId: 'interaction-1',
      },
    ];
    listSessionsPayload = [
      { chatId: 'chat-seed', title: 'Seed Chat', updatedAt: '2025-01-01T00:00:00.000Z' },
    ];
    openOptionsErrorMessage = null;
    newChatErrorMessage = null;
    sendErrorMessage = null;
    regenRequest = null;
    regenDeferred = createDeferred();

    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        onChanged: {
          addListener: () => {},
          removeListener: () => {},
        },
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
        sendMessage: (request: RuntimeRequest | { type: 'app/open-options' }) => {
          if (request.type === 'chat/load') {
            return Promise.resolve({
              ok: true as const,
              payload: {
                chatId: typeof request.chatId === 'string' ? request.chatId : 'chat-seed',
                messages: currentMessages,
              },
            });
          }
          if (request.type === 'chat/list') {
            return Promise.resolve({
              ok: true as const,
              payload: {
                sessions: listSessionsPayload,
              },
            });
          }
          if (request.type === 'chat/regen') {
            regenRequest = request;
            return regenDeferred.promise;
          }
          if (request.type === 'chat/new') {
            if (newChatErrorMessage) {
              return Promise.resolve({
                ok: false as const,
                error: newChatErrorMessage,
              });
            }
            return Promise.resolve({
              ok: true as const,
              payload: {
                chatId: 'chat-new',
              },
            });
          }
          if (request.type === 'chat/send') {
            if (sendErrorMessage) {
              return Promise.resolve({
                ok: false as const,
                error: sendErrorMessage,
              });
            }
            return Promise.resolve({
              ok: true as const,
              payload: {
                chatId: 'chat-seed',
                assistantMessage: {
                  id: 'assistant-send',
                  role: 'assistant',
                  content: 'Sent response',
                  interactionId: 'interaction-send',
                },
              },
            });
          }
          if (request.type === 'app/open-options') {
            if (openOptionsErrorMessage) {
              return Promise.resolve({
                ok: false as const,
                error: openOptionsErrorMessage,
              });
            }
            return Promise.resolve({
              ok: true as const,
              payload: { opened: true as const },
            });
          }
          throw new Error(`Unexpected runtime request type: ${request.type}`);
        },
        onMessage: {
          addListener: () => {},
        },
      },
    };
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
    (globalThis as { chrome?: unknown }).chrome = undefined;
  });

  it('replaces the target assistant content with a thinking placeholder while regen is pending', async () => {
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();

    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(messageList).not.toBeNull();

    const regenButton = shadowRoot.querySelector('.message-regen-btn') as HTMLButtonElement | null;
    expect(regenButton).not.toBeNull();

    regenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushMicrotasks();

    const assistantRow = messageList?.querySelector('li[data-message-id="assistant-1"]');
    expect(assistantRow).not.toBeNull();
    expect(assistantRow?.textContent).toContain('Thinking...');
    expect(assistantRow?.textContent).not.toContain('Original flash answer');
    expect(regenRequest?.type).toBe('chat/regen');
    expect(typeof regenRequest?.streamRequestId).toBe('string');
    expect(regenRequest?.streamRequestId?.length).toBeGreaterThan(0);

    currentMessages = [
      { id: 'user-1', role: 'user', content: 'Tell me a joke.' },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'Regenerated pro answer',
        interactionId: 'interaction-2',
      },
    ];
    listSessionsPayload = [
      { chatId: 'chat-regen', title: 'Branch Chat', updatedAt: '2025-01-01T00:01:00.000Z' },
    ];
    regenDeferred.resolve({
      ok: true,
      payload: {
        chatId: 'chat-regen',
        assistantMessage: currentMessages[1],
      },
    });
    await flushMicrotasks(10);

    expect(messageList?.textContent).toContain('Regenerated pro answer');
  });

  it('shows a local error message when opening settings fails', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    openOptionsErrorMessage = 'Failed to open settings';
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const settingsButton = shadowRoot.querySelector(
      '#speakeasy-settings',
    ) as HTMLButtonElement | null;
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;

    expect(settingsButton).not.toBeNull();
    expect(messageList).not.toBeNull();

    settingsButton?.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    await flushMicrotasks();

    expect(messageList?.textContent).toContain('Failed to open settings');
  });

  it('keeps the panel responsive when creating a new chat fails', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    newChatErrorMessage = 'new session broke';
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const newChatButton = shadowRoot.querySelector('#speakeasy-new-chat') as HTMLButtonElement | null;
    const form = shadowRoot.querySelector('#speakeasy-form') as HTMLFormElement | null;
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(newChatButton).not.toBeNull();
    expect(form).not.toBeNull();
    expect(messageList).not.toBeNull();

    newChatButton?.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    await flushMicrotasks();

    expect(form?.getAttribute('aria-busy')).toBeNull();
    expect(messageList?.textContent).toContain('new session broke');
  });

  it('removes optimistic rows when send fails and appends an assistant error', async () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    currentMessages = [];
    listSessionsPayload = [];
    sendErrorMessage = 'send failed';
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const form = shadowRoot.querySelector('#speakeasy-form') as HTMLFormElement | null;
    const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(form).not.toBeNull();
    expect(input).not.toBeNull();
    expect(messageList).not.toBeNull();

    if (!form || !input) {
      throw new Error('Expected chatpanel form controls.');
    }
    input.value = 'failure prompt';
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks(10);

    expect(messageList?.textContent).toContain('send failed');
    expect(messageList?.textContent).not.toContain('failure prompt');
    expect(messageList?.querySelectorAll('li[data-message-id]').length).toBe(1);
  });
});

async function importFreshChatpanelModule(): Promise<void> {
  await import(`../../src/chatpanel/chatpanel.ts?test=${crypto.randomUUID()}`);
}

function getChatpanelShadowRoot(): ShadowRoot {
  const host = document.getElementById('speakeasy-overlay-root');
  if (!host) {
    throw new Error('Chatpanel host is missing.');
  }

  const shadowRoot = host.shadowRoot;
  if (!shadowRoot) {
    throw new Error('Chatpanel shadow root is missing.');
  }

  return shadowRoot;
}
