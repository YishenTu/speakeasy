import DOMPurify, { type Config } from 'dompurify';
import renderMathInElement from 'katex/contrib/auto-render';
import { Marked, type Tokens } from 'marked';
import { highlightCode } from './highlight';

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
      const { highlighted, value } = highlightCode(text, lang);
      const codeClass = highlighted ? ' class="hljs"' : '';
      const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
      return `<pre>${langLabel}<code${codeClass}>${value}</code></pre>\n`;
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
  return markdown.replace(/\$\$([\s\S]*?)\$\$/g, (fullMatch, body) => {
    const normalizedBody = normalizeDisplayMathBlock(body);
    return normalizedBody ? `$$${normalizedBody}$$` : fullMatch;
  });
}

function normalizeDisplayMathBlock(body: string): string {
  let normalized = normalizeTexLineBreaks(body).trim();
  if (!normalized) {
    return '';
  }

  normalized = normalizeDisplayEnvironmentAliases(normalized);
  normalized = normalizeExplicitAlignedEnvironments(normalized);
  if (shouldWrapWithAlignedEnvironment(normalized)) {
    normalized = wrapWithAlignedEnvironment(normalized);
  }

  return normalized;
}

function normalizeDisplayEnvironmentAliases(tex: string): string {
  return tex
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/g, '\\end{gathered}')
    .replace(/\\begin\{dcases\*?\}/g, '\\begin{cases}')
    .replace(/\\end\{dcases\*?\}/g, '\\end{cases}');
}

function shouldWrapWithAlignedEnvironment(tex: string): boolean {
  if (/\\begin\{[a-zA-Z*]+\}/.test(tex)) {
    return false;
  }

  const lines = tex
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return false;
  }

  const equalsCount = lines.filter((line) => line.includes('=')).length;
  return equalsCount >= 2 || lines.slice(1).some((line) => line.startsWith('='));
}

function wrapWithAlignedEnvironment(tex: string): string {
  const normalizedLines = splitAlignedRows(tex).map((line) => normalizeAlignedLine(line));

  return `\\begin{aligned}\n${normalizedLines.join(' \\\\\n')}\n\\end{aligned}`;
}

function normalizeExplicitAlignedEnvironments(tex: string): string {
  return tex.replace(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/g, (_match, body: string) => {
    const normalizedLines = splitAlignedRows(body).map((line) => normalizeAlignedLine(line));
    if (normalizedLines.length === 0) {
      return '\\begin{aligned}\\end{aligned}';
    }

    return `\\begin{aligned}\n${normalizedLines.join(' \\\\\n')}\n\\end{aligned}`;
  });
}

function splitAlignedRows(tex: string): string[] {
  const normalized = tex.replace(/\r/g, '');
  if (!normalized.trim()) {
    return [];
  }

  const candidates = normalized.includes('\n') ? normalized.split('\n') : normalized.split(/\\\\/g);

  return candidates.map((line) => line.trim()).filter((line) => line.length > 0);
}

function normalizeAlignedLine(line: string): string {
  const withoutTrailingBreak = line.replace(/\\\\\s*$/, '').trim();
  if (!withoutTrailingBreak) {
    return '';
  }

  if (withoutTrailingBreak.includes('&')) {
    return withoutTrailingBreak;
  }

  if (withoutTrailingBreak.startsWith('=')) {
    return `&${withoutTrailingBreak}`;
  }

  const equalsIndex = withoutTrailingBreak.indexOf('=');
  if (equalsIndex <= 0) {
    return withoutTrailingBreak;
  }

  return `${withoutTrailingBreak.slice(0, equalsIndex)}&${withoutTrailingBreak.slice(equalsIndex)}`;
}
