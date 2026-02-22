import type { ChatMessage } from '../shared/chat';
import { renderMarkdownToSafeHtml } from './markdown';

export function renderAll(messages: ChatMessage[], messageList: HTMLOListElement): void {
  const fragment = document.createDocumentFragment();
  for (const message of messages) {
    fragment.append(createMessageNode(message, messageList));
  }

  messageList.replaceChildren(fragment);
  scrollMessageListToBottom(messageList);
}

export function appendMessage(message: ChatMessage, messageList: HTMLOListElement): void {
  messageList.append(createMessageNode(message, messageList));
  scrollMessageListToBottom(messageList);
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

  existing.replaceWith(createMessageNode(message, messageList));
  scrollMessageListToBottom(messageList);
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

function createMessageNode(message: ChatMessage, messageList: HTMLOListElement): HTMLLIElement {
  const item = document.createElement('li');
  const bubble = document.createElement('div');

  item.className = message.role === 'user' ? 'row row-user' : 'row row-assistant';
  item.dataset.messageId = message.id;

  bubble.className = message.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-assistant';
  const thinkingSummary = message.role === 'assistant' ? message.thinkingSummary?.trim() : '';
  const stats = message.role === 'assistant' ? message.stats : undefined;
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

  const assistantActions = createAssistantActionBar(message, stats, messageList);
  if (assistantActions) {
    bubble.append(assistantActions);
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

function createStatsDisclosure(
  stats: NonNullable<ChatMessage['stats']>,
  messageList: HTMLOListElement,
): HTMLElement {
  const disclosure = document.createElement('details');
  disclosure.className = 'message-stats';
  disclosure.addEventListener('toggle', () => {
    if (disclosure.open) {
      scrollMessageListToBottom(messageList);
    }
  });

  const summary = document.createElement('summary');
  summary.className = 'message-stats-trigger';
  summary.setAttribute('aria-label', 'Response statistics');
  summary.setAttribute('title', 'Response statistics');
  summary.append(createStatsGaugeIconNode());

  const panel = document.createElement('div');
  panel.className = 'message-stats-panel';

  const rows: Array<[string, string]> = [
    ['TTFT', `${Math.round(stats.timeToFirstTokenMs)} ms`],
    ['Duration', `${Math.round(stats.requestDurationMs)} ms`],
    ['Output TPS', formatTokensPerSecond(stats.outputTokensPerSecond)],
    ['Total TPS', formatTokensPerSecond(stats.totalTokensPerSecond)],
    ['Output Tokens', formatTokenCount(stats.outputTokens)],
    ['Input Tokens', formatTokenCount(stats.inputTokens)],
    ['Thought Tokens', formatTokenCount(stats.thoughtTokens)],
    ['Tool Tokens', formatTokenCount(stats.toolUseTokens)],
    ['Cached Tokens', formatTokenCount(stats.cachedTokens)],
    ['Total Tokens', formatTokenCount(stats.totalTokens)],
    ['TTFT Source', stats.hasStreamingToken ? 'stream delta' : 'completion fallback'],
  ];

  for (const [labelText, valueText] of rows) {
    const row = document.createElement('div');
    row.className = 'message-stats-row';

    const label = document.createElement('span');
    label.className = 'message-stats-label';
    label.textContent = labelText;

    const value = document.createElement('span');
    value.className = 'message-stats-value';
    value.textContent = valueText;

    row.append(label, value);
    panel.append(row);
  }

  disclosure.append(summary, panel);
  return disclosure;
}

function createAssistantActionBar(
  message: ChatMessage,
  stats: NonNullable<ChatMessage['stats']> | undefined,
  messageList: HTMLOListElement,
): HTMLDivElement | null {
  if (message.role !== 'assistant') {
    return null;
  }

  const copyText = buildCopyableAssistantResponse(message);
  const hasCopyableText = copyText.length > 0;
  if (!stats && !hasCopyableText) {
    return null;
  }

  const actionBar = document.createElement('div');
  actionBar.className = 'message-actions';

  if (hasCopyableText) {
    actionBar.append(createCopyResponseButton(copyText));
  }

  if (stats) {
    actionBar.append(createStatsDisclosure(stats, messageList));
  }

  return actionBar.childElementCount > 0 ? actionBar : null;
}

function buildCopyableAssistantResponse(message: ChatMessage): string {
  if (message.role !== 'assistant') {
    return message.content.trim();
  }

  const blocks: string[] = [];
  const thinkingSummary = message.thinkingSummary?.trim();
  if (thinkingSummary) {
    blocks.push(`Thinking process:\n${thinkingSummary}`);
  }

  const content = message.content.trim();
  if (content) {
    blocks.push(content);
  }

  if (message.attachments && message.attachments.length > 0) {
    const attachmentLines = message.attachments.map(
      (attachment) => `- ${attachment.name} (${attachment.mimeType})`,
    );
    blocks.push(`Attachments:\n${attachmentLines.join('\n')}`);
  }

  return blocks.join('\n\n').trim();
}

function createCopyResponseButton(copyText: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'message-action-btn message-copy-btn';
  button.type = 'button';
  button.setAttribute('aria-label', 'Copy response');
  button.setAttribute('title', 'Copy response');
  button.append(createCopyIconNode());

  button.addEventListener('click', () => {
    navigator.clipboard.writeText(copyText).then(
      () => {
        button.setAttribute('title', 'Copied');
        button.setAttribute('aria-label', 'Copied');
        button.classList.add('is-copied');
        setTimeout(() => {
          button.setAttribute('title', 'Copy response');
          button.setAttribute('aria-label', 'Copy response');
          button.classList.remove('is-copied');
        }, 1200);
      },
      () => {},
    );
  });

  return button;
}

function createStatsGaugeIconNode(): SVGSVGElement {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.classList.add('message-stats-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');

  const arc = document.createElementNS(svgNamespace, 'path');
  arc.setAttribute('d', 'M4 14a8 8 0 0 1 16 0');
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', 'currentColor');
  arc.setAttribute('stroke-width', '1.8');
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-linejoin', 'round');

  const needle = document.createElementNS(svgNamespace, 'path');
  needle.setAttribute('d', 'M12 14 16 10');
  needle.setAttribute('fill', 'none');
  needle.setAttribute('stroke', 'currentColor');
  needle.setAttribute('stroke-width', '1.8');
  needle.setAttribute('stroke-linecap', 'round');
  needle.setAttribute('stroke-linejoin', 'round');

  const pivot = document.createElementNS(svgNamespace, 'circle');
  pivot.setAttribute('cx', '12');
  pivot.setAttribute('cy', '14');
  pivot.setAttribute('r', '1.1');
  pivot.setAttribute('fill', 'currentColor');

  icon.append(arc, needle, pivot);
  return icon;
}

function createCopyIconNode(): SVGSVGElement {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.classList.add('message-copy-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');

  const back = document.createElementNS(svgNamespace, 'rect');
  back.setAttribute('x', '8');
  back.setAttribute('y', '8');
  back.setAttribute('width', '10');
  back.setAttribute('height', '10');
  back.setAttribute('rx', '1.8');
  back.setAttribute('fill', 'none');
  back.setAttribute('stroke', 'currentColor');
  back.setAttribute('stroke-width', '1.8');

  const front = document.createElementNS(svgNamespace, 'rect');
  front.setAttribute('x', '5');
  front.setAttribute('y', '5');
  front.setAttribute('width', '10');
  front.setAttribute('height', '10');
  front.setAttribute('rx', '1.8');
  front.setAttribute('fill', 'none');
  front.setAttribute('stroke', 'currentColor');
  front.setAttribute('stroke-width', '1.8');

  icon.append(back, front);
  return icon;
}

function formatTokenCount(value: number | undefined): string {
  return typeof value === 'number' ? String(Math.round(value)) : 'n/a';
}

function formatTokensPerSecond(value: number | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(2)} tok/s` : 'n/a';
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function scrollMessageListToBottom(messageList: HTMLOListElement): void {
  messageList.scrollTop = messageList.scrollHeight;
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
