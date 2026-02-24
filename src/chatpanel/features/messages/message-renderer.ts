import type { ChatMessage } from '../../../shared/chat';
import { toErrorMessage as toSharedErrorMessage } from '../../../shared/error-message';
import { isImageMimeType } from '../../core/media-helpers';
import { formatMessageTimestamp } from '../../core/time-format';
import { createFilePreviewItem } from '../attachments/file-preview-item';
import { renderMarkdownToSafeHtml } from './markdown';
import { createMessageActionButton, createMessageActionIcon } from './message-action-primitives';

export interface MessageRenderOptions {
  onAssistantAction?: (action: 'regen', message: ChatMessage) => void;
  onAssistantBranchSelect?: (message: ChatMessage, interactionId: string) => void;
  onUserAction?: (action: 'fork', message: ChatMessage) => void;
}

const COPY_FEEDBACK_RESET_MS = 1200;
const messageBlobPreviewUrls = new WeakMap<HTMLLIElement, Set<string>>();

export function renderAll(
  messages: ChatMessage[],
  messageList: HTMLOListElement,
  options: MessageRenderOptions = {},
): void {
  const retainedBlobPreviewUrls = collectBlobPreviewUrls(messages);
  revokeAllBlobPreviewUrls(messageList, retainedBlobPreviewUrls);
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

  const retainedBlobPreviewUrls = collectBlobPreviewUrlsForMessage(message);
  revokeMessageBlobPreviewUrls(existing, retainedBlobPreviewUrls);
  existing.replaceWith(createMessageNode(message, messageList, options));
  scrollMessageListToBottom(messageList);
  return true;
}

export function removeMessageById(messageId: string, messageList: HTMLOListElement): boolean {
  const existing = findMessageNodeById(messageList, messageId);
  if (!existing) {
    return false;
  }

  revokeMessageBlobPreviewUrls(existing);
  existing.remove();
  return true;
}

export function toErrorMessage(error: unknown): string {
  return toSharedErrorMessage(error, { fallback: 'Request failed. Please try again.' });
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
  const userAttachmentStrip =
    message.role === 'user' && attachments.length > 0
      ? createUserAttachmentStripNode(attachments, item)
      : undefined;
  const assistantAttachmentList =
    message.role !== 'user' && attachments.length > 0
      ? createAttachmentListNode(attachments, item)
      : undefined;

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
  } else if (message.role === 'assistant' && !thinkingSummary && !assistantAttachmentList) {
    bubble.append(createThinkingPlaceholderNode());
  }

  if (assistantAttachmentList) {
    bubble.append(assistantAttachmentList);
  }

  const shouldRenderBubble =
    message.role === 'assistant' ||
    hasRenderableContent ||
    !!thinkingSummary ||
    !!assistantAttachmentList;

  const assistantActions = createAssistantActionBar(message, stats, messageList, options);
  const userActions = createUserActionBar(message, options);
  if (assistantActions || userActions) {
    item.classList.add('row-with-actions');
  }
  if (userAttachmentStrip) {
    item.append(userAttachmentStrip);
  }
  if (shouldRenderBubble) {
    item.append(bubble);
  }
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

function createAttachmentListNode(
  attachments: NonNullable<ChatMessage['attachments']>,
  item: HTMLLIElement,
): HTMLDivElement {
  const attachmentList = document.createElement('div');
  attachmentList.className = 'attachment-list';

  for (const attachment of attachments) {
    if (attachment.previewUrl && isImageMimeType(attachment.mimeType)) {
      const previewUrl = attachment.previewUrl;
      const image = document.createElement('img');
      image.className = 'attachment-image previewable-image';
      image.dataset.speakeasyPreviewImage = 'true';
      image.src = previewUrl;
      image.alt = attachment.name;
      image.loading = 'lazy';
      if (previewUrl.startsWith('blob:')) {
        trackBlobPreviewUrl(item, previewUrl);
      }
      attachmentList.append(image);
      continue;
    }

    const chip = document.createElement('span');
    chip.className = 'attachment-placeholder';
    chip.textContent = `${attachment.name} (${attachment.mimeType})`;
    attachmentList.append(chip);
  }

  return attachmentList;
}

function createUserAttachmentStripNode(
  attachments: NonNullable<ChatMessage['attachments']>,
  item: HTMLLIElement,
): HTMLDivElement {
  const strip = document.createElement('div');
  strip.className = 'file-preview-strip message-attachment-strip';

  for (const attachment of attachments) {
    const previewItem = createFilePreviewItem({
      attachment,
      onBlobPreviewUrl: (previewUrl) => {
        trackBlobPreviewUrl(item, previewUrl);
      },
    });
    strip.append(previewItem);
  }

  return strip;
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
    const parentRow = disclosure.closest<HTMLLIElement>('li.row');
    parentRow?.classList.toggle('row-stats-open', disclosure.open);

    const actionBar = disclosure.closest<HTMLDivElement>('.message-actions');
    actionBar?.classList.toggle('is-stats-open', disclosure.open);

    if (disclosure.open) {
      if (parentRow && parentRow === messageList.lastElementChild) {
        scrollMessageListToBottom(messageList);
      }
    }
  });

  const summary = document.createElement('summary');
  summary.className = 'message-stats-trigger';
  summary.setAttribute('aria-label', 'Response statistics');
  summary.setAttribute('title', 'Response statistics');
  summary.append(createMessageActionIcon('stats'));

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
  const branchOptions = message.branchOptionInteractionIds ?? [];
  const hasBranchSwitchAction = branchOptions.length > 1 && !!options.onAssistantBranchSelect;
  const copyText = buildCopyableAssistantResponse(message);
  const hasCopyableText = copyText.length > 0;
  if (
    !stats &&
    !hasCopyableText &&
    !hasRegenerateAction &&
    !hasBranchSwitchAction &&
    !message.timestamp
  ) {
    return null;
  }

  const actionBar = document.createElement('div');
  actionBar.className = 'message-actions message-actions-assistant';

  if (hasCopyableText) {
    actionBar.append(createCopyActionButton(copyText, 'Copy response'));
  }

  if (hasRegenerateAction) {
    actionBar.append(
      createMessageActionButton({
        className: 'message-regen-btn',
        title: 'Regenerate response',
        icon: createMessageActionIcon('refresh'),
        onClick: () => options.onAssistantAction?.('regen', message),
      }),
    );
  }

  if (stats) {
    actionBar.append(createStatsDisclosure(stats, messageList));
  }

  if (hasBranchSwitchAction) {
    actionBar.append(createBranchSwitchControl(message, options));
  }

  if (message.timestamp) {
    const time = document.createElement('time');
    time.className = 'message-timestamp';
    time.textContent = formatMessageTimestamp(message.timestamp);
    actionBar.append(time);
  }

  return actionBar.childElementCount > 0 ? actionBar : null;
}

function createBranchSwitchControl(
  message: ChatMessage,
  options: MessageRenderOptions,
): HTMLDivElement {
  const control = document.createElement('div');
  control.className = 'message-branch-switch';
  const interactionIds = (message.branchOptionInteractionIds ?? []).map((id) => id.trim());
  const validInteractionIds = interactionIds.filter((id) => id.length > 0);
  const total = validInteractionIds.length;
  if (total === 0) {
    return control;
  }

  const rawSelectedIndex = (message.branchOptionIndex ?? 1) - 1;
  const selectedIndex = Math.max(0, Math.min(total - 1, rawSelectedIndex));
  const selectedPosition = selectedIndex + 1;
  const previousInteractionId =
    selectedIndex > 0 ? (validInteractionIds[selectedIndex - 1] ?? null) : null;
  const nextInteractionId =
    selectedIndex < total - 1 ? (validInteractionIds[selectedIndex + 1] ?? null) : null;

  control.append(
    createBranchNavigationButton(
      'message-branch-prev',
      '<',
      selectedIndex > 0
        ? `Switch to branch ${selectedPosition - 1} of ${total}`
        : 'Previous branch unavailable',
      message,
      previousInteractionId,
      options,
    ),
  );

  const indicator = document.createElement('span');
  indicator.className = 'message-branch-indicator';
  indicator.textContent = `${selectedPosition}/${total}`;
  control.append(indicator);

  control.append(
    createBranchNavigationButton(
      'message-branch-next',
      '>',
      selectedIndex < total - 1
        ? `Switch to branch ${selectedPosition + 1} of ${total}`
        : 'Next branch unavailable',
      message,
      nextInteractionId,
      options,
    ),
  );

  return control;
}

function createBranchNavigationButton(
  className: string,
  label: string,
  ariaLabel: string,
  message: ChatMessage,
  interactionId: string | null,
  options: MessageRenderOptions,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `message-branch-nav ${className}`;
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.disabled = !interactionId;
  if (interactionId) {
    button.addEventListener('click', () => {
      options.onAssistantBranchSelect?.(message, interactionId);
    });
  }
  return button;
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
  const branchOptions = message.branchOptionInteractionIds ?? [];
  const hasBranchSwitchAction = branchOptions.length > 1 && !!options.onAssistantBranchSelect;
  if (!hasCopyableText && !hasForkAction && !hasBranchSwitchAction) {
    return null;
  }

  const actionBar = document.createElement('div');
  actionBar.className = 'message-actions message-actions-user';

  if (hasCopyableText) {
    actionBar.append(createCopyActionButton(copyText, 'Copy query'));
  }

  if (hasForkAction) {
    actionBar.append(
      createMessageActionButton({
        className: 'message-fork-btn',
        title: 'Edit and retry in branch',
        icon: createMessageActionIcon('fork'),
        onClick: () => options.onUserAction?.('fork', message),
      }),
    );
  }

  if (hasBranchSwitchAction) {
    actionBar.append(createBranchSwitchControl(message, options));
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

  return message.content.trim();
}

function createCopyActionButton(copyText: string, copyLabel: string): HTMLButtonElement {
  const button = createMessageActionButton({
    className: 'message-copy-btn',
    title: copyLabel,
    icon: createMessageActionIcon('copy'),
  });

  button.addEventListener('click', () => {
    navigator.clipboard.writeText(copyText).then(
      () => {
        applyCopyButtonFeedback(button, copyLabel, {
          title: 'Copied',
          ariaLabel: 'Copied',
          activeClass: 'is-copied',
        });
      },
      () => {
        applyCopyButtonFeedback(button, copyLabel, {
          title: 'Copy failed',
          ariaLabel: 'Copy failed',
          activeClass: 'is-copy-failed',
        });
      },
    );
  });

  return button;
}

function formatTokenCount(value: number | undefined): string {
  return typeof value === 'number' ? String(Math.round(value)) : 'n/a';
}

function formatTokensPerSecond(value: number | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(2)} tok/s` : 'n/a';
}

function scrollMessageListToBottom(messageList: HTMLOListElement): void {
  messageList.scrollTop = messageList.scrollHeight;
}

function bindCodeCopyButtons(container: ParentNode): void {
  for (const label of Array.from(container.querySelectorAll('.code-lang'))) {
    const pre = label.closest('pre');
    if (!pre) {
      continue;
    }

    label.addEventListener('click', () => {
      const code = pre.querySelector('code');
      if (!code) {
        return;
      }

      const original = label.textContent;
      navigator.clipboard.writeText(code.textContent ?? '').then(
        () => {
          applyCodeCopyFeedback(label, original, 'copied');
        },
        () => {
          applyCodeCopyFeedback(label, original, 'copy failed');
        },
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
  const rows = messageList.querySelectorAll<HTMLLIElement>('li[data-message-id]');
  for (const row of Array.from(rows)) {
    if (row.dataset.messageId === messageId) {
      return row;
    }
  }

  return null;
}

function trackBlobPreviewUrl(messageNode: HTMLLIElement, previewUrl: string): () => void {
  const trackedUrls = messageBlobPreviewUrls.get(messageNode) ?? new Set<string>();
  trackedUrls.add(previewUrl);
  messageBlobPreviewUrls.set(messageNode, trackedUrls);

  return () => {
    const currentUrls = messageBlobPreviewUrls.get(messageNode);
    if (!currentUrls || !currentUrls.delete(previewUrl)) {
      return;
    }

    URL.revokeObjectURL(previewUrl);
    if (currentUrls.size === 0) {
      messageBlobPreviewUrls.delete(messageNode);
    }
  };
}

function revokeMessageBlobPreviewUrls(
  messageNode: HTMLLIElement,
  retainedPreviewUrls: ReadonlySet<string> = new Set(),
): void {
  const trackedUrls = messageBlobPreviewUrls.get(messageNode);
  if (!trackedUrls) {
    return;
  }

  for (const previewUrl of trackedUrls) {
    if (retainedPreviewUrls.has(previewUrl)) {
      continue;
    }

    URL.revokeObjectURL(previewUrl);
  }
  trackedUrls.clear();
  messageBlobPreviewUrls.delete(messageNode);
}

function revokeAllBlobPreviewUrls(
  messageList: HTMLOListElement,
  retainedPreviewUrls: ReadonlySet<string> = new Set(),
): void {
  for (const row of Array.from(
    messageList.querySelectorAll<HTMLLIElement>('li[data-message-id]'),
  )) {
    revokeMessageBlobPreviewUrls(row, retainedPreviewUrls);
  }
}

function collectBlobPreviewUrls(messages: readonly ChatMessage[]): Set<string> {
  const retained = new Set<string>();
  for (const message of messages) {
    collectBlobPreviewUrlsForMessage(message, retained);
  }
  return retained;
}

function collectBlobPreviewUrlsForMessage(
  message: ChatMessage,
  retained: Set<string> = new Set(),
): Set<string> {
  for (const attachment of message.attachments ?? []) {
    const previewUrl = attachment.previewUrl?.trim() ?? '';
    if (!previewUrl.startsWith('blob:')) {
      continue;
    }

    retained.add(previewUrl);
  }

  return retained;
}

function applyCopyButtonFeedback(
  button: HTMLButtonElement,
  defaultLabel: string,
  feedback: {
    title: string;
    ariaLabel: string;
    activeClass: 'is-copied' | 'is-copy-failed';
  },
): void {
  const inactiveClass = feedback.activeClass === 'is-copied' ? 'is-copy-failed' : 'is-copied';
  button.setAttribute('title', feedback.title);
  button.setAttribute('aria-label', feedback.ariaLabel);
  button.classList.remove(inactiveClass);
  button.classList.add(feedback.activeClass);
  setTimeout(() => {
    button.setAttribute('title', defaultLabel);
    button.setAttribute('aria-label', defaultLabel);
    button.classList.remove(feedback.activeClass);
  }, COPY_FEEDBACK_RESET_MS);
}

function applyCodeCopyFeedback(
  label: Element,
  originalText: string | null,
  statusText: 'copied' | 'copy failed',
): void {
  label.textContent = statusText;
  setTimeout(() => {
    label.textContent = originalText;
  }, COPY_FEEDBACK_RESET_MS);
}
