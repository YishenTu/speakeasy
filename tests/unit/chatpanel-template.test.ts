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

  it('renders a full-page screenshot capture button in the input toolbar', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('id="speakeasy-capture-full-page"');
    expect(template).toContain('aria-label="Capture full-page screenshot"');
  });

  it('renders chatpanel-scoped image preview overlay markup', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('id="speakeasy-image-preview-overlay"');
    expect(template).toContain('id="speakeasy-image-preview-image"');
    expect(template).toContain('id="speakeasy-image-preview-close"');
  });

  it('uses a full-panel image preview container without border', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.image-preview-overlay {');
    expect(template).toContain('padding: 0;');
    expect(template).toContain('.image-preview-dialog {');
    expect(template).toMatch(/\.image-preview-dialog\s*{[^}]*background:\s*transparent;/);
    expect(template).toContain('border: none;');
    expect(template).not.toContain('background: rgba(15, 15, 15, 0.94);');
    expect(template).not.toContain('border: 1px solid rgba(255, 255, 255, 0.16);');
  });

  it('uses width-adaptive image preview with vertical scrolling for long images', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.image-preview-dialog {');
    expect(template).toContain('justify-content: flex-start;');
    expect(template).toContain('overflow-y: auto;');
    expect(template).toContain('overflow-x: hidden;');
    expect(template).toContain('.image-preview-image {');
    expect(template).toContain('width: 100%;');
    expect(template).toContain('height: auto;');
    expect(template).toContain('max-height: none;');
    expect(template).not.toContain('max-height: 100%;');
  });

  it('uses enlarged input toolbar controls and wider capture-action spacing', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.input-toolbar {');
    expect(template).toContain('gap: 8px;');
    expect(template).toContain('.input-toolbar-actions {');
    expect(template).toContain('gap: 10px;');
    expect(template).toContain('.attach-icon {');
    expect(template).toContain('width: 18px;');
    expect(template).toContain('height: 18px;');
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

  it('renders tab mention menu markup inside the composer', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('id="speakeasy-tab-mention-menu"');
    expect(template).toContain('id="speakeasy-tab-mention-list"');
    expect(template).toContain('id="speakeasy-tab-mention-empty"');
    expect(template).toContain('class="mention-menu" hidden');
  });

  it('includes tab mention style rules for menu, list, and items', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.composer-input-wrap {');
    expect(template).toContain('position: relative;');
    expect(template).toContain('.mention-menu {');
    expect(template).toContain('position: absolute;');
    expect(template).toContain('bottom: calc(100% + 6px);');
    expect(template).toContain('.mention-list {');
    expect(template).toContain('.mention-item {');
    expect(template).toContain('.mention-item[aria-selected="true"] {');
    expect(template).toContain('.mention-item-title {');
    expect(template).toContain('.mention-item-meta {');
    expect(template).toContain('.mention-empty {');
  });
});
