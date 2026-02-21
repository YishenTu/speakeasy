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
