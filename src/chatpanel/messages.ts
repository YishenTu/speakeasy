import type { ChatMessage } from '../shared/chat';
import { renderMarkdownToSafeHtml } from './markdown';

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

export function replaceMessageById(
  messageId: string,
  message: ChatMessage,
  messageList: HTMLOListElement,
): boolean {
  const existing = findMessageNodeById(messageList, messageId);
  if (!existing) {
    return false;
  }

  existing.replaceWith(createMessageNode(message));
  messageList.scrollTop = messageList.scrollHeight;
  return true;
}

export function removeMessageById(messageId: string, messageList: HTMLOListElement): boolean {
  const existing = findMessageNodeById(messageList, messageId);
  if (!existing) {
    return false;
  }

  existing.remove();
  return true;
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
  item.dataset.messageId = message.id;

  bubble.className = message.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-assistant';
  const thinkingSummary = message.role === 'assistant' ? message.thinkingSummary?.trim() : '';
  const attachments = message.attachments ?? [];
  const hasRenderableContent = message.content.trim().length > 0;
  if (thinkingSummary) {
    const disclosure = document.createElement('details');
    disclosure.className = 'thinking-disclosure';
    disclosure.open = true;

    const summary = document.createElement('summary');
    summary.className = 'thinking-disclosure-label';
    summary.textContent = 'Thinking process';

    const content = createThinkingSummaryNode(thinkingSummary);

    disclosure.append(summary, content);
    bubble.append(disclosure);
  }

  if (hasRenderableContent) {
    bubble.append(createMarkdownNode(message.content, 'message-text'));
  } else if (message.role === 'assistant' && !thinkingSummary && attachments.length === 0) {
    bubble.append(createThinkingPlaceholderNode());
  }

  if (attachments.length > 0) {
    const attachmentList = document.createElement('div');
    attachmentList.className = 'attachment-list';

    for (const attachment of attachments) {
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

function createThinkingPlaceholderNode(): HTMLDivElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'message-text message-thinking-placeholder';

  const label = document.createElement('span');
  label.className = 'thinking-placeholder-label';
  label.textContent = 'Thinking';

  const dots = document.createElement('span');
  dots.className = 'thinking-placeholder-dots';
  dots.setAttribute('aria-hidden', 'true');

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'thinking-placeholder-dot';
    dot.textContent = '.';
    dots.append(dot);
  }

  placeholder.append(label, dots);
  return placeholder;
}

function createMarkdownNode(markdown: string, className: string): HTMLDivElement {
  const container = document.createElement('div');
  container.className = className;
  container.innerHTML = renderMarkdownToSafeHtml(markdown, container.ownerDocument);
  enforceLinkBehavior(container);
  bindCodeCopyButtons(container);
  return container;
}

function createThinkingSummaryNode(thinkingSummary: string): HTMLDivElement {
  const container = createMarkdownNode(thinkingSummary, 'thinking-summary message-text');
  if (!container.hasChildNodes()) {
    const fallback = document.createElement('p');
    fallback.textContent = thinkingSummary;
    container.append(fallback);
  }
  return container;
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

function isSafeLinkHref(href: string): boolean {
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) {
    return false;
  }

  try {
    const parsed = new URL(href, 'https://speakeasy.invalid');
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function findMessageNodeById(
  messageList: HTMLOListElement,
  messageId: string,
): HTMLLIElement | null {
  return messageList.querySelector<HTMLLIElement>(`li[data-message-id="${messageId}"]`);
}
