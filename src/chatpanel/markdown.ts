import DOMPurify, { type Config } from 'dompurify';
import renderMathInElement from 'katex/contrib/auto-render';
import { Marked, type Tokens } from 'marked';

const markdownParser = new Marked({
  gfm: true,
  breaks: false,
});

markdownParser.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    code({ text, lang }: Tokens.Code): string {
      const escaped = escapeHtml(text);
      const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
      return `<pre>${langLabel}<code>${escaped}</code></pre>\n`;
    },
  },
});

const SANITIZE_CONFIG: Config = {
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOWED_TAGS: [
    'a',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'input',
    'li',
    'ol',
    'p',
    'pre',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  ALLOWED_ATTR: ['align', 'checked', 'class', 'disabled', 'href', 'title', 'type'],
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function renderMarkdownToSafeHtml(markdown: string, ownerDocument: Document): string {
  if (!markdown.trim()) {
    return '';
  }

  const normalizedMarkdown = normalizeMarkdownForTex(markdown);
  const parsedHtml = markdownParser.parse(normalizedMarkdown, { async: false });
  const view = ownerDocument.defaultView;
  if (!view) {
    return escapeHtml(markdown);
  }

  const purifier = DOMPurify(view);
  const sanitizedHtml = purifier.sanitize(parsedHtml, SANITIZE_CONFIG);

  const container = ownerDocument.createElement('div');
  container.innerHTML = sanitizedHtml;
  renderMathInElement(container, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
    ],
    preProcess: normalizeTexLineBreaks,
    errorCallback: () => {},
    output: 'mathml',
    strict: 'ignore',
    throwOnError: false,
    trust: false,
  });

  return container.innerHTML;
}

function escapeHtml(input: string): string {
  return input.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character] ?? character);
}

function normalizeTexLineBreaks(tex: string): string {
  // Some model responses use a single trailing "\" per row in matrix environments.
  // KaTeX expects "\\", so normalize this common variant before rendering.
  return tex.replace(/(?<!\\)\\[ \t]*\r?\n/g, '\\\\\n');
}

function normalizeMarkdownForTex(markdown: string): string {
  return markdown.replace(/\$\$([\s\S]*?)\$\$/g, (fullMatch, body: string) => {
    if (!body.includes('\n')) {
      return fullMatch;
    }

    return `$$${normalizeTexLineBreaks(body)}$$`;
  });
}
