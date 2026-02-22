import type { ChatMessage } from '../shared/chat';
import { renderMarkdownToSafeHtml } from './markdown';

export interface MessageRenderOptions {
  onAssistantAction?: (action: 'regen', message: ChatMessage) => void;
  onUserAction?: (action: 'fork', message: ChatMessage) => void;
}

export function renderAll(
  messages: ChatMessage[],
  messageList: HTMLOListElement,
  options: MessageRenderOptions = {},
): void {
  const fragment = document.createDocumentFragment();
  for (const message of messages) {
    fragment.append(createMessageNode(message, messageList, options));
  }

  messageList.replaceChildren(fragment);
  scrollMessageListToBottom(messageList);
}

export function appendMessage(
  message: ChatMessage,
  messageList: HTMLOListElement,
  options: MessageRenderOptions = {},
): void {
  messageList.append(createMessageNode(message, messageList, options));
  scrollMessageListToBottom(messageList);
}

export function replaceMessageById(
  messageId: string,
  message: ChatMessage,
  messageList: HTMLOListElement,
  options: MessageRenderOptions = {},
): boolean {
  const existing = findMessageNodeById(messageList, messageId);
  if (!existing) {
    return false;
  }

  existing.replaceWith(createMessageNode(message, messageList, options));
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

function createMessageNode(
  message: ChatMessage,
  messageList: HTMLOListElement,
  options: MessageRenderOptions,
): HTMLLIElement {
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

  const assistantActions = createAssistantActionBar(message, stats, messageList, options);
  const userActions = createUserActionBar(message, options);
  if (assistantActions || userActions) {
    item.classList.add('row-with-actions');
  }
  item.append(bubble);
  if (assistantActions) {
    item.append(assistantActions);
  }
  if (userActions) {
    item.append(userActions);
  }
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
  options: MessageRenderOptions,
): HTMLDivElement | null {
  if (message.role !== 'assistant') {
    return null;
  }

  const hasRegenerateAction = !!message.interactionId?.trim() && !!options.onAssistantAction;
  const copyText = buildCopyableAssistantResponse(message);
  const hasCopyableText = copyText.length > 0;
  if (!stats && !hasCopyableText && !hasRegenerateAction && !message.timestamp) {
    return null;
  }

  const actionBar = document.createElement('div');
  actionBar.className = 'message-actions message-actions-assistant';

  if (hasCopyableText) {
    actionBar.append(createCopyActionButton(copyText, 'Copy response'));
  }

  if (hasRegenerateAction) {
    actionBar.append(
      createAssistantActionButton(
        'message-regen-btn',
        'Regenerate response',
        createRefreshIconNode(),
        () => options.onAssistantAction?.('regen', message),
      ),
    );
  }

  if (stats) {
    actionBar.append(createStatsDisclosure(stats, messageList));
  }

  if (message.timestamp) {
    const time = document.createElement('time');
    time.className = 'message-timestamp';
    time.textContent = formatMessageTime(message.timestamp);
    actionBar.append(time);
  }

  return actionBar.childElementCount > 0 ? actionBar : null;
}

function createUserActionBar(
  message: ChatMessage,
  options: MessageRenderOptions,
): HTMLDivElement | null {
  if (message.role !== 'user') {
    return null;
  }

  const copyText = buildCopyableUserQuery(message);
  const hasCopyableText = copyText.length > 0;
  const hasForkAction = !!message.previousInteractionId?.trim() && !!options.onUserAction;
  if (!hasCopyableText && !hasForkAction) {
    return null;
  }

  const actionBar = document.createElement('div');
  actionBar.className = 'message-actions message-actions-user';

  if (hasCopyableText) {
    actionBar.append(createCopyActionButton(copyText, 'Copy query'));
  }

  if (hasForkAction) {
    actionBar.append(
      createAssistantActionButton(
        'message-fork-btn',
        'Edit and retry in branch',
        createForkIconNode(),
        () => options.onUserAction?.('fork', message),
      ),
    );
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

function buildCopyableUserQuery(message: ChatMessage): string {
  if (message.role !== 'user') {
    return '';
  }

  const blocks: string[] = [];
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

function createCopyActionButton(copyText: string, copyLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'message-action-btn message-copy-btn';
  button.type = 'button';
  button.setAttribute('aria-label', copyLabel);
  button.setAttribute('title', copyLabel);
  button.append(createCopyIconNode());

  button.addEventListener('click', () => {
    navigator.clipboard.writeText(copyText).then(
      () => {
        button.setAttribute('title', 'Copied');
        button.setAttribute('aria-label', 'Copied');
        button.classList.add('is-copied');
        setTimeout(() => {
          button.setAttribute('title', copyLabel);
          button.setAttribute('aria-label', copyLabel);
          button.classList.remove('is-copied');
        }, 1200);
      },
      () => {},
    );
  });

  return button;
}

function createAssistantActionButton(
  className: string,
  title: string,
  icon: SVGSVGElement,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `message-action-btn ${className}`;
  button.type = 'button';
  button.setAttribute('title', title);
  button.setAttribute('aria-label', title);
  button.append(icon);
  button.addEventListener('click', onClick);
  return button;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function createActionSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('message-action-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  return svg;
}

function svgPath(d: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  return path;
}

function svgRect(x: number, y: number, w: number, h: number, rx: number): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('rx', String(rx));
  return rect;
}

function svgCircle(cx: number, cy: number, r: number): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(r));
  return circle;
}

function createStatsGaugeIconNode(): SVGSVGElement {
  const icon = createActionSvg();
  icon.append(svgPath('M18 20V10'), svgPath('M12 20V4'), svgPath('M6 20V14'));
  return icon;
}

function createCopyIconNode(): SVGSVGElement {
  const icon = createActionSvg();
  icon.append(
    svgRect(9, 9, 13, 13, 2),
    svgPath('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'),
  );
  return icon;
}

function createRefreshIconNode(): SVGSVGElement {
  const icon = createActionSvg();
  icon.append(svgPath('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), svgPath('M3 3v5h5'));
  return icon;
}

function createForkIconNode(): SVGSVGElement {
  const icon = createActionSvg();
  icon.append(
    svgCircle(12, 18, 3),
    svgCircle(6, 6, 3),
    svgCircle(18, 6, 3),
    svgPath('M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9'),
    svgPath('M12 12v3'),
  );
  return icon;
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
