import { describe, expect, it } from 'bun:test';
import { getChatPanelTemplate } from '../../src/chatpanel/template';

describe('chatpanel template', () => {
  it('renders stats panel at full action-row width', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.message-actions {');
    expect(template).toContain('position: relative;');
    expect(template).toContain('.message-stats-panel {');
    expect(template).toContain('left: 0;');
    expect(template).toContain('right: 0;');
    expect(template).toContain('width: auto;');
    expect(template).not.toContain('width: min(360px, 100%);');
  });

  it('wraps fenced code blocks without horizontal scrolling', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.message-text pre {');
    expect(template).toContain('overflow-x: hidden;');
    expect(template).toContain('white-space: pre-wrap;');
    expect(template).toContain('overflow-wrap: anywhere;');
    expect(template).not.toContain('overflow-x: auto;');
    expect(template).not.toContain('white-space: pre;');
  });
});
