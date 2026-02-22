import { describe, expect, it } from 'bun:test';
import { highlightCode } from '../../src/chatpanel/highlight';

describe('chatpanel highlight', () => {
  it('highlights known languages with hljs token spans', () => {
    const result = highlightCode('const value = 42;', 'javascript');

    expect(result.highlighted).toBe(true);
    expect(result.value).toContain('hljs-');
  });

  it('supports language aliases and normalization', () => {
    const result = highlightCode('const value: number = 1;', ' TS linenums ');

    expect(result.highlighted).toBe(true);
    expect(result.value).toContain('hljs-');
  });

  it('falls back to escaped plain text for unknown languages', () => {
    const result = highlightCode('if (a < b) alert("x");', 'customlang');

    expect(result.highlighted).toBe(false);
    expect(result.value).toBe('if (a &lt; b) alert(&quot;x&quot;);');
    expect(result.value).not.toContain('hljs-');
  });

  it('falls back to escaped plain text when language is undefined', () => {
    const result = highlightCode('<script>alert(1)</script>');

    expect(result.highlighted).toBe(false);
    expect(result.value).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes xss vectors in highlighted output', () => {
    const result = highlightCode('const payload = "<img src=x onerror=alert(1)>";', 'js');

    expect(result.highlighted).toBe(true);
    expect(result.value).toContain('&lt;img');
    expect(result.value).not.toContain('<img');
  });
});
