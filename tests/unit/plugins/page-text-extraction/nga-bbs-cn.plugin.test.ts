import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ngaBbsCnPlugin } from '../../../../plugins/page-text-extraction/local-nga-bbs-cn.plugin.js';
import {
  type InstalledDomEnvironment,
  installDomTestEnvironment,
} from '../../helpers/dom-test-env';

describe('nga bbs cn plugin', () => {
  let env: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    env = installDomTestEnvironment();
  });

  afterEach(() => {
    env?.restore();
    env = null;
  });

  it('matches all pages under bbs.nga.cn only', () => {
    expect(ngaBbsCnPlugin.matches('https://bbs.nga.cn/read.php?tid=46260077')).toBe(true);
    expect(ngaBbsCnPlugin.matches('https://bbs.nga.cn/thread.php?fid=-7&page=3')).toBe(true);
    expect(ngaBbsCnPlugin.matches('https://bbs.nga.cn/')).toBe(true);
    expect(ngaBbsCnPlugin.matches('https://ngabbs.com/read.php?tid=46260077')).toBe(false);
    expect(ngaBbsCnPlugin.matches('https://nga.178.com/read.php?tid=46260077')).toBe(false);
    expect(ngaBbsCnPlugin.matches('https://foo.bbs.nga.cn/read.php?tid=46260077')).toBe(false);
  });

  it('normalizes post table html into readable article sections', () => {
    const sourceHtml = `
      <html>
        <head><title>Sample NGA Thread</title></head>
        <body>
          <a id="postauthor0">Author A</a>
          <span id="postdate0">2026-02-25 12:00</span>
          <span id="postcontent0" class="postcontent">
            First line<br>
            Second line
            <img src="about:blank" onerror="alert(1)">
          </span>
        </body>
      </html>
    `;

    const parser = env?.window.DOMParser;
    if (!parser) {
      throw new Error('DOMParser is unavailable in test environment.');
    }

    const normalizedHtml = ngaBbsCnPlugin.preprocess({
      sourceHtml,
      sourceUrl: 'https://bbs.nga.cn/read.php?tid=46260077',
      parseHtmlToDocument: (html) => new parser().parseFromString(html, 'text/html'),
    });

    const parsed = new parser().parseFromString(normalizedHtml, 'text/html');
    expect(parsed.querySelector('article[data-speakeasy-source="nga-bbs-cn"]')).not.toBeNull();
    expect(parsed.querySelector('h1')?.textContent).toBe('Sample NGA Thread');
    expect(parsed.querySelector('h2')?.textContent).toContain('#0 Author A');
    expect(parsed.querySelector('p')?.textContent).toBe('2026-02-25 12:00');
    expect(parsed.querySelector('img[src="about:blank"]')).toBeNull();
  });

  it('keeps text around smile emojis by converting smile images to inline text', () => {
    const sourceHtml = `
      <html>
        <head><title>Emoji Thread</title></head>
        <body>
          <a id="postauthor0">Author A</a>
          <span id="postdate0">2026-02-25 12:00</span>
          <span id="postcontent0" class="postcontent ubbcode">
            从标题到正文全是错误，也是没谁了
            <img class="smile_ac" src="https://img4.nga.178.com/ngabbs/post/smile/ac26.png" alt="怕">
            <span class="smile_alt_text" style="display: none;">[怕]</span>
          </span>
        </body>
      </html>
    `;

    const parser = env?.window.DOMParser;
    if (!parser) {
      throw new Error('DOMParser is unavailable in test environment.');
    }

    const normalizedHtml = ngaBbsCnPlugin.preprocess({
      sourceHtml,
      sourceUrl: 'https://bbs.nga.cn/read.php?tid=46260077',
      parseHtmlToDocument: (html) => new parser().parseFromString(html, 'text/html'),
    });

    const parsed = new parser().parseFromString(normalizedHtml, 'text/html');
    const section = parsed.querySelector('section[data-floor="0"]');
    expect(section?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      '从标题到正文全是错误，也是没谁了 [怕]',
    );
    expect(section?.querySelector('img.smile_ac')).toBeNull();
    expect(section?.querySelector('.smile_alt_text')).toBeNull();
  });
});
