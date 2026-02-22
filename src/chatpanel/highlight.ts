import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

interface HighlightCodeResult {
  value: string;
  highlighted: boolean;
}

const highlighter = hljs.newInstance();

highlighter.registerLanguage('javascript', javascript);
highlighter.registerLanguage('typescript', typescript);
highlighter.registerLanguage('python', python);
highlighter.registerLanguage('bash', bash);
highlighter.registerLanguage('c', c);
highlighter.registerLanguage('cpp', cpp);
highlighter.registerLanguage('css', css);
highlighter.registerLanguage('go', go);
highlighter.registerLanguage('java', java);
highlighter.registerLanguage('json', json);
highlighter.registerLanguage('php', php);
highlighter.registerLanguage('ruby', ruby);
highlighter.registerLanguage('rust', rust);
highlighter.registerLanguage('sql', sql);
highlighter.registerLanguage('xml', xml);
highlighter.registerLanguage('yaml', yaml);

highlighter.registerAliases(['js'], { languageName: 'javascript' });
highlighter.registerAliases(['ts'], { languageName: 'typescript' });
highlighter.registerAliases(['py'], { languageName: 'python' });
highlighter.registerAliases(['sh', 'shell'], { languageName: 'bash' });
highlighter.registerAliases(['yml'], { languageName: 'yaml' });
highlighter.registerAliases(['rb'], { languageName: 'ruby' });
highlighter.registerAliases(['rs'], { languageName: 'rust' });

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  yml: 'yaml',
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function highlightCode(text: string, lang?: string): HighlightCodeResult {
  const normalizedLanguage = normalizeLanguage(lang);
  if (!normalizedLanguage || !highlighter.getLanguage(normalizedLanguage)) {
    return {
      value: escapeHtml(text),
      highlighted: false,
    };
  }

  return {
    value: highlighter.highlight(text, { language: normalizedLanguage, ignoreIllegals: true })
      .value,
    highlighted: true,
  };
}

function normalizeLanguage(lang?: string): string | undefined {
  if (!lang) {
    return undefined;
  }

  const [candidate] = lang.trim().toLowerCase().split(/\s+/, 1);
  if (!candidate) {
    return undefined;
  }

  return LANGUAGE_ALIASES[candidate] ?? candidate;
}

function escapeHtml(input: string): string {
  return input.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character] ?? character);
}
