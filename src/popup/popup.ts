import { type ChatMessage, sendMessage } from '../shared/chat';

const messageList = queryRequiredElement<HTMLOListElement>('#message-list');
const form = queryRequiredElement<HTMLFormElement>('#chat-form');
const input = queryRequiredElement<HTMLInputElement>('#chat-input');

const initialMessages: ChatMessage[] = [
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: 'Welcome to Speakeasy. This is a scaffold; wire your model in sendMessage().',
  },
];

renderAll(initialMessages);

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

  try {
    const assistantMessage = await sendMessage(userText);
    appendMessage(assistantMessage);
  } catch (error) {
    const fallbackText =
      error instanceof Error ? error.message : 'Unable to send message. Please try again.';

    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: fallbackText,
    });
  } finally {
    input.disabled = false;
    input.focus();
    form.removeAttribute('aria-busy');
  }
});

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
