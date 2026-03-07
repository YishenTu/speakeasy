import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OPTIONS_HTML_PATH = resolve(import.meta.dir, '../../../src/options/options.html');
const TAILWIND_CSS_PATH = resolve(import.meta.dir, '../../../src/styles/tailwind.css');

describe('options markup', () => {
  it('renders slash command rows as cards in the real settings template', () => {
    const html = readFileSync(OPTIONS_HTML_PATH, 'utf8');

    expect(html).toContain('id="slash-command-rows" class="settings-slash-command-list"');
    expect(html).toContain('class="settings-slash-command-card" data-slash-command-row');
    expect(html).toContain('data-slash-command-summary');
    expect(html).toContain('data-slash-command-title');
    expect(html).toContain('data-slash-command-preview');
    expect(html).toContain('data-edit-slash-command');
    expect(html).toContain('data-done-slash-command');
  });

  it('defines dedicated slash command card styles in the Tailwind component layer', () => {
    const css = readFileSync(TAILWIND_CSS_PATH, 'utf8');

    expect(css).toContain('.settings-help-text {');
    expect(css).toContain('.settings-slash-command-list {');
    expect(css).toContain('.settings-slash-command-card {');
    expect(css).toContain('.settings-slash-command-summary {');
    expect(css).toContain('.settings-slash-command-avatar {');
    expect(css).toContain('.settings-slash-command-preview {');
    expect(css).toContain('.settings-slash-command-editor {');
    expect(css).toContain('@apply mt-4 grid gap-4');
    expect(css).toContain('md:grid-cols-2');
  });
});
