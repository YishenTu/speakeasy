import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  appendMessage,
  removeMessageById,
  renderAll,
  replaceMessageById,
  toErrorMessage,
} from '../../../../../src/chatpanel/features/messages/message-renderer';
import {
  type InstalledDomEnvironment,
  installDomTestEnvironment,
} from '../../../helpers/dom-test-env';

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

  it('allows append and replace updates to opt out of forced bottom scrolling', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    let simulatedScrollHeight = 220;
    Object.defineProperty(messageList, 'scrollHeight', {
      configurable: true,
      get: () => simulatedScrollHeight,
    });

    messageList.scrollTop = 48;
    const observedReasons: string[] = [];
    appendMessage(
      {
        id: 'assistant-streaming',
        role: 'assistant',
        content: 'Partial response',
      },
      messageList,
      {
        shouldAutoScroll: (reason) => {
          observedReasons.push(reason);
          return false;
        },
      },
    );

    expect(messageList.scrollTop).toBe(48);
    expect(observedReasons).toEqual(['append']);

    simulatedScrollHeight = 360;
    const replaced = replaceMessageById(
      'assistant-streaming',
      {
        id: 'assistant-streaming',
        role: 'assistant',
        content: 'Final streamed response',
      },
      messageList,
      {
        shouldAutoScroll: (reason) => {
          observedReasons.push(reason);
          return false;
        },
      },
    );

    expect(replaced).toBe(true);
    expect(messageList.scrollTop).toBe(48);
    expect(observedReasons).toEqual(['append', 'replace']);
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

  it('keeps blob preview URLs alive after image load', () => {
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
    expect(revokeSpy).not.toHaveBeenCalled();

    revokeSpy.mockRestore();
  });

  it('renders user attachments as composer-style tiles above and outside the user bubble', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'user-attachment-order',
        role: 'user',
        content: 'Describe this image.',
        attachments: [
          {
            name: 'preview.png',
            mimeType: 'image/png',
            previewUrl: 'data:image/png;base64,cA==',
          },
          {
            name: 'notes.md',
            mimeType: 'text/plain',
            previewText: '# Notes\n\n- Item 1',
          },
          {
            name: 'spec.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
      messageList,
    );

    const row = messageList.querySelector(
      'li[data-message-id="user-attachment-order"]',
    ) as HTMLLIElement | null;
    const strip = row?.querySelector('.message-attachment-strip') as HTMLDivElement | null;
    const bubble = messageList.querySelector('.bubble-user') as HTMLDivElement | null;
    const messageText = bubble?.querySelector('.message-text') as HTMLDivElement | null;
    expect(strip).not.toBeNull();
    expect(messageText).not.toBeNull();
    expect(strip?.classList.contains('file-preview-strip')).toBe(true);
    expect(strip?.querySelectorAll('.file-preview-tile')).toHaveLength(3);
    expect(strip?.querySelectorAll('.file-preview-name')).toHaveLength(3);
    expect(strip?.querySelector('.file-preview-generic.is-pdf')).not.toBeNull();
    const previewImage = strip?.querySelector('.file-preview-image') as HTMLImageElement | null;
    const markdownPreviewTile = strip?.querySelector(
      '.file-preview-tile.previewable-text[data-speakeasy-preview-text="true"]',
    ) as HTMLDivElement | null;
    const markdownGeneric = markdownPreviewTile?.querySelector(
      '.file-preview-generic.is-markdown',
    ) as HTMLDivElement | null;
    expect(previewImage?.classList.contains('previewable-image')).toBe(true);
    expect(previewImage?.dataset.speakeasyPreviewImage).toBe('true');
    expect(markdownPreviewTile).not.toBeNull();
    expect(markdownGeneric).not.toBeNull();
    expect(bubble?.querySelector('.attachment-list')).toBeNull();
    expect(row?.firstElementChild).toBe(strip);
    expect(strip?.nextElementSibling).toBe(bubble);
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

  it('renders a sources list for assistant messages with grounding sources', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-sources',
        role: 'assistant',
        content: 'Response text',
        groundingSources: [
          { title: 'Example', url: 'https://example.com' },
          { title: 'Other', url: 'https://other.com' },
        ],
      },
      messageList,
    );

    const row = messageList.querySelector(
      'li[data-message-id="assistant-sources"]',
    ) as HTMLLIElement | null;
    const sources = row?.querySelector('.message-sources') as HTMLDivElement | null;
    expect(sources).not.toBeNull();
    expect(sources?.querySelector('.message-sources-label')?.textContent).toBe('Source');

    const links = Array.from(sources?.querySelectorAll('a') ?? []);
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toBe('Example');
    expect(links[0]?.getAttribute('href')).toBe('https://example.com');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1]?.textContent).toBe('Other');
    expect(links[1]?.getAttribute('href')).toBe('https://other.com');
  });

  it('does not render sources list when assistant message has no grounding sources', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-no-sources',
        role: 'assistant',
        content: 'Response text',
      },
      messageList,
    );

    const row = messageList.querySelector(
      'li[data-message-id="assistant-no-sources"]',
    ) as HTMLLIElement | null;
    expect(row?.querySelector('.message-sources')).toBeNull();
  });

  it('collapses long source lists with a toggle', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-many-sources',
        role: 'assistant',
        content: 'Response text',
        groundingSources: [
          { title: 'One', url: 'https://one.example.com' },
          { title: 'Two', url: 'https://two.example.com' },
          { title: 'Three', url: 'https://three.example.com' },
          { title: 'Four', url: 'https://four.example.com' },
          { title: 'Five', url: 'https://five.example.com' },
          { title: 'Six', url: 'https://six.example.com' },
          { title: 'Seven', url: 'https://seven.example.com' },
        ],
      },
      messageList,
    );

    const row = messageList.querySelector(
      'li[data-message-id="assistant-many-sources"]',
    ) as HTMLLIElement | null;
    const primaryLinks = Array.from(
      row?.querySelectorAll('.message-sources-list-primary a') ?? [],
    ) as HTMLAnchorElement[];
    const overflowList = row?.querySelector(
      '.message-sources-list-overflow',
    ) as HTMLUListElement | null;
    const overflowLinks = Array.from(
      overflowList?.querySelectorAll('a') ?? [],
    ) as HTMLAnchorElement[];
    const toggle = row?.querySelector('.message-sources-toggle') as HTMLButtonElement | null;

    expect(primaryLinks).toHaveLength(5);
    expect(overflowLinks).toHaveLength(2);
    expect(primaryLinks[0]?.textContent).toBe('One');
    expect(primaryLinks[4]?.textContent).toBe('Five');
    expect(overflowLinks[0]?.textContent).toBe('Six');
    expect(overflowLinks[1]?.textContent).toBe('Seven');
    expect(toggle?.textContent).toBe('Show 2 more');
    expect(overflowList?.hidden).toBe(true);
    expect(overflowList?.hasAttribute('hidden')).toBe(true);

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggle?.textContent).toBe('Show less');
    expect(overflowList?.hidden).toBe(false);

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggle?.textContent).toBe('Show 2 more');
    expect(overflowList?.hidden).toBe(true);
  });

  it('sanitizes unsafe grounding source links', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-unsafe-sources',
        role: 'assistant',
        content: 'Response text',
        groundingSources: [
          { title: 'Safe', url: 'https://example.com' },
          { title: 'Unsafe JS', url: 'javascript:alert(1)' },
          { title: 'Unsafe Relative', url: '/internal/path' },
        ],
      },
      messageList,
    );

    const row = messageList.querySelector(
      'li[data-message-id="assistant-unsafe-sources"]',
    ) as HTMLLIElement | null;
    const links = Array.from(row?.querySelectorAll('.message-sources a') ?? []);
    expect(links).toHaveLength(3);

    const linksByText = new Map(links.map((link) => [link.textContent ?? '', link]));
    const safe = linksByText.get('Safe');
    expect(safe?.getAttribute('href')).toBe('https://example.com');
    expect(safe?.getAttribute('target')).toBe('_blank');
    expect(safe?.getAttribute('rel')).toBe('noopener noreferrer');

    const unsafeJs = linksByText.get('Unsafe JS');
    expect(unsafeJs?.hasAttribute('href')).toBe(false);
    expect(unsafeJs?.hasAttribute('target')).toBe(false);
    expect(unsafeJs?.hasAttribute('rel')).toBe(false);

    const unsafeRelative = linksByText.get('Unsafe Relative');
    expect(unsafeRelative?.hasAttribute('href')).toBe(false);
    expect(unsafeRelative?.hasAttribute('target')).toBe(false);
    expect(unsafeRelative?.hasAttribute('rel')).toBe(false);
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

  it('hides assistant action bar while the assistant response is streaming', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    appendMessage(
      {
        id: 'assistant-streaming-actions',
        role: 'assistant',
        content: 'Partial response',
        interactionId: 'interaction-streaming-actions',
        timestamp: Date.parse('2026-02-22T18:20:00.000Z'),
        isStreaming: true,
      },
      messageList,
      {
        onAssistantAction: () => {},
      },
    );

    const row = messageList.querySelector(
      'li[data-message-id="assistant-streaming-actions"]',
    ) as HTMLLIElement | null;
    expect(row?.textContent).toContain('Partial response');
    expect(row?.querySelector('.message-actions-assistant')).toBeNull();
    expect(row?.classList.contains('row-with-actions')).toBe(false);
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
          turnTokensPerSecond: 70.123,
          outputTokensPerSecond: 88.888,
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
    expect(stats?.textContent).toContain('Turn TTFT');
    expect(stats?.textContent).toContain('240 ms');
    expect(stats?.textContent).toContain('Turn TPS');
    expect(stats?.textContent).toContain('70.12 tok/s');
    expect(stats?.textContent).toContain('Output TPS');
    expect(stats?.textContent).toContain('88.89 tok/s');
    expect(stats?.textContent).toContain('Total Tokens');
    expect(stats?.textContent).toContain('225');
    expect(stats?.textContent).not.toContain('Turn TTFT Source');
    expect(stats?.textContent).not.toContain('stream delta');
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
          turnTokensPerSecond: 70.123,
          outputTokensPerSecond: 88.888,
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

  it('does not force bottom scroll when opening stats for a non-latest assistant message', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    let simulatedScrollHeight = 200;
    Object.defineProperty(messageList, 'scrollHeight', {
      configurable: true,
      get: () => simulatedScrollHeight,
    });

    renderAll(
      [
        {
          id: 'assistant-stats-first',
          role: 'assistant',
          content: 'First response',
          stats: {
            requestDurationMs: 1000,
            timeToFirstTokenMs: 180,
            outputTokens: 60,
            inputTokens: 20,
            thoughtTokens: 8,
            toolUseTokens: 1,
            cachedTokens: 0,
            totalTokens: 89,
            turnTokensPerSecond: 69,
            outputTokensPerSecond: 60,
            hasStreamingToken: true,
          },
        },
        {
          id: 'assistant-stats-second',
          role: 'assistant',
          content: 'Second response',
          stats: {
            requestDurationMs: 900,
            timeToFirstTokenMs: 140,
            outputTokens: 58,
            inputTokens: 24,
            thoughtTokens: 7,
            toolUseTokens: 2,
            cachedTokens: 0,
            totalTokens: 91,
            turnTokensPerSecond: 74.444,
            outputTokensPerSecond: 64.444,
            hasStreamingToken: true,
          },
        },
      ],
      messageList,
    );

    expect(messageList.scrollTop).toBe(200);
    messageList.scrollTop = 72;
    simulatedScrollHeight = 360;

    const firstStatsDisclosure = messageList.querySelector(
      'li[data-message-id="assistant-stats-first"] .message-stats',
    ) as HTMLDetailsElement | null;
    expect(firstStatsDisclosure).not.toBeNull();

    if (!firstStatsDisclosure) {
      throw new Error('Expected first stats disclosure to be rendered.');
    }

    firstStatsDisclosure.open = true;
    firstStatsDisclosure.dispatchEvent(new Event('toggle', { bubbles: false }));

    const firstRow = messageList.querySelector(
      'li[data-message-id="assistant-stats-first"]',
    ) as HTMLLIElement | null;
    const firstActionBar = firstRow?.querySelector('.message-actions-assistant') as
      | HTMLDivElement
      | undefined;
    expect(firstRow?.classList.contains('row-stats-open')).toBe(true);
    expect(firstActionBar?.classList.contains('is-stats-open')).toBe(true);
    expect(messageList.scrollTop).toBe(72);

    firstStatsDisclosure.open = false;
    firstStatsDisclosure.dispatchEvent(new Event('toggle', { bubbles: false }));

    expect(firstRow?.classList.contains('row-stats-open')).toBe(false);
    expect(firstActionBar?.classList.contains('is-stats-open')).toBe(false);
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

  it('shows a temporary error state when response copy fails', async () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    const clipboard = {
      writeText: (_value: string) => Promise.reject(new Error('clipboard denied')),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });

    appendMessage(
      {
        id: 'assistant-copy-failure',
        role: 'assistant',
        content: 'Final answer',
      },
      messageList,
    );

    const copyButton = messageList.querySelector('.message-copy-btn') as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();

    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(copyButton?.getAttribute('aria-label')).toBe('Copy failed');
    expect(copyButton?.classList.contains('is-copy-failed')).toBe(true);
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
        timestamp: Date.parse('2026-02-22T18:20:00.000Z'),
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

  it('copies only user text and excludes attachment metadata from copy action', async () => {
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
        id: 'user-copy-with-attachments',
        role: 'user',
        content: 'Compare these screenshots',
        attachments: [
          {
            name: 'screenshot-1.png',
            mimeType: 'image/png',
            fileUri: 'files/screenshot-1',
          },
        ],
      },
      messageList,
    );

    const copyButton = messageList.querySelector('.message-copy-btn') as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();

    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy).toHaveBeenCalledWith('Compare these screenshots');
  });

  it('shows a temporary error label when fenced code copy fails', async () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;

    const clipboard = {
      writeText: (_value: string) => Promise.reject(new Error('clipboard denied')),
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });

    renderAll(
      [
        {
          id: 'a-code-copy-failure',
          role: 'assistant',
          content: ['```ts', 'const value = 1;', '```'].join('\n'),
        },
      ],
      messageList,
    );

    const label = messageList.querySelector('.message-text .code-lang');
    expect(label).not.toBeNull();

    label?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(label?.textContent).toBe('copy failed');
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

  it('escapes message ids when replacing and removing rendered messages', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const trickyMessageId = 'assistant"\']special';

    renderAll(
      [
        {
          id: trickyMessageId,
          role: 'assistant',
          content: 'before',
        },
      ],
      messageList,
    );

    expect(() =>
      replaceMessageById(
        trickyMessageId,
        {
          id: trickyMessageId,
          role: 'assistant',
          content: 'after',
        },
        messageList,
      ),
    ).not.toThrow();
    expect(messageList.textContent).toContain('after');

    expect(() => removeMessageById(trickyMessageId, messageList)).not.toThrow();
    expect(messageList.children).toHaveLength(0);
  });

  it('revokes blob preview URLs when replacing image messages before load', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const revokeSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    appendMessage(
      {
        id: 'assistant-preview-replace',
        role: 'assistant',
        content: 'Pending image',
        attachments: [
          {
            name: 'preview.png',
            mimeType: 'image/png',
            previewUrl: 'blob:preview-before-load',
          },
        ],
      },
      messageList,
    );

    const replaced = replaceMessageById(
      'assistant-preview-replace',
      {
        id: 'assistant-preview-replace',
        role: 'assistant',
        content: 'Replaced before preview load',
      },
      messageList,
    );

    expect(replaced).toBe(true);
    expect(revokeSpy).toHaveBeenCalledWith('blob:preview-before-load');
    revokeSpy.mockRestore();
  });

  it('revokes blob preview URLs when removing image messages before load', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const revokeSpy = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    appendMessage(
      {
        id: 'assistant-preview-remove',
        role: 'assistant',
        content: 'Pending image',
        attachments: [
          {
            name: 'preview.png',
            mimeType: 'image/png',
            previewUrl: 'blob:preview-remove-before-load',
          },
        ],
      },
      messageList,
    );

    const removed = removeMessageById('assistant-preview-remove', messageList);
    expect(removed).toBe(true);
    expect(revokeSpy).toHaveBeenCalledWith('blob:preview-remove-before-load');
    revokeSpy.mockRestore();
  });

  it('renders a timestamp in the assistant action bar when present', () => {
    const messageList = document.getElementById('messages') as HTMLOListElement;
    const ts = new Date('2026-02-22T14:30:00Z').getTime();
    const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
    const formatCalls: Array<{
      locales: Intl.LocalesArgument | undefined;
      options: Intl.DateTimeFormatOptions | undefined;
    }> = [];

    Date.prototype.toLocaleTimeString = function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ): string {
      formatCalls.push({ locales, options });
      return '14:30';
    } as typeof Date.prototype.toLocaleTimeString;

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
    expect(toErrorMessage('plain string')).toBe('plain string');
    expect(toErrorMessage({ message: 'typed object error' })).toBe('typed object error');
    expect(toErrorMessage({})).toBe('Request failed. Please try again.');
  });
});
