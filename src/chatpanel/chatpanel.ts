import { type ChatMessage, createNewChat, loadChatMessages, sendMessage } from '../shared/chat';
import { isRecord, queryRequiredElement } from './dom';
import { appendMessage, createWelcomeMessage, renderAll, toErrorMessage } from './messages';
import { requestOpenSettings } from './runtime';
import { getChatPanelTemplate } from './template';

const ROOT_HOST_ID = 'speakeasy-overlay-root';

if (window.top === window) {
  mountChatPanel();
}

function mountChatPanel(): void {
  if (document.getElementById(ROOT_HOST_ID)) {
    return;
  }

  const host = document.createElement('div');
  host.id = ROOT_HOST_ID;
  document.documentElement.append(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = getChatPanelTemplate();

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

    if (!hasLoadedHistory) {
      await loadConversationHistory();
    }

    input.focus();
  }

  function closePanel(): void {
    isPanelOpen = false;
    panel.hidden = true;
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

async function openSettings(messageList: HTMLOListElement): Promise<void> {
  const error = await requestOpenSettings();
  if (!error) {
    return;
  }

  appendMessage(
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: error,
    },
    messageList,
  );
}
