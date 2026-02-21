import type { ChatMessage } from '../shared/chat';
import { renderMarkdownToSafeHtml } from './markdown';

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
  const bubble = document.createElement('div');

  item.className = message.role === 'user' ? 'row row-user' : 'row row-assistant';

  bubble.className = message.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-assistant';
  if (message.content) {
    const text = document.createElement('div');
    text.className = 'message-text';
    text.innerHTML = renderMarkdownToSafeHtml(message.content, text.ownerDocument);
    enforceLinkBehavior(text);
    bindCodeCopyButtons(text);
    bubble.append(text);
  }

  if (message.attachments && message.attachments.length > 0) {
    const attachmentList = document.createElement('div');
    attachmentList.className = 'attachment-list';

    for (const attachment of message.attachments) {
      if (attachment.previewUrl && isImageMimeType(attachment.mimeType)) {
        const previewUrl = attachment.previewUrl;
        const image = document.createElement('img');
        image.className = 'attachment-image';
        image.src = previewUrl;
        image.alt = attachment.name;
        image.loading = 'lazy';
        if (previewUrl.startsWith('blob:')) {
          const releaseObjectUrl = () => {
            URL.revokeObjectURL(previewUrl);
          };
          image.addEventListener('load', releaseObjectUrl, { once: true });
          image.addEventListener('error', releaseObjectUrl, { once: true });
        }
        attachmentList.append(image);
        continue;
      }

      const chip = document.createElement('span');
      chip.className = 'attachment-placeholder';
      chip.textContent = `${attachment.name} (${attachment.mimeType})`;
      attachmentList.append(chip);
    }

    bubble.append(attachmentList);
  }

  item.append(bubble);
  return item;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function bindCodeCopyButtons(container: ParentNode): void {
  for (const label of Array.from(container.querySelectorAll('.code-lang'))) {
    const pre = label.closest('pre');
    if (!pre) continue;

    label.addEventListener('click', () => {
      const code = pre.querySelector('code');
      if (!code) return;

      const original = label.textContent;
      navigator.clipboard.writeText(code.textContent ?? '').then(
        () => {
          label.textContent = 'copied';
          setTimeout(() => {
            label.textContent = original;
          }, 1200);
        },
        () => {},
      );
    });
  }
}

function enforceLinkBehavior(container: ParentNode): void {
  const links = container.querySelectorAll('a');
  for (const link of Array.from(links)) {
    const href = link.getAttribute('href');
    if (!href || !isSafeLinkHref(href)) {
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
      continue;
    }

    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const SCHEME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function isSafeLinkHref(href: string): boolean {
  if (!SCHEME_PREFIX_PATTERN.test(href)) {
    return false;
  }

  try {
    const parsed = new URL(href, 'https://speakeasy.invalid');
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}
