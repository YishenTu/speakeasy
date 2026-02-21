import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { renderMarkdownToSafeHtml } from '../../src/chatpanel/markdown';
import { type InstalledDomEnvironment, installDomTestEnvironment } from './helpers/dom-test-env';

describe('chatpanel markdown', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment();
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
  });

  it('strips unsafe markdown links and keeps allowed protocols', () => {
    const rendered = renderMarkdownToSafeHtml(
      '[safe](https://example.com) [mail](mailto:test@example.com) [bad](javascript:alert(1))',
      document,
    );
    const container = document.createElement('div');
    container.innerHTML = rendered;

    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(3);
    expect(links[0]?.getAttribute('href')).toBe('https://example.com');
    expect(links[1]?.getAttribute('href')).toBe('mailto:test@example.com');
    expect(links[2]?.hasAttribute('href')).toBe(false);
  });

  it('renders raw html as text while preserving markdown output', () => {
    const rendered = renderMarkdownToSafeHtml('## Heading <b>bold</b>', document);
    const container = document.createElement('div');
    container.innerHTML = rendered;

    expect(container.querySelector('h2')?.textContent).toContain('Heading');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>bold</b>');
  });

  it('renders inline and block tex expressions into mathml', () => {
    const rendered = renderMarkdownToSafeHtml('Inline: $x^2 + y^2$.\n\n$$\\frac{1}{2}$$', document);
    const container = document.createElement('div');
    container.innerHTML = rendered;

    const mathNodes = container.querySelectorAll('math');
    expect(mathNodes.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('x');
    expect(container.textContent).toContain('1');
    expect(container.querySelector('math[display="block"]')).not.toBeNull();
  });

  it('does not render escaped dollar signs as tex', () => {
    const rendered = renderMarkdownToSafeHtml('Price is \\$20 and not math.', document);
    const container = document.createElement('div');
    container.innerHTML = rendered;

    expect(container.querySelector('math')).toBeNull();
    expect(container.textContent).toContain('$20');
  });

  it('renders multiline matrix expressions inside display math fences', () => {
    const rendered = renderMarkdownToSafeHtml(
      String.raw`$$\begin{pmatrix}
1 & 0 & 0 \\
0 & 1 & 0 \\
0 & 0 & 1
\end{pmatrix}$$`,
      document,
    );
    const container = document.createElement('div');
    container.innerHTML = rendered;

    expect(container.querySelector('math')).not.toBeNull();
    expect(container.querySelector('mtable')).not.toBeNull();
  });

  it('normalizes single trailing backslashes into matrix row separators', () => {
    const rendered = renderMarkdownToSafeHtml(
      String.raw`$$\begin{pmatrix}
1 & 0 & 0 \
0 & 1 & 0 \
0 & 0 & 1
\end{pmatrix}$$`,
      document,
    );
    const container = document.createElement('div');
    container.innerHTML = rendered;

    expect(container.querySelector('math')).not.toBeNull();
    expect(container.querySelector('mtable')).not.toBeNull();
  });

  it('supports align environments inside display fences by normalizing to aligned', () => {
    const rendered = renderMarkdownToSafeHtml(
      String.raw`$$\begin{align}
(a+b)^2 &= (a+b)(a+b) \\
&= a^2 + ab + ba + b^2 \\
&= a^2 + 2ab + b^2
\end{align}$$`,
      document,
    );
    const container = document.createElement('div');
    container.innerHTML = rendered;

    expect(container.querySelector('math')).not.toBeNull();
    expect(container.querySelector('mtable')).not.toBeNull();
  });

  it('auto-inserts aligned anchors for explicit aligned rows without ampersands', () => {
    const rendered = renderMarkdownToSafeHtml(
      String.raw`$$\begin{aligned}
(a+b)^2 = (a+b)(a+b) \\
= a^2 + ab + ba + b^2 \\
= a^2 + 2ab + b^2
\end{aligned}$$`,
      document,
    );
    const container = document.createElement('div');
    container.innerHTML = rendered;

    const rows = Array.from(container.querySelectorAll('mtr'));
    expect(rows.length).toBeGreaterThan(0);
    const firstRowCells = rows[0]?.querySelectorAll('mtd') ?? [];
    expect(firstRowCells.length).toBeGreaterThanOrEqual(2);
  });

  it('wraps multiline step equations in aligned when no environment is provided', () => {
    const rendered = renderMarkdownToSafeHtml(
      ['$$', '(a+b)^2 = (a+b)(a+b)', '= a^2 + ab + ba + b^2', '= a^2 + 2ab + b^2', '$$'].join('\n'),
      document,
    );
    const container = document.createElement('div');
    container.innerHTML = rendered;

    expect(container.querySelector('math')).not.toBeNull();
    expect(container.querySelector('mtable')).not.toBeNull();
  });
});
