import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  extractAndStageCurrentTabText,
  toExtractedTextFile,
} from '../../../src/chatpanel/page-text-extraction';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

describe('chatpanel page text extraction', () => {
  let env: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    env = installDomTestEnvironment();
  });

  afterEach(() => {
    env?.restore();
    env = null;
  });

  it('extracts markdown from full-page html and stages it as an attachment', async () => {
    const stagedFiles: File[][] = [];
    let capturedHtml = '';
    const textFile = await extractAndStageCurrentTabText({
      stageFromFiles: (files) => {
        stagedFiles.push(files);
      },
      sourceTitle: 'Workspace / Example Tab',
      parseHtmlToDocument: (html) => {
        capturedHtml = html;
        const parsed = document.implementation.createHTMLDocument('Extracted');
        parsed.open();
        parsed.write(html);
        parsed.close();
        return parsed;
      },
      createDefuddle: (doc, options) => {
        expect(doc.documentElement.outerHTML).toContain('<html');
        expect(options.url).toBe('https://example.test/');
        expect(options.markdown).toBe(true);
        return {
          parse: () => ({
            title: 'Defuddle Article Title',
            content: '# Example Article\n\nThis is extracted markdown.',
          }),
        };
      },
    });

    expect(capturedHtml).toContain('<html');
    expect(stagedFiles).toHaveLength(1);
    expect(stagedFiles[0]).toHaveLength(1);
    expect(stagedFiles[0]?.[0]).toBe(textFile);
    expect(textFile.name).toBe('Workspace Example Tab.md');
    expect(textFile.type).toContain('text/plain');
    expect(await textFile.text()).toBe('# Example Article\n\nThis is extracted markdown.');
  });

  it('removes the Speakeasy overlay root before extraction', async () => {
    const sourceDocument = document.implementation.createHTMLDocument('Test');
    sourceDocument.body.innerHTML = `
      <div id="speakeasy-overlay-root"><p>Overlay</p></div>
      <article><h1>Readable</h1><p>Body</p></article>
    `;
    sourceDocument.documentElement.setAttribute('lang', 'en');

    let sawOverlay = true;
    await extractAndStageCurrentTabText({
      sourceDocument,
      sourceUrl: 'https://example.test/page',
      stageFromFiles: () => {},
      parseHtmlToDocument: (html) => {
        const parsed = sourceDocument.implementation.createHTMLDocument('Extracted');
        parsed.open();
        parsed.write(html);
        parsed.close();
        return parsed;
      },
      createDefuddle: (doc) => {
        sawOverlay = !!doc.getElementById('speakeasy-overlay-root');
        return {
          parse: () => ({
            title: 'Readable',
            content: '# Readable\n\nBody',
          }),
        };
      },
    });

    expect(sawOverlay).toBe(false);
  });

  it('throws when extraction returns empty markdown', async () => {
    await expect(
      extractAndStageCurrentTabText({
        stageFromFiles: () => {},
        parseHtmlToDocument: (html) => {
          const parsed = document.implementation.createHTMLDocument('Extracted');
          parsed.open();
          parsed.write(html);
          parsed.close();
          return parsed;
        },
        createDefuddle: () => ({
          parse: () => ({
            title: 'No Content',
            content: '  ',
          }),
        }),
      }),
    ).rejects.toThrow(/no readable text/i);
  });

  it('uses a stable fallback file name when title is missing', async () => {
    const file = toExtractedTextFile({
      markdown: '# Untitled',
      title: '',
    });

    expect(file.name).toBe('speakeasy-page-extract.md');
    expect(file.type).toContain('text/plain');
    expect(await file.text()).toBe('# Untitled');
  });

  it('sanitizes extracted file names with screenshot-style title rules', async () => {
    const file = toExtractedTextFile({
      markdown: '# Report',
      title: '  Project: Alpha/Beta? <Draft>\n',
    });

    expect(file.name).toBe('Project Alpha Beta Draft.md');
  });
});
