/**
 * Example plugin for site-specific HTML preprocessing.
 *
 * Plugin interface:
 * - id: stable unique id for logs and debugging.
 * - matches(url): return true only for URLs this plugin should handle.
 * - preprocess({ sourceHtml, sourceUrl, parseHtmlToDocument }): return normalized HTML.
 */
export const examplePageTextPlugin = {
  id: 'example-page-text-plugin',
  matches: (sourceUrl) => {
    try {
      const url = new URL(sourceUrl);
      return url.hostname === 'example.com' && url.pathname === '/article';
    } catch {
      return false;
    }
  },
  preprocess: ({ sourceHtml, parseHtmlToDocument }) => {
    const doc = parseHtmlToDocument(sourceHtml);
    for (const node of doc.querySelectorAll('nav, aside, script, style')) {
      node.remove();
    }
    return doc.documentElement.outerHTML;
  },
};
