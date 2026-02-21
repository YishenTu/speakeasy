import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { appendMessage, renderAll, toErrorMessage } from '../../src/chatpanel/messages';
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

  it('falls back to a generic error message for non-Error values', () => {
    expect(toErrorMessage(new Error('specific failure'))).toBe('specific failure');
    expect(toErrorMessage('plain string')).toBe('Request failed. Please try again.');
  });
});
