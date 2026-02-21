import { type ChatMessage, createNewChat, loadChatMessages, sendMessage } from '../shared/chat';

const messageList = queryRequiredElement<HTMLOListElement>('#message-list');
const form = queryRequiredElement<HTMLFormElement>('#chat-form');
const input = queryRequiredElement<HTMLInputElement>('#chat-input');
const newChatButton = queryRequiredElement<HTMLButtonElement>('#new-chat');

void initializePopup();

newChatButton.addEventListener('click', async () => {
  const previousDisabledState = input.disabled;
  input.disabled = true;
  newChatButton.disabled = true;
  form.setAttribute('aria-busy', 'true');

  try {
    await createNewChat();
    renderAll([createWelcomeMessage()]);
  } catch (error) {
    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: toErrorMessage(error),
    });
  } finally {
    input.disabled = previousDisabledState;
    newChatButton.disabled = false;
    form.removeAttribute('aria-busy');
    input.focus();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const userText = input.value.trim();
  if (!userText) {
    return;
  }

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: userText,
  };

  appendMessage(userMessage);
  form.setAttribute('aria-busy', 'true');
  input.value = '';
  input.disabled = true;
  newChatButton.disabled = true;

  try {
    const assistantMessage = await sendMessage(userText);
    appendMessage(assistantMessage);
  } catch (error) {
    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: toErrorMessage(error),
    });
  } finally {
    input.disabled = false;
    newChatButton.disabled = false;
    input.focus();
    form.removeAttribute('aria-busy');
  }
});

async function initializePopup(): Promise<void> {
  try {
    const history = await loadChatMessages();
    if (history.messages.length > 0) {
      renderAll(history.messages);
      return;
    }
  } catch (error) {
    renderAll([
      createWelcomeMessage(),
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: toErrorMessage(error),
      },
    ]);
    return;
  }

  renderAll([createWelcomeMessage()]);
}

function renderAll(messages: ChatMessage[]): void {
  const fragment = document.createDocumentFragment();

  for (const message of messages) {
    fragment.append(createMessageNode(message));
  }

  messageList.replaceChildren(fragment);
  messageList.scrollTop = messageList.scrollHeight;
}

function appendMessage(message: ChatMessage): void {
  messageList.append(createMessageNode(message));
  messageList.scrollTop = messageList.scrollHeight;
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: 'Welcome to Speakeasy. Configure your Gemini API key in Settings to start chatting.',
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to send message. Please try again.';
}

function createMessageNode(message: ChatMessage): HTMLLIElement {
  const item = document.createElement('li');
  const bubble = document.createElement('p');

  item.className = `flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`;
  bubble.className =
    message.role === 'user'
      ? 'max-w-[85%] rounded-lg bg-accent-500 px-3 py-2 text-sm text-slate-950'
      : 'max-w-[85%] rounded-lg bg-surface-800 px-3 py-2 text-sm text-slate-100';
  bubble.textContent = message.content;

  item.append(bubble);
  return item;
}

function queryRequiredElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Popup DOM is missing required node: ${selector}`);
  }

  return element;
}
