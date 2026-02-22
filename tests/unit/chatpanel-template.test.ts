import { describe, expect, it } from 'bun:test';
import { getChatPanelTemplate } from '../../src/chatpanel/template';

describe('chatpanel template', () => {
  it('keeps extra space above composer for message action bars and expanded stats', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('--sp-composer-top-gap: 12px;');
    expect(template).toContain('--sp-messages-bottom-clearance: 32px;');
    expect(template).toContain('.composer {');
    expect(template).toContain('margin-top: var(--sp-composer-top-gap);');
  });

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

  it('reserves vertical clearance for rows that show action bars', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('--sp-message-actions-clearance: 16px;');
    expect(template).toContain('.row-with-actions {');
    expect(template).toContain('padding-bottom: var(--sp-message-actions-clearance);');
  });

  it('keeps action rows visible while hovering the message bubble or action bar', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.row-assistant:hover .message-actions-assistant,');
    expect(template).toContain('.row-assistant .message-actions-assistant:hover,');
    expect(template).toContain('.row-user:hover .message-actions-user,');
    expect(template).toContain('.row-user .message-actions-user:hover');
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

  it('shows a Thinking label before the thinking-level selector', () => {
    const template = getChatPanelTemplate();

    const labelMarkup = '<span class="input-toolbar-label">Thinking</span>';
    expect(template).toContain(labelMarkup);

    const labelIndex = template.indexOf(labelMarkup);
    const thinkingDropupIndex = template.indexOf('id="speakeasy-thinking-dropup"');
    expect(labelIndex).toBeGreaterThan(-1);
    expect(thinkingDropupIndex).toBeGreaterThan(labelIndex);
  });

  it('uses square staged-file previews and removes legacy chip styling', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.file-preview-item {');
    expect(template).toContain('.file-preview-tile {');
    expect(template).toContain('.file-preview-generic {');
    expect(template).toContain('.file-preview-filetype {');
    expect(template).toContain('.file-preview-name {');
    expect(template).toContain('text-overflow: ellipsis;');
    expect(template).toContain('.message-attachment-strip {');
    expect(template).not.toContain('.file-chip {');
  });
});
