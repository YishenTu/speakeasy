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

  it('falls back to a generic error message for non-Error values', () => {
    expect(toErrorMessage(new Error('specific failure'))).toBe('specific failure');
    expect(toErrorMessage('plain string')).toBe('Request failed. Please try again.');
  });
});
