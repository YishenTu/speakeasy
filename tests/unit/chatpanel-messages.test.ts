import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  appendMessage,
  removeMessageById,
  renderAll,
  replaceMessageById,
  toErrorMessage,
} from '../../src/chatpanel/messages';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

describe('chatpanel messages', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment(
      '<!doctype html><html><body><ol id="messages"></ol></body></html>',
    );
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
  });

  it('renders full message list and scrolls to the bottom', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    Object.defineProperty(messageList, 'scrollHeight', {
      configurable: true,
      value: 140,
    });

    renderAll(
      [
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'World' },
      ],
      messageList,
    );

    expect(messageList.children).toHaveLength(2);
    expect(messageList.textContent).toContain('Hello');
    expect(messageList.textContent).toContain('World');
    expect(messageList.scrollTop).toBe(140);
  });

  it('renders markdown content including formatting, tasks, and tables', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    renderAll(
      [
        {
          id: 'a-md',
          role: 'assistant',
          content: [
            '**Bold** and `inline code` with [link](https://example.com).',
            '',
            '- [x] done item',
            '',
            '| col-a | col-b |',
            '| --- | --- |',
            '| 1 | 2 |',
          ].join('\n'),
        },
      ],
      messageList,
    );

    const messageText = messageList.querySelector('.message-text');
    expect(messageText).not.toBeNull();
    expect(messageText?.querySelector('strong')?.textContent).toBe('Bold');
    expect(messageText?.querySelector('code')?.textContent).toBe('inline code');
    expect(messageText?.querySelector('table')).not.toBeNull();
    expect(messageText?.querySelector('input[type="checkbox"]')).not.toBeNull();

    const link = messageText?.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders tex expressions in message bubbles', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    renderAll(
      [
        {
          id: 'a-tex',
          role: 'assistant',
          content: 'Inline $x^2$ and block:\n\n$$\\frac{1}{2}$$',
        },
      ],
      messageList,
    );

    const messageText = messageList.querySelector('.message-text');
    expect(messageText).not.toBeNull();
    expect(messageText?.querySelector('math')).not.toBeNull();
    expect(messageText?.querySelector('math[display="block"]')).not.toBeNull();
  });

  it('sanitizes dangerous content before rendering markdown output', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    renderAll(
      [
        {
          id: 'a-xss',
          role: 'assistant',
          content: [
            '<script>alert(1)</script>',
            '[unsafe](javascript:alert(2))',
            '<img src=x onerror=alert(3)>',
          ].join('\n'),
        },
      ],
      messageList,
    );

    const messageText = messageList.querySelector('.message-text');
    expect(messageText).not.toBeNull();
    expect(messageText?.querySelector('script')).toBeNull();
    expect(messageText?.querySelector('img')).toBeNull();

    const unsafeLink = messageText?.querySelector('a');
    expect(unsafeLink).not.toBeNull();
    expect(unsafeLink?.hasAttribute('href')).toBe(false);
  });

  it('keeps raw html as text while still rendering markdown syntax', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    renderAll(
      [
        {
          id: 'a-html',
          role: 'assistant',
          content: '## Heading <b>raw html</b>',
        },
      ],
      messageList,
    );

    const messageText = messageList.querySelector('.message-text');
    expect(messageText).not.toBeNull();
    expect(messageText?.querySelector('h2')).not.toBeNull();
    expect(messageText?.querySelector('b')).toBeNull();
    expect(messageText?.textContent).toContain('<b>raw html</b>');
  });

  it('removes href from unsafe and relative links after markdown rendering', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    renderAll(
      [
        {
          id: 'a-links',
          role: 'assistant',
          content: [
            '[https](https://example.com)',
            '[http](http://example.com)',
            '[mailto](mailto:test@example.com)',
            '[javascript](javascript:alert(1))',
            '[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
            '[relative](/docs)',
          ].join(' '),
        },
      ],
      messageList,
    );

    const links = Array.from(messageList.querySelectorAll('.message-text a'));
    expect(links).toHaveLength(6);
    const linksByText = new Map(links.map((link) => [link.textContent ?? '', link]));

    expect(linksByText.get('https')?.getAttribute('href')).toBe('https://example.com');
    expect(linksByText.get('http')?.getAttribute('href')).toBe('http://example.com');
    expect(linksByText.get('mailto')?.getAttribute('href')).toBe('mailto:test@example.com');
    expect(linksByText.get('javascript')?.hasAttribute('href')).toBe(false);
    expect(linksByText.get('data')?.hasAttribute('href')).toBe(false);
    expect(linksByText.get('relative')?.hasAttribute('href')).toBe(false);
  });

  it('copies fenced code content when the language label is clicked', async () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    const clipboard = {
      writeText: (_value: string) => Promise.resolve(),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    const writeTextSpy = spyOn(clipboard, 'writeText').mockImplementation(() => Promise.resolve());

    renderAll(
      [
        {
          id: 'a-code',
          role: 'assistant',
          content: ['```ts', 'const value = 1;', 'console.log(value);', '```'].join('\n'),
        },
      ],
      messageList,
    );

    const label = messageList.querySelector('.message-text .code-lang');
    expect(label).not.toBeNull();

    label?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy).toHaveBeenCalledWith('const value = 1;\nconsole.log(value);');
    expect(label?.textContent).toBe('copied');
  });

  it('revokes blob preview URLs after image load', () => {
    const testWindow = dom?.window;
    if (!testWindow) {
      throw new Error('DOM test environment is not installed.');
    }

    const messageList = document.getElementById('messages') as HTMLOListElement;
    const revokeSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    appendMessage(
      {
        id: 'a2',
        role: 'assistant',
        content: 'Image ready',
        attachments: [
          {
            name: 'preview.png',
            mimeType: 'image/png',
            previewUrl: 'blob:preview-image',
          },
        ],
      },
      messageList,
    );

    const image = messageList.querySelector('img');
    expect(image).not.toBeNull();
    image?.dispatchEvent(new testWindow.Event('load'));
    expect(revokeSpy).toHaveBeenCalledWith('blob:preview-image');

    revokeSpy.mockRestore();
  });

  it('renders assistant thinking disclosure expanded by default', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-thinking',
        role: 'assistant',
        content: 'Answer text',
        thinkingSummary: 'Checked assumptions before answering.',
      },
      messageList,
    );

    const disclosure = messageList.querySelector('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(true);
    expect(disclosure?.querySelector('summary')?.textContent).toBe('Thinking process');
    expect(disclosure?.textContent).toContain('Checked assumptions before answering.');

    const bubble = messageList.querySelector('.bubble-assistant');
    const firstChild = bubble?.firstElementChild as HTMLElement | null;
    expect(firstChild?.className).toBe('thinking-disclosure');
  });

  it('renders markdown and tex in the assistant thinking disclosure', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-thinking-md',
        role: 'assistant',
        content: 'Final answer',
        thinkingSummary: [
          '**Evaluated options** with inline math $x^2$.',
          '',
          '[Reference](https://example.com)',
          '',
          '```ts',
          'const value = 7;',
          '```',
        ].join('\n'),
      },
      messageList,
    );

    const thinkingSummary = messageList.querySelector('.thinking-summary');
    expect(thinkingSummary).not.toBeNull();
    expect(thinkingSummary?.querySelector('strong')?.textContent).toBe('Evaluated options');
    expect(thinkingSummary?.querySelector('math')).not.toBeNull();
    expect(thinkingSummary?.querySelector('.code-lang')?.textContent).toBe('ts');

    const link = thinkingSummary?.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');

    expect(thinkingSummary?.querySelector('strong')).not.toBeNull();
  });

  it('replaces and removes messages by id for streaming placeholder updates', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    renderAll(
      [
        { id: 'user-1', role: 'user', content: 'Question' },
        { id: 'assistant-1', role: 'assistant', content: 'Draft' },
      ],
      messageList,
    );

    const replaced = replaceMessageById(
      'assistant-1',
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Final answer',
        thinkingSummary: 'Summarized internal reasoning.',
      },
      messageList,
    );
    expect(replaced).toBe(true);
    expect(messageList.textContent).toContain('Final answer');
    expect(messageList.textContent).toContain('Thinking process');

    const removed = removeMessageById('user-1', messageList);
    expect(removed).toBe(true);
    expect(messageList.textContent).not.toContain('Question');
  });

  it('shows a temporary thinking placeholder until streamed content arrives', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    renderAll([{ id: 'assistant-stream', role: 'assistant', content: '' }], messageList);

    expect(messageList.textContent).toContain('Thinking...');
    const dots = messageList.querySelectorAll('.thinking-placeholder-dot');
    expect(dots).toHaveLength(3);

    const replacedWithThinking = replaceMessageById(
      'assistant-stream',
      {
        id: 'assistant-stream',
        role: 'assistant',
        content: '',
        thinkingSummary: 'Checking assumptions.',
      },
      messageList,
    );
    expect(replacedWithThinking).toBe(true);
    expect(messageList.textContent).not.toContain('Thinking...');
    expect(messageList.textContent).toContain('Checking assumptions.');

    const replacedWithResponse = replaceMessageById(
      'assistant-stream',
      {
        id: 'assistant-stream',
        role: 'assistant',
        content: 'Final answer',
      },
      messageList,
    );
    expect(replacedWithResponse).toBe(true);
    expect(messageList.textContent).toContain('Final answer');
    expect(messageList.textContent).not.toContain('Thinking...');
  });

  it('renders an assistant stats disclosure with token and timing breakdown', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-stats',
        role: 'assistant',
        content: 'Final response',
        stats: {
          requestDurationMs: 1300,
          timeToFirstTokenMs: 240,
          outputTokens: 120,
          inputTokens: 42,
          thoughtTokens: 55,
          toolUseTokens: 8,
          cachedTokens: 0,
          totalTokens: 225,
          outputTokensPerSecond: 88.888,
          totalTokensPerSecond: 173.076,
          hasStreamingToken: true,
        },
      },
      messageList,
    );

    const stats = messageList.querySelector('.message-stats');
    expect(stats).not.toBeNull();
    expect(messageList.querySelector('.message-actions')).not.toBeNull();
    expect(stats?.querySelector('.message-stats-trigger')?.getAttribute('aria-label')).toBe(
      'Response statistics',
    );
    expect(stats?.querySelector('.message-action-icon')).not.toBeNull();
    expect(stats?.textContent).toContain('TTFT');
    expect(stats?.textContent).toContain('240 ms');
    expect(stats?.textContent).toContain('Output TPS');
    expect(stats?.textContent).toContain('88.89 tok/s');
    expect(stats?.textContent).toContain('Total Tokens');
    expect(stats?.textContent).toContain('225');
    expect(stats?.textContent).toContain('TTFT Source');
    expect(stats?.textContent).toContain('stream delta');
  });

  it('scrolls to the bottom when opening the stats disclosure', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    let simulatedScrollHeight = 160;
    Object.defineProperty(messageList, 'scrollHeight', {
      configurable: true,
      get: () => simulatedScrollHeight,
    });

    appendMessage(
      {
        id: 'assistant-stats-scroll',
        role: 'assistant',
        content: 'Final response',
        stats: {
          requestDurationMs: 1300,
          timeToFirstTokenMs: 240,
          outputTokens: 120,
          inputTokens: 42,
          thoughtTokens: 55,
          toolUseTokens: 8,
          cachedTokens: 0,
          totalTokens: 225,
          outputTokensPerSecond: 88.888,
          totalTokensPerSecond: 173.076,
          hasStreamingToken: true,
        },
      },
      messageList,
    );

    expect(messageList.scrollTop).toBe(160);

    simulatedScrollHeight = 320;
    const statsDisclosure = messageList.querySelector(
      '.message-stats',
    ) as HTMLDetailsElement | null;
    expect(statsDisclosure).not.toBeNull();

    if (!statsDisclosure) {
      throw new Error('Expected stats disclosure to be rendered.');
    }
    statsDisclosure.open = true;
    statsDisclosure.dispatchEvent(new Event('toggle', { bubbles: false }));

    expect(messageList.scrollTop).toBe(320);
  });

  it('copies the whole assistant response from the action row copy button', async () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    const clipboard = {
      writeText: (_value: string) => Promise.resolve(),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    const writeTextSpy = spyOn(clipboard, 'writeText').mockImplementation(() => Promise.resolve());

    appendMessage(
      {
        id: 'assistant-copy',
        role: 'assistant',
        content: 'Final answer',
        thinkingSummary: 'Checked assumptions.',
      },
      messageList,
    );

    const copyButton = messageList.querySelector('.message-copy-btn') as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();

    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy).toHaveBeenCalledWith(
      ['Thinking process:', 'Checked assumptions.', '', 'Final answer'].join('\n'),
    );
    expect(copyButton?.getAttribute('aria-label')).toBe('Copied');
    expect(copyButton?.classList.contains('is-copied')).toBe(true);
  });

  it('renders only regenerate action button for assistant messages with interaction ids', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const actionCalls: Array<{ action: 'regen'; messageId: string; interactionId: string }> = [];

    appendMessage(
      {
        id: 'assistant-action-target',
        role: 'assistant',
        content: 'Final answer',
        interactionId: 'interaction-1',
      },
      messageList,
      {
        onAssistantAction: (action, message) => {
          if (action !== 'regen') {
            return;
          }
          actionCalls.push({
            action,
            messageId: message.id,
            interactionId: message.interactionId ?? '',
          });
        },
      },
    );

    const regenButton = messageList.querySelector('.message-regen-btn') as HTMLButtonElement | null;
    const forkButton = messageList.querySelector('.message-fork-btn') as HTMLButtonElement | null;
    expect(regenButton).not.toBeNull();
    expect(forkButton).toBeNull();
    expect(regenButton?.querySelector('svg')).not.toBeNull();

    regenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(actionCalls).toEqual([
      {
        action: 'regen',
        messageId: 'assistant-action-target',
        interactionId: 'interaction-1',
      },
    ]);
  });

  it('renders regenerate button for empty assistant responses with interaction ids', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-empty-action-target',
        role: 'assistant',
        content: '',
        interactionId: 'interaction-empty-1',
      },
      messageList,
      {
        onAssistantAction: () => {},
      },
    );

    const regenButton = messageList.querySelector('.message-regen-btn') as HTMLButtonElement | null;
    const forkButton = messageList.querySelector('.message-fork-btn') as HTMLButtonElement | null;
    expect(regenButton).not.toBeNull();
    expect(forkButton).toBeNull();
    expect(regenButton?.querySelector('svg')).not.toBeNull();
    expect(regenButton?.getAttribute('aria-label')).toBe('Regenerate response');
  });

  it('renders a single branch navigator with disabled edge controls and switches to adjacent branches', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const selected: Array<{ messageId: string; interactionId: string }> = [];

    appendMessage(
      {
        id: 'assistant-branch-target',
        role: 'assistant',
        content: 'Branch answer',
        interactionId: 'interaction-b',
        branchOptionInteractionIds: ['interaction-a', 'interaction-b'],
        branchOptionCount: 2,
        branchOptionIndex: 2,
      },
      messageList,
      {
        onAssistantBranchSelect: (message, interactionId) => {
          selected.push({
            messageId: message.id,
            interactionId,
          });
        },
      },
    );

    const branchButtons = Array.from(
      messageList.querySelectorAll('.message-branch-nav'),
    ) as HTMLButtonElement[];
    const branchIndicator = messageList.querySelector('.message-branch-indicator');
    const branchSwitch = messageList.querySelector('.message-branch-switch');
    expect(branchSwitch).not.toBeNull();
    expect(branchSwitch?.textContent?.trim()).toBe('<2/2>');
    expect(branchIndicator?.textContent).toBe('2/2');
    expect(branchButtons).toHaveLength(2);
    const previousButton = messageList.querySelector(
      '.message-branch-prev',
    ) as HTMLButtonElement | null;
    const nextButton = messageList.querySelector(
      '.message-branch-next',
    ) as HTMLButtonElement | null;
    expect(previousButton).not.toBeNull();
    expect(previousButton?.disabled).toBe(false);
    expect(nextButton).not.toBeNull();
    expect(nextButton?.disabled).toBe(true);

    previousButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selected).toEqual([
      {
        messageId: 'assistant-branch-target',
        interactionId: 'interaction-a',
      },
    ]);
  });

  it('renders timestamp at the end of the assistant action bar', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-action-order',
        role: 'assistant',
        content: 'Branch answer',
        interactionId: 'interaction-b',
        branchOptionInteractionIds: ['interaction-a', 'interaction-b'],
        branchOptionCount: 2,
        branchOptionIndex: 2,
        timestamp: '2026-02-22T18:20:00.000Z',
      },
      messageList,
      {
        onAssistantAction: () => {},
        onAssistantBranchSelect: () => {},
      },
    );

    const actionBar = messageList.querySelector('.message-actions-assistant');
    const branchSwitch = messageList.querySelector('.message-branch-switch');
    const timeEl = messageList.querySelector('.message-timestamp');
    expect(actionBar).not.toBeNull();
    expect(branchSwitch).not.toBeNull();
    expect(timeEl).not.toBeNull();
    expect(actionBar?.lastElementChild).toBe(timeEl);
  });

  it('renders user action bar with copy and edit-and-retry buttons', async () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const actionCalls: Array<{
      action: 'fork';
      messageId: string;
      previousInteractionId: string;
    }> = [];
    const clipboard = {
      writeText: (_value: string) => Promise.resolve(),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    const writeTextSpy = spyOn(clipboard, 'writeText').mockImplementation(() => Promise.resolve());

    appendMessage(
      {
        id: 'user-action-target',
        role: 'user',
        content: 'Original prompt',
        previousInteractionId: 'interaction-1',
      },
      messageList,
      {
        onUserAction: (action, message) => {
          if (action !== 'fork') {
            return;
          }
          actionCalls.push({
            action,
            messageId: message.id,
            previousInteractionId: message.previousInteractionId ?? '',
          });
        },
      },
    );

    const actionBar = messageList.querySelector('.message-actions-user') as HTMLDivElement | null;
    const copyButton = messageList.querySelector('.message-copy-btn') as HTMLButtonElement | null;
    const editButton = messageList.querySelector('.message-fork-btn') as HTMLButtonElement | null;
    const bubble = messageList.querySelector('.bubble-user') as HTMLDivElement | null;
    const row = messageList.querySelector(
      'li[data-message-id="user-action-target"]',
    ) as HTMLLIElement | null;
    expect(actionBar).not.toBeNull();
    expect(copyButton).not.toBeNull();
    expect(editButton).not.toBeNull();
    expect(editButton?.getAttribute('aria-label')).toBe('Edit and retry in branch');
    expect(bubble?.querySelector('.message-actions-user')).toBeNull();
    expect(actionBar?.parentElement).toBe(row);

    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy).toHaveBeenCalledWith('Original prompt');
    expect(actionCalls).toEqual([
      {
        action: 'fork',
        messageId: 'user-action-target',
        previousInteractionId: 'interaction-1',
      },
    ]);
  });

  it('renders fork branch switch on user action bar and not assistant action bar', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const selected: Array<{ messageId: string; interactionId: string }> = [];

    appendMessage(
      {
        id: 'user-branch-target',
        role: 'user',
        content: 'Edited prompt',
        previousInteractionId: 'interaction-root',
        branchOptionInteractionIds: ['interaction-original', 'interaction-fork'],
        branchOptionCount: 2,
        branchOptionIndex: 2,
      },
      messageList,
      {
        onUserAction: () => {},
        onAssistantBranchSelect: (message, interactionId) => {
          selected.push({
            messageId: message.id,
            interactionId,
          });
        },
      },
    );

    appendMessage(
      {
        id: 'assistant-branch-target',
        role: 'assistant',
        content: 'Forked answer',
        interactionId: 'interaction-fork',
      },
      messageList,
      {
        onAssistantAction: () => {},
        onAssistantBranchSelect: () => {},
      },
    );

    const userRowSwitch = messageList.querySelector(
      'li[data-message-id="user-branch-target"] .message-branch-switch',
    ) as HTMLDivElement | null;
    const assistantRowSwitch = messageList.querySelector(
      'li[data-message-id="assistant-branch-target"] .message-branch-switch',
    );
    const previousButton = messageList.querySelector(
      'li[data-message-id="user-branch-target"] .message-branch-prev',
    ) as HTMLButtonElement | null;
    const nextButton = messageList.querySelector(
      'li[data-message-id="user-branch-target"] .message-branch-next',
    ) as HTMLButtonElement | null;

    expect(userRowSwitch).not.toBeNull();
    expect(userRowSwitch?.textContent?.trim()).toBe('<2/2>');
    expect(assistantRowSwitch).toBeNull();
    expect(previousButton?.disabled).toBe(false);
    expect(nextButton?.disabled).toBe(true);

    previousButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selected).toEqual([
      {
        messageId: 'user-branch-target',
        interactionId: 'interaction-original',
      },
    ]);
  });

  it('does not render regenerate/fork actions without interaction ids', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    appendMessage(
      {
        id: 'assistant-no-interaction-id',
        role: 'assistant',
        content: 'No branch target',
      },
      messageList,
    );
    appendMessage(
      {
        id: 'user-message',
        role: 'user',
        content: 'User text',
      },
      messageList,
    );

    expect(messageList.querySelector('.message-regen-btn')).toBeNull();
    expect(messageList.querySelector('.message-fork-btn')).toBeNull();
  });

  it('renders a timestamp in the assistant action bar when present', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const ts = new Date('2026-02-22T14:30:00Z').getTime();
    const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
    const formatCalls: Array<{
      locales: Intl.LocalesArgument | undefined;
      options: Intl.DateTimeFormatOptions | undefined;
    }> = [];

    Date.prototype.toLocaleTimeString = (function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ): string {
      formatCalls.push({ locales, options });
      return '14:30';
    }) as typeof Date.prototype.toLocaleTimeString;

    try {
      appendMessage(
        {
          id: 'assistant-ts',
          role: 'assistant',
          content: 'Timestamped response',
          timestamp: ts,
        },
        messageList,
      );
    } finally {
      Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    }

    const timeEl = messageList.querySelector('.message-timestamp');
    const row = messageList.querySelector('li[data-message-id="assistant-ts"]');
    const formatCall = formatCalls.at(0);
    expect(timeEl).not.toBeNull();
    expect(timeEl?.textContent).toBe('14:30');
    expect(formatCall?.options).toMatchObject({
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    expect(row?.classList.contains('row-with-actions')).toBe(true);
  });

  it('falls back to a generic error message for non-Error values', () => {
    expect(toErrorMessage(new Error('specific failure'))).toBe('specific failure');
    expect(toErrorMessage('plain string')).toBe('Request failed. Please try again.');
  });
});
