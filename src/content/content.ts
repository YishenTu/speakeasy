import { type ChatMessage, createNewChat, loadChatMessages, sendMessage } from '../shared/chat';

const ROOT_HOST_ID = 'speakeasy-overlay-root';

if (window.top === window) {
  mountOverlay();
}

function mountOverlay(): void {
  if (document.getElementById(ROOT_HOST_ID)) {
    return;
  }

  const host = document.createElement('div');
  host.id = ROOT_HOST_ID;
  document.documentElement.append(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = getTemplate();

  const launcherButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-launcher');
  const panel = queryRequiredElement<HTMLElement>(shadowRoot, '#speakeasy-panel');
  const closeButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-close');
  const settingsButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-settings');
  const newChatButton = queryRequiredElement<HTMLButtonElement>(shadowRoot, '#speakeasy-new-chat');
  const form = queryRequiredElement<HTMLFormElement>(shadowRoot, '#speakeasy-form');
  const input = queryRequiredElement<HTMLInputElement>(shadowRoot, '#speakeasy-input');
  const messageList = queryRequiredElement<HTMLOListElement>(shadowRoot, '#speakeasy-messages');

  let isPanelOpen = false;
  let isBusy = false;
  let hasLoadedHistory = false;

  launcherButton.addEventListener('click', () => {
    void togglePanel();
  });

  closeButton.addEventListener('click', () => {
    closePanel();
  });

  settingsButton.addEventListener('click', () => {
    void openSettings(messageList);
  });

  newChatButton.addEventListener('click', async () => {
    if (isBusy) {
      return;
    }

    setBusyState(true);
    try {
      await createNewChat();
      renderAll([createWelcomeMessage()], messageList);
      input.focus();
    } catch (error: unknown) {
      appendMessage(
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: toErrorMessage(error),
        },
        messageList,
      );
    } finally {
      setBusyState(false);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (isBusy) {
      return;
    }

    const userText = input.value.trim();
    if (!userText) {
      return;
    }

    appendMessage(
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: userText,
      },
      messageList,
    );

    input.value = '';
    setBusyState(true);

    try {
      const assistantMessage = await sendMessage(userText);
      appendMessage(assistantMessage, messageList);
    } catch (error: unknown) {
      appendMessage(
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: toErrorMessage(error),
        },
        messageList,
      );
    } finally {
      setBusyState(false);
      input.focus();
    }
  });

  chrome.runtime.onMessage.addListener((request: unknown) => {
    if (!isRecord(request)) {
      return;
    }

    if (request.type === 'overlay/toggle') {
      void togglePanel();
      return;
    }

    if (request.type === 'overlay/open') {
      void openPanel();
      return;
    }

    if (request.type === 'overlay/close') {
      closePanel();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isPanelOpen) {
      closePanel();
    }
  });

  void loadConversationHistory();

  async function togglePanel(): Promise<void> {
    if (isPanelOpen) {
      closePanel();
      return;
    }

    await openPanel();
  }

  async function openPanel(): Promise<void> {
    isPanelOpen = true;
    panel.hidden = false;
    launcherButton.classList.add('is-open');

    if (!hasLoadedHistory) {
      await loadConversationHistory();
    }

    input.focus();
  }

  function closePanel(): void {
    isPanelOpen = false;
    panel.hidden = true;
    launcherButton.classList.remove('is-open');
  }

  async function loadConversationHistory(): Promise<void> {
    hasLoadedHistory = true;

    try {
      const history = await loadChatMessages();
      if (history.messages.length > 0) {
        renderAll(history.messages, messageList);
        return;
      }

      renderAll([createWelcomeMessage()], messageList);
    } catch (error: unknown) {
      renderAll(
        [
          createWelcomeMessage(),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: toErrorMessage(error),
          },
        ],
        messageList,
      );
    }
  }

  function setBusyState(nextBusy: boolean): void {
    isBusy = nextBusy;
    input.disabled = nextBusy;
    newChatButton.disabled = nextBusy;
    form.toggleAttribute('aria-busy', nextBusy);
  }
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      'Speakeasy is ready. Ask a question, or open Settings to configure your Gemini API key.',
  };
}

function renderAll(messages: ChatMessage[], messageList: HTMLOListElement): void {
  const fragment = document.createDocumentFragment();
  for (const message of messages) {
    fragment.append(createMessageNode(message));
  }

  messageList.replaceChildren(fragment);
  messageList.scrollTop = messageList.scrollHeight;
}

function appendMessage(message: ChatMessage, messageList: HTMLOListElement): void {
  messageList.append(createMessageNode(message));
  messageList.scrollTop = messageList.scrollHeight;
}

function createMessageNode(message: ChatMessage): HTMLLIElement {
  const item = document.createElement('li');
  const label = document.createElement('span');
  const bubble = document.createElement('p');

  item.className = message.role === 'user' ? 'row row-user' : 'row row-assistant';
  label.className = 'role-label';
  label.textContent = message.role === 'user' ? 'You' : 'Speakeasy';

  bubble.className = message.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-assistant';
  bubble.textContent = message.content;

  item.append(label, bubble);
  return item;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Request failed. Please try again.';
}

async function openSettings(messageList: HTMLOListElement): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'app/open-options',
  })) as { ok: true; payload: { opened: true } } | { ok: false; error: string } | undefined;

  if (!response || !response.ok) {
    appendMessage(
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response?.error || 'Unable to open settings.',
      },
      messageList,
    );
  }
}

function queryRequiredElement<TElement extends Element>(
  root: ParentNode,
  selector: string,
): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Speakeasy overlay is missing required node: ${selector}`);
  }

  return element;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getTemplate(): string {
  return `
    <style>
      :host {
        all: initial;
      }

      .shell {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        color: #f8fafc;
      }

      .launcher {
        width: 56px;
        height: 56px;
        border: 0;
        border-radius: 16px;
        background:
          radial-gradient(circle at 20% 20%, #22d3ee 0%, rgba(34, 211, 238, 0.6) 35%, transparent 70%),
          linear-gradient(155deg, #0f172a 0%, #111827 52%, #1f2937 100%);
        color: #e2e8f0;
        cursor: pointer;
        box-shadow: 0 16px 38px rgba(2, 6, 23, 0.45), inset 0 0 0 1px rgba(148, 163, 184, 0.28);
        transition: transform 140ms ease, box-shadow 140ms ease;
      }

      .launcher:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 42px rgba(2, 6, 23, 0.5), inset 0 0 0 1px rgba(148, 163, 184, 0.36);
      }

      .launcher:focus-visible {
        outline: 2px solid #22d3ee;
        outline-offset: 2px;
      }

      .launcher.is-open {
        background:
          radial-gradient(circle at 20% 20%, #14b8a6 0%, rgba(20, 184, 166, 0.62) 35%, transparent 70%),
          linear-gradient(155deg, #0f172a 0%, #111827 52%, #1f2937 100%);
      }

      .launcher-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 600;
      }

      .panel {
        width: min(390px, calc(100vw - 24px));
        height: min(620px, calc(100vh - 96px));
        margin-top: 10px;
        border-radius: 20px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        border: 1px solid rgba(100, 116, 139, 0.42);
        background:
          linear-gradient(170deg, rgba(15, 23, 42, 0.97) 0%, rgba(17, 24, 39, 0.98) 42%, rgba(30, 41, 59, 0.97) 100%);
        box-shadow: 0 26px 72px rgba(2, 6, 23, 0.58), inset 0 1px 0 rgba(148, 163, 184, 0.16);
      }

      .panel[hidden] {
        display: none;
      }

      .top {
        padding: 14px 14px 12px;
        border-bottom: 1px solid rgba(71, 85, 105, 0.52);
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.88) 0%, rgba(15, 23, 42, 0.35) 100%);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .brand-title {
        margin: 0;
        font-size: 15px;
        font-weight: 650;
        letter-spacing: 0.01em;
      }

      .brand-subtitle {
        margin: 2px 0 0;
        font-size: 12px;
        color: #94a3b8;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .control-btn {
        border: 1px solid rgba(71, 85, 105, 0.7);
        background: rgba(15, 23, 42, 0.8);
        color: #cbd5e1;
        border-radius: 10px;
        padding: 6px 9px;
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease;
      }

      .control-btn:hover {
        border-color: rgba(148, 163, 184, 0.8);
        background: rgba(30, 41, 59, 0.82);
      }

      .control-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .messages {
        margin: 0;
        padding: 14px 14px 12px;
        overflow: auto;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .messages::-webkit-scrollbar {
        width: 8px;
      }

      .messages::-webkit-scrollbar-thumb {
        background: rgba(100, 116, 139, 0.6);
        border-radius: 999px;
      }

      .row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .row-user {
        align-items: flex-end;
      }

      .row-assistant {
        align-items: flex-start;
      }

      .role-label {
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #64748b;
      }

      .bubble {
        max-width: 84%;
        margin: 0;
        padding: 9px 11px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre-wrap;
      }

      .bubble-user {
        background: linear-gradient(145deg, #14b8a6 0%, #22d3ee 100%);
        color: #082f49;
        box-shadow: inset 0 0 0 1px rgba(6, 78, 59, 0.2);
      }

      .bubble-assistant {
        background: rgba(30, 41, 59, 0.88);
        color: #e2e8f0;
        box-shadow: inset 0 0 0 1px rgba(100, 116, 139, 0.24);
      }

      .composer {
        padding: 12px 12px 14px;
        border-top: 1px solid rgba(71, 85, 105, 0.52);
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.2) 0%, rgba(15, 23, 42, 0.72) 100%);
      }

      .composer[aria-busy="true"] {
        opacity: 0.8;
      }

      .input {
        border: 1px solid rgba(100, 116, 139, 0.7);
        background: rgba(15, 23, 42, 0.82);
        color: #f1f5f9;
        border-radius: 10px;
        padding: 9px 10px;
        font-size: 13px;
      }

      .input::placeholder {
        color: #64748b;
      }

      .input:focus {
        outline: none;
        border-color: #22d3ee;
        box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.2);
      }

      .send {
        border: 0;
        border-radius: 10px;
        padding: 0 13px;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #022c22;
        cursor: pointer;
        background: linear-gradient(145deg, #2dd4bf 0%, #67e8f9 100%);
      }

      .send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @media (max-width: 620px) {
        .shell {
          right: 12px;
          left: 12px;
          bottom: 12px;
        }

        .launcher {
          width: 52px;
          height: 52px;
        }

        .panel {
          width: calc(100vw - 24px);
          height: min(72vh, 560px);
        }
      }
    </style>

    <div class="shell">
      <button id="speakeasy-launcher" class="launcher" type="button" aria-label="Toggle Speakeasy chat">
        <span class="launcher-label">AI</span>
      </button>

      <section id="speakeasy-panel" class="panel" hidden>
        <header class="top">
          <div>
            <h2 class="brand-title">Speakeasy</h2>
            <p class="brand-subtitle">Gemini chat overlay</p>
          </div>
          <div class="controls">
            <button id="speakeasy-settings" class="control-btn" type="button">Settings</button>
            <button id="speakeasy-new-chat" class="control-btn" type="button">New</button>
            <button id="speakeasy-close" class="control-btn" type="button" aria-label="Close">Close</button>
          </div>
        </header>

        <ol id="speakeasy-messages" class="messages"></ol>

        <form id="speakeasy-form" class="composer" autocomplete="off">
          <input id="speakeasy-input" class="input" type="text" placeholder="Ask anything..." required />
          <button class="send" type="submit">Send</button>
        </form>
      </section>
    </div>
  `;
}
