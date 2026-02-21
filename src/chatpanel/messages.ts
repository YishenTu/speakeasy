import type { ChatMessage } from '../shared/chat';

export function createWelcomeMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      'Speakeasy is ready. Ask a question, or open Settings to configure your Gemini API key.',
  };
}

export function renderAll(messages: ChatMessage[], messageList: HTMLOListElement): void {
  const fragment = document.createDocumentFragment();
  for (const message of messages) {
    fragment.append(createMessageNode(message));
  }

  messageList.replaceChildren(fragment);
  messageList.scrollTop = messageList.scrollHeight;
}

export function appendMessage(message: ChatMessage, messageList: HTMLOListElement): void {
  messageList.append(createMessageNode(message));
  messageList.scrollTop = messageList.scrollHeight;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Request failed. Please try again.';
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
