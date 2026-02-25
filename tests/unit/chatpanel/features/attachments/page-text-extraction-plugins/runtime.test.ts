import { describe, expect, it } from 'bun:test';
import {
  type PageTextExtractionPreprocessInput,
  type PageTextExtractionPreprocessPlugin,
  preprocessSourceHtmlWithPlugins,
  resolvePageTextPreprocessSourceHtml,
} from '../../../../../../src/chatpanel/features/attachments/page-text-extraction-plugins/runtime';

const DEFAULT_PREPROCESS_INPUT: PageTextExtractionPreprocessInput = {
  sourceHtml: '<html><body>Original</body></html>',
  sourceUrl: 'https://example.test/page',
  parseHtmlToDocument: () => {
    throw new Error('parseHtmlToDocument should not be called in this test.');
  },
};

describe('page text extraction plugin runtime', () => {
  it('applies only the first plugin that matches the source url', () => {
    const plugins: ReadonlyArray<PageTextExtractionPreprocessPlugin> = [
      {
        id: 'non-matching',
        matches: () => false,
        preprocess: () => '<html><body>ignored</body></html>',
      },
      {
        id: 'matching',
        matches: (url) => url.includes('/page'),
        preprocess: () => '<html><body>processed</body></html>',
      },
      {
        id: 'second-match',
        matches: () => true,
        preprocess: () => '<html><body>unexpected</body></html>',
      },
    ];

    const nextHtml = preprocessSourceHtmlWithPlugins(DEFAULT_PREPROCESS_INPUT, plugins);
    expect(nextHtml).toBe('<html><body>processed</body></html>');
  });

  it('falls back to original html when no plugin matches', () => {
    const plugins: ReadonlyArray<PageTextExtractionPreprocessPlugin> = [
      {
        id: 'non-matching',
        matches: () => false,
        preprocess: () => '<html><body>ignored</body></html>',
      },
    ];

    const nextHtml = preprocessSourceHtmlWithPlugins(DEFAULT_PREPROCESS_INPUT, plugins);
    expect(nextHtml).toBe(DEFAULT_PREPROCESS_INPUT.sourceHtml);
  });

  it('resolves plugins from a module-like object and applies matching plugins', async () => {
    const preprocess = await resolvePageTextPreprocessSourceHtml({
      loadPlugins: async () => ({
        pageTextExtractionPlugins: [
          {
            id: 'matching',
            matches: (url: string) => url.endsWith('/page'),
            preprocess: ({ sourceHtml }: PageTextExtractionPreprocessInput) =>
              `${sourceHtml}\n<!-- normalized -->`,
          },
        ],
      }),
    });

    const nextHtml = preprocess(DEFAULT_PREPROCESS_INPUT);
    expect(nextHtml).toContain('normalized');
  });
});
