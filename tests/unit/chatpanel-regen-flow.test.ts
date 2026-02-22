import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { ChatMessage } from '../../src/shared/messages';
import type { RuntimeRequest } from '../../src/shared/runtime';
import { ACTIVE_CHAT_STORAGE_KEY } from '../../src/shared/settings';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type UploadFilesRuntimeResponse = {
  ok: true;
  payload: {
    attachments: Array<{
      name: string;
      mimeType: string;
      fileUri: string;
    }>;
    failures: [];
  };
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
  let dom: InstalledDomEnvironment;
  let storageState: Record<string, unknown>;
  let currentMessages: ChatMessage[];
  let listSessionsPayload: { chatId: string; title: string; updatedAt: string }[];
  let openOptionsErrorMessage: string | null;
  let newChatErrorMessage: string | null;
  let sendErrorMessage: string | null;
  let sendRequest: Extract<RuntimeRequest, { type: 'chat/send' }> | null;
  let sendDeferred: Deferred<{
    ok: true;
    payload: {
      chatId: string;
      assistantMessage: ChatMessage;
    };
  }> | null;
  let regenRequest: Extract<RuntimeRequest, { type: 'chat/regen' }> | null;
  let forkRequest: Extract<RuntimeRequest, { type: 'chat/fork' }> | null;
  let switchBranchRequest: Extract<RuntimeRequest, { type: 'chat/switch-branch' }> | null;
  let uploadRequests: Extract<RuntimeRequest, { type: 'chat/upload-files' }>[];
  let deferredUploadResponsesByFileName: Map<string, Deferred<UploadFilesRuntimeResponse>>;
  let loadRequests: Extract<RuntimeRequest, { type: 'chat/load' }>[];
  let loadMessageSnapshots: string[];
  let runtimeMessageListeners: Array<(request: unknown) => void>;
  let regenDeferred: Deferred<{
    ok: true;
    payload: {
      chatId: string;
      assistantMessage: ChatMessage;
    };
  }>;

  function getTestWindow(): typeof dom.window {
    return dom.window;
  }

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
    sendRequest = null;
    sendDeferred = null;
    regenRequest = null;
    forkRequest = null;
    switchBranchRequest = null;
    uploadRequests = [];
    deferredUploadResponsesByFileName = new Map();
    loadRequests = [];
    loadMessageSnapshots = [];
    runtimeMessageListeners = [];
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
            loadRequests.push(request);
            loadMessageSnapshots.push(currentMessages.map((message) => message.content).join('|'));
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
          if (request.type === 'chat/fork') {
            forkRequest = request;
            return Promise.resolve({
              ok: true as const,
              payload: {
                chatId: request.chatId,
              },
            });
          }
          if (request.type === 'chat/switch-branch') {
            switchBranchRequest = request;
            return Promise.resolve({
              ok: true as const,
              payload: {
                chatId: request.chatId,
              },
            });
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
            sendRequest = request;
            if (sendErrorMessage) {
              return Promise.resolve({
                ok: false as const,
                error: sendErrorMessage,
              });
            }
            if (sendDeferred) {
              return sendDeferred.promise;
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
          if (request.type === 'chat/upload-files') {
            uploadRequests.push(request);
            const deferredUploadResponse = request.files
              .map((file) => deferredUploadResponsesByFileName.get(file.name))
              .find((deferred) => !!deferred);
            if (deferredUploadResponse) {
              return deferredUploadResponse.promise;
            }
            return Promise.resolve({
              ok: true as const,
              payload: {
                attachments: request.files.map((file, index) => ({
                  name: file.name,
                  mimeType: file.mimeType,
                  fileUri: `https://example.invalid/files/${index + 1}`,
                })),
                failures: [],
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
          addListener: (listener: (request: unknown) => void) => {
            runtimeMessageListeners.push(listener);
          },
        },
      },
    };
  });

  afterEach(() => {
    dom.restore();
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
    const testWindow = getTestWindow();
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
    const testWindow = getTestWindow();
    newChatErrorMessage = 'new session broke';
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const newChatButton = shadowRoot.querySelector(
      '#speakeasy-new-chat',
    ) as HTMLButtonElement | null;
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
    const testWindow = getTestWindow();
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

  it('keeps uploaded image preview visible while streaming and after send reconciliation', async () => {
    const testWindow = getTestWindow();
    currentMessages = [];
    listSessionsPayload = [];
    sendDeferred = createDeferred();
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const form = shadowRoot.querySelector('#speakeasy-form') as HTMLFormElement | null;
    const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
    const fileInput = shadowRoot.querySelector('#speakeasy-file-input') as HTMLInputElement | null;
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(form).not.toBeNull();
    expect(input).not.toBeNull();
    expect(fileInput).not.toBeNull();
    expect(messageList).not.toBeNull();
    if (!form || !input || !fileInput || !messageList) {
      throw new Error('Expected chatpanel form controls.');
    }
    const revokeSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const imageFile = new File(['image-bytes'], 'pasted.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [imageFile],
    });
    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks(20);
    expect(shadowRoot.querySelector('#speakeasy-file-previews .file-preview-spinner')).toBeNull();

    input.value = 'What is in this image?';
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks(30);

    expect(sendRequest?.type).toBe('chat/send');
    expect(sendRequest?.attachments).toHaveLength(1);
    expect(sendRequest?.attachments?.[0]).toMatchObject({
      name: 'pasted.png',
      mimeType: 'image/png',
      fileUri: 'https://example.invalid/files/1',
    });
    expect(sendRequest?.attachments?.[0]?.previewDataUrl).toMatch(/^data:image\/png;base64,/);
    const requestId = sendRequest?.streamRequestId;
    expect(typeof requestId).toBe('string');
    expect(requestId?.length).toBeGreaterThan(0);

    for (const listener of runtimeMessageListeners) {
      listener({
        type: 'chat/stream-delta',
        requestId,
        textDelta: 'Streaming reply',
      });
    }
    await flushMicrotasks(6);

    const streamedPreviewImage = messageList.querySelector(
      '.message-attachment-strip .file-preview-image',
    ) as HTMLImageElement | null;
    expect(streamedPreviewImage).not.toBeNull();
    expect(streamedPreviewImage?.src.startsWith('data:image/png;base64,')).toBe(true);
    const streamedPreviewUrl = streamedPreviewImage?.src ?? '';

    currentMessages = [
      {
        id: 'persisted-user-1',
        role: 'user',
        content: 'What is in this image?',
        attachments: [
          {
            name: 'pasted.png',
            mimeType: 'image/png',
            fileUri: 'https://example.invalid/files/1',
          },
        ],
      },
      {
        id: 'persisted-assistant-1',
        role: 'assistant',
        content: 'Looks like a test image.',
        interactionId: 'interaction-stream-final',
      },
    ];

    sendDeferred.resolve({
      ok: true,
      payload: {
        chatId: 'chat-seed',
        assistantMessage: {
          id: 'assistant-send',
          role: 'assistant',
          content: 'Looks like a test image.',
          interactionId: 'interaction-stream-final',
        },
      },
    });
    await flushMicrotasks(20);

    const reconciledPreviewImage = messageList.querySelector(
      '.message-attachment-strip .file-preview-image',
    ) as HTMLImageElement | null;
    expect(reconciledPreviewImage).not.toBeNull();
    expect(reconciledPreviewImage?.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(revokeSpy).not.toHaveBeenCalledWith(streamedPreviewUrl);
    expect(messageList.textContent).toContain('Looks like a test image.');
  });

  it('starts uploading on attach and blocks submit until image upload finishes', async () => {
    const testWindow = getTestWindow();
    currentMessages = [];
    listSessionsPayload = [];
    const pendingUpload = createDeferred<UploadFilesRuntimeResponse>();
    deferredUploadResponsesByFileName.set('pending.png', pendingUpload);

    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const form = shadowRoot.querySelector('#speakeasy-form') as HTMLFormElement | null;
    const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
    const fileInput = shadowRoot.querySelector('#speakeasy-file-input') as HTMLInputElement | null;
    const filePreviewContainer = shadowRoot.querySelector('#speakeasy-file-previews');
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(form).not.toBeNull();
    expect(input).not.toBeNull();
    expect(fileInput).not.toBeNull();
    expect(filePreviewContainer).not.toBeNull();
    expect(messageList).not.toBeNull();
    if (!form || !input || !fileInput || !filePreviewContainer || !messageList) {
      throw new Error('Expected form controls, preview container, and message list elements.');
    }

    const imageFile = new File(['pending-image'], 'pending.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [imageFile],
    });
    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks(8);

    expect(uploadRequests).toHaveLength(1);
    expect(uploadRequests[0]?.files).toHaveLength(1);
    expect(uploadRequests[0]?.files[0]?.name).toBe('pending.png');
    expect(filePreviewContainer.querySelectorAll('.file-preview-tile')).toHaveLength(1);
    expect(filePreviewContainer.querySelectorAll('.file-preview-spinner')).toHaveLength(1);

    input.value = 'Describe this image.';
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks(10);

    expect(sendRequest).toBeNull();
    expect(messageList.textContent).toContain(
      'Please wait for file uploads to finish before sending.',
    );

    pendingUpload.resolve({
      ok: true,
      payload: {
        attachments: [
          {
            name: 'pending.png',
            mimeType: 'image/png',
            fileUri: 'https://example.invalid/files/pending',
          },
        ],
        failures: [],
      },
    });
    await flushMicrotasks(16);

    expect(filePreviewContainer.querySelector('.file-preview-spinner')).toBeNull();

    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks(16);

    expect(sendRequest?.type).toBe('chat/send');
    expect(sendRequest?.attachments).toHaveLength(1);
    expect(sendRequest?.attachments?.[0]).toMatchObject({
      name: 'pending.png',
      mimeType: 'image/png',
      fileUri: 'https://example.invalid/files/pending',
    });
  });

  it('switches assistant branches from the branch selector and reloads messages', async () => {
    currentMessages = [
      { id: 'user-1', role: 'user', content: 'Tell me a joke.' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Original branch answer',
        interactionId: 'interaction-b',
        branchOptionInteractionIds: ['interaction-a', 'interaction-b'],
        branchOptionCount: 2,
        branchOptionIndex: 2,
      },
    ];

    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(messageList).not.toBeNull();

    currentMessages = [
      { id: 'user-1', role: 'user', content: 'Tell me a joke.' },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'Switched branch answer',
        interactionId: 'interaction-a',
        branchOptionInteractionIds: ['interaction-a', 'interaction-b'],
        branchOptionCount: 2,
        branchOptionIndex: 1,
      },
    ];

    const branchSwitch = shadowRoot.querySelector('.message-branch-switch');
    const prevButton = shadowRoot.querySelector('.message-branch-prev') as HTMLButtonElement | null;
    const nextButton = shadowRoot.querySelector('.message-branch-next') as HTMLButtonElement | null;
    expect(branchSwitch?.textContent?.trim()).toBe('<2/2>');
    expect(prevButton).not.toBeNull();
    expect(prevButton?.disabled).toBe(false);
    expect(nextButton).not.toBeNull();
    expect(nextButton?.disabled).toBe(true);
    prevButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushMicrotasks(50);

    expect(switchBranchRequest).toMatchObject({
      type: 'chat/switch-branch',
      chatId: 'chat-seed',
      interactionId: 'interaction-a',
    });
    expect(loadRequests.length).toBeGreaterThan(1);
    expect(
      loadMessageSnapshots.some((snapshot) => snapshot.includes('Switched branch answer')),
    ).toBe(true);
    expect(messageList?.textContent).toContain('Switched branch answer');
  });

  it('reloads after sending from a fork so branch switch metadata is visible', async () => {
    const testWindow = getTestWindow();
    currentMessages = [
      { id: 'user-1', role: 'user', content: 'Initial prompt' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Initial answer',
        interactionId: 'interaction-root',
      },
      {
        id: 'user-2',
        role: 'user',
        content: 'Second prompt',
        previousInteractionId: 'interaction-root',
      },
    ];

    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const forkButton = shadowRoot.querySelector('.message-fork-btn') as HTMLButtonElement | null;
    const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
    const form = shadowRoot.querySelector('#speakeasy-form') as HTMLFormElement | null;
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(forkButton).not.toBeNull();
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();
    expect(messageList).not.toBeNull();

    forkButton?.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    await flushMicrotasks(20);

    expect(forkRequest).toMatchObject({
      type: 'chat/fork',
      chatId: 'chat-seed',
      previousInteractionId: 'interaction-root',
    });

    currentMessages = [
      { id: 'user-1', role: 'user', content: 'Initial prompt' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Initial answer',
        interactionId: 'interaction-root',
      },
      {
        id: 'user-2-fork',
        role: 'user',
        content: 'Second prompt (edited)',
        previousInteractionId: 'interaction-root',
        branchOptionInteractionIds: ['interaction-2', 'interaction-fork'],
        branchOptionCount: 2,
        branchOptionIndex: 2,
      },
      {
        id: 'assistant-2-fork',
        role: 'assistant',
        content: 'Forked second answer',
        interactionId: 'interaction-fork',
      },
    ];

    if (!form || !input) {
      throw new Error('Expected chatpanel form controls.');
    }
    input.value = 'Second prompt (edited)';
    form.dispatchEvent(new testWindow.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks(40);

    const userRowBranchSwitch = shadowRoot.querySelector(
      'li[data-message-id="user-2-fork"] .message-branch-switch',
    );
    const assistantRowBranchSwitch = shadowRoot.querySelector(
      'li[data-message-id="assistant-2-fork"] .message-branch-switch',
    );
    expect(userRowBranchSwitch).not.toBeNull();
    expect(userRowBranchSwitch?.textContent?.trim()).toBe('<2/2>');
    expect(assistantRowBranchSwitch).toBeNull();
    expect(messageList?.textContent).toContain('Forked second answer');
  });

  it('enables history actions after opening the history menu and loads selected session', async () => {
    const testWindow = getTestWindow();
    listSessionsPayload = [
      { chatId: 'chat-other', title: 'Other chat', updatedAt: '2025-01-01T00:05:00.000Z' },
    ];

    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const historyToggleButton = shadowRoot.querySelector(
      '#speakeasy-history-toggle',
    ) as HTMLButtonElement | null;
    expect(historyToggleButton).not.toBeNull();

    historyToggleButton?.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    await flushMicrotasks(12);

    const sessionOpenButton = shadowRoot.querySelector(
      '.history-item-main',
    ) as HTMLButtonElement | null;
    const sessionDeleteButton = shadowRoot.querySelector(
      '.history-item-delete',
    ) as HTMLButtonElement | null;
    expect(sessionOpenButton).not.toBeNull();
    expect(sessionDeleteButton).not.toBeNull();
    expect(sessionOpenButton?.disabled).toBe(false);
    expect(sessionDeleteButton?.disabled).toBe(false);

    const previousLoadCount = loadRequests.length;
    sessionOpenButton?.dispatchEvent(new testWindow.MouseEvent('click', { bubbles: true }));
    await flushMicrotasks(20);

    expect(loadRequests.length).toBeGreaterThan(previousLoadCount);
    expect(loadRequests.at(-1)?.chatId).toBe('chat-other');
  });

  it('clears drag interaction lock when the panel closes during an active drag', async () => {
    const testWindow = getTestWindow();
    const globals = globalThis as { Element?: typeof testWindow.Element };
    const previousElementCtor = globals.Element;
    globals.Element = testWindow.Element;

    try {
      await importFreshChatpanelModule();
      await flushMicrotasks();

      const onMessageListener = runtimeMessageListeners[0];
      expect(typeof onMessageListener).toBe('function');
      onMessageListener?.({ type: 'overlay/open' });
      await flushMicrotasks(12);

      const shadowRoot = getChatpanelShadowRoot();
      const shell = shadowRoot.querySelector('#speakeasy-shell') as HTMLElement | null;
      const dragHandle = shadowRoot.querySelector('#speakeasy-drag-handle') as HTMLElement | null;
      expect(shell).not.toBeNull();
      expect(dragHandle).not.toBeNull();
      if (!shell || !dragHandle) {
        throw new Error('Expected shell and drag handle.');
      }

      let capturedPointerId: number | null = null;
      const shellWithPointerCapture = shell as HTMLElement & {
        setPointerCapture: (pointerId: number) => void;
        releasePointerCapture: (pointerId: number) => void;
        hasPointerCapture: (pointerId: number) => boolean;
      };
      shellWithPointerCapture.setPointerCapture = (pointerId: number) => {
        capturedPointerId = pointerId;
      };
      shellWithPointerCapture.releasePointerCapture = (pointerId: number) => {
        if (capturedPointerId === pointerId) {
          capturedPointerId = null;
        }
      };
      shellWithPointerCapture.hasPointerCapture = (pointerId: number) =>
        capturedPointerId === pointerId;

      const pointerDownEvent = new testWindow.MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 24,
      }) as MouseEvent & { pointerId: number };
      Object.defineProperty(pointerDownEvent, 'pointerId', {
        configurable: true,
        value: 7,
      });
      dragHandle.dispatchEvent(pointerDownEvent);
      expect(document.documentElement.style.userSelect).toBe('none');
      expect(capturedPointerId).toBe(7);

      onMessageListener?.({ type: 'overlay/close' });
      expect(document.documentElement.style.userSelect).toBe('');
      expect(capturedPointerId).toBeNull();
    } finally {
      if (previousElementCtor) {
        globals.Element = previousElementCtor;
      } else {
        Reflect.deleteProperty(globals, 'Element');
      }
    }
  });

  it('stages accepted files from drop events', async () => {
    const testWindow = getTestWindow();
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const shell = shadowRoot.querySelector('#speakeasy-shell') as HTMLElement | null;
    const filePreviewContainer = shadowRoot.querySelector('#speakeasy-file-previews');
    expect(shell).not.toBeNull();
    expect(filePreviewContainer).not.toBeNull();
    if (!shell || !filePreviewContainer) {
      throw new Error('Expected chatpanel shell and file preview container.');
    }

    const file = new File(['hello'], 'dropped.txt', { type: 'text/plain' });
    const dropEvent = new testWindow.Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer: DataTransfer;
    };
    Object.defineProperty(dropEvent, 'dataTransfer', {
      configurable: true,
      value: {
        types: ['Files'],
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [file],
      },
    });

    shell.dispatchEvent(dropEvent);

    const previewTiles = filePreviewContainer.querySelectorAll('.file-preview-tile');
    expect(previewTiles).toHaveLength(1);
    expect(filePreviewContainer.textContent).toContain('dropped.txt');
  });

  it('enforces staged-file limits and reports overflow', async () => {
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const fileInput = shadowRoot.querySelector('#speakeasy-file-input') as HTMLInputElement | null;
    const filePreviewContainer = shadowRoot.querySelector('#speakeasy-file-previews');
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(fileInput).not.toBeNull();
    expect(filePreviewContainer).not.toBeNull();
    expect(messageList).not.toBeNull();
    if (!fileInput || !filePreviewContainer || !messageList) {
      throw new Error('Expected file input, preview container, and message list elements.');
    }

    const files = Array.from(
      { length: 6 },
      (_, index) => new File([`file-${index}`], `file-${index}.txt`, { type: 'text/plain' }),
    );
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: files,
    });
    fileInput.dispatchEvent(new Event('change'));

    expect(filePreviewContainer.querySelectorAll('.file-preview-tile')).toHaveLength(5);
    expect(messageList.textContent).toContain('Only 5 additional file(s) were staged.');
  });

  it('rejects unsupported or oversized staged files with assistant errors', async () => {
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const fileInput = shadowRoot.querySelector('#speakeasy-file-input') as HTMLInputElement | null;
    const filePreviewContainer = shadowRoot.querySelector('#speakeasy-file-previews');
    const messageList = shadowRoot.querySelector('#speakeasy-messages') as HTMLOListElement | null;
    expect(fileInput).not.toBeNull();
    expect(filePreviewContainer).not.toBeNull();
    expect(messageList).not.toBeNull();
    if (!fileInput || !filePreviewContainer || !messageList) {
      throw new Error('Expected file input, preview container, and message list elements.');
    }

    const oversizedFile = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.txt', {
      type: 'text/plain',
    });
    const unsupportedFile = new File(['{}'], 'data.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [oversizedFile, unsupportedFile],
    });
    fileInput.dispatchEvent(new Event('change'));

    expect(filePreviewContainer.querySelectorAll('.file-preview-tile')).toHaveLength(0);
    expect(messageList.textContent).toContain('"large.txt" exceeds the 20 MB file size limit.');
    expect(messageList.textContent).toContain('Unsupported file type for "data.json".');
  });

  it('renders staged pdf attachments as square tiles instead of chips', async () => {
    await importFreshChatpanelModule();
    await flushMicrotasks();

    const shadowRoot = getChatpanelShadowRoot();
    const fileInput = shadowRoot.querySelector('#speakeasy-file-input') as HTMLInputElement | null;
    const filePreviewContainer = shadowRoot.querySelector('#speakeasy-file-previews');
    expect(fileInput).not.toBeNull();
    expect(filePreviewContainer).not.toBeNull();
    if (!fileInput || !filePreviewContainer) {
      throw new Error('Expected file input and file preview container elements.');
    }

    const pdfFile = new File(['%PDF-1.7'], 'spec.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [pdfFile],
    });
    fileInput.dispatchEvent(new Event('change'));
    await flushMicrotasks(16);

    const pdfTile = filePreviewContainer.querySelector(
      '.file-preview-tile',
    ) as HTMLDivElement | null;
    const pdfGeneric = filePreviewContainer.querySelector(
      '.file-preview-generic.is-pdf',
    ) as HTMLDivElement | null;
    expect(pdfTile).not.toBeNull();
    expect(pdfGeneric).not.toBeNull();
    expect(filePreviewContainer.querySelector('.file-chip')).toBeNull();
    expect(filePreviewContainer.textContent).toContain('PDF');
    expect(filePreviewContainer.textContent).toContain('spec.pdf');
  });

  it('applies composer auto-resize on mount to avoid first-keystroke jump', async () => {
    const testWindow = getTestWindow();
    const textareaPrototype = testWindow.HTMLTextAreaElement.prototype;
    const hasOwnScrollHeightDescriptor = Object.prototype.hasOwnProperty.call(
      textareaPrototype,
      'scrollHeight',
    );
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      textareaPrototype,
      'scrollHeight',
    );

    Object.defineProperty(textareaPrototype, 'scrollHeight', {
      configurable: true,
      get: () => 96,
    });

    try {
      await importFreshChatpanelModule();
      await flushMicrotasks();

      const shadowRoot = getChatpanelShadowRoot();
      const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      expect(input?.style.height).toBe('96px');
    } finally {
      if (hasOwnScrollHeightDescriptor && originalScrollHeightDescriptor) {
        Object.defineProperty(textareaPrototype, 'scrollHeight', originalScrollHeightDescriptor);
      } else {
        Reflect.deleteProperty(textareaPrototype, 'scrollHeight');
      }
    }
  });

  it('grows input with content and caps height to one-third of panel height', async () => {
    const testWindow = getTestWindow();
    let nextScrollHeight = 72;
    const textareaPrototype = testWindow.HTMLTextAreaElement.prototype;
    const hasOwnScrollHeightDescriptor = Object.prototype.hasOwnProperty.call(
      textareaPrototype,
      'scrollHeight',
    );
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      textareaPrototype,
      'scrollHeight',
    );

    Object.defineProperty(textareaPrototype, 'scrollHeight', {
      configurable: true,
      get: () => nextScrollHeight,
    });

    try {
      await importFreshChatpanelModule();
      await flushMicrotasks();

      const shadowRoot = getChatpanelShadowRoot();
      const shell = shadowRoot.querySelector('#speakeasy-shell') as HTMLElement | null;
      const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
      expect(shell).not.toBeNull();
      expect(input).not.toBeNull();

      if (!shell || !input) {
        throw new Error('Expected chatpanel shell and input elements.');
      }

      Object.defineProperty(shell, 'clientHeight', {
        configurable: true,
        get: () => 600,
      });

      input.dispatchEvent(new testWindow.Event('input', { bubbles: true }));
      expect(input.style.maxHeight).toBe('200px');
      const firstResizeHeight = Number.parseFloat(input.style.height);
      expect(firstResizeHeight).toBeGreaterThanOrEqual(72);
      expect(firstResizeHeight).toBeLessThanOrEqual(200);

      nextScrollHeight = 320;
      input.dispatchEvent(new testWindow.Event('input', { bubbles: true }));
      expect(input.style.maxHeight).toBe('200px');
      expect(input.style.height).toBe('200px');
    } finally {
      if (hasOwnScrollHeightDescriptor && originalScrollHeightDescriptor) {
        Object.defineProperty(textareaPrototype, 'scrollHeight', originalScrollHeightDescriptor);
      } else {
        Reflect.deleteProperty(textareaPrototype, 'scrollHeight');
      }
    }
  });

  it('keeps a multiline minimum height when scrollHeight is zero', async () => {
    const testWindow = getTestWindow();
    const textareaPrototype = testWindow.HTMLTextAreaElement.prototype;
    const hasOwnScrollHeightDescriptor = Object.prototype.hasOwnProperty.call(
      textareaPrototype,
      'scrollHeight',
    );
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      textareaPrototype,
      'scrollHeight',
    );

    Object.defineProperty(textareaPrototype, 'scrollHeight', {
      configurable: true,
      get: () => 0,
    });

    try {
      await importFreshChatpanelModule();
      await flushMicrotasks();

      const shadowRoot = getChatpanelShadowRoot();
      const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();

      const resolvedHeight = Number.parseFloat(input?.style.height ?? '0');
      expect(Number.isFinite(resolvedHeight)).toBe(true);
      expect(resolvedHeight).toBeGreaterThan(30);
    } finally {
      if (hasOwnScrollHeightDescriptor && originalScrollHeightDescriptor) {
        Object.defineProperty(textareaPrototype, 'scrollHeight', originalScrollHeightDescriptor);
      } else {
        Reflect.deleteProperty(textareaPrototype, 'scrollHeight');
      }
    }
  });

  it('stabilizes input height after file staging so first typing does not jump again', async () => {
    const testWindow = getTestWindow();
    let nextScrollHeight = 0;
    const textareaPrototype = testWindow.HTMLTextAreaElement.prototype;
    const hasOwnScrollHeightDescriptor = Object.prototype.hasOwnProperty.call(
      textareaPrototype,
      'scrollHeight',
    );
    const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      textareaPrototype,
      'scrollHeight',
    );

    Object.defineProperty(textareaPrototype, 'scrollHeight', {
      configurable: true,
      get: () => nextScrollHeight,
    });

    try {
      await importFreshChatpanelModule();
      await flushMicrotasks();

      const shadowRoot = getChatpanelShadowRoot();
      const shell = shadowRoot.querySelector('#speakeasy-shell') as HTMLElement | null;
      const input = shadowRoot.querySelector('#speakeasy-input') as HTMLTextAreaElement | null;
      const fileInput = shadowRoot.querySelector(
        '#speakeasy-file-input',
      ) as HTMLInputElement | null;
      expect(shell).not.toBeNull();
      expect(input).not.toBeNull();
      expect(fileInput).not.toBeNull();

      if (!shell || !input || !fileInput) {
        throw new Error('Expected shell, input, and file input elements.');
      }

      Object.defineProperty(shell, 'clientHeight', {
        configurable: true,
        get: () => 600,
      });

      const beforeStageHeight = Number.parseFloat(input.style.height);
      nextScrollHeight = 108;

      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [new File(['img'], 'pasted.png', { type: 'image/png' })],
      });
      fileInput.dispatchEvent(new Event('change'));

      const stagedHeight = Number.parseFloat(input.style.height);
      expect(stagedHeight).toBeGreaterThan(beforeStageHeight);

      input.value = 'a';
      input.dispatchEvent(new testWindow.Event('input', { bubbles: true }));
      const typedHeight = Number.parseFloat(input.style.height);
      expect(typedHeight).toBe(stagedHeight);
    } finally {
      if (hasOwnScrollHeightDescriptor && originalScrollHeightDescriptor) {
        Object.defineProperty(textareaPrototype, 'scrollHeight', originalScrollHeightDescriptor);
      } else {
        Reflect.deleteProperty(textareaPrototype, 'scrollHeight');
      }
    }
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
