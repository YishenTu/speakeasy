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

  it('renders the header brand logo as an image asset', () => {
    const logoUrl = 'chrome-extension://test-id/icons/gemini-logo.svg';
    const template = getChatPanelTemplate(logoUrl);

    expect(template).toContain('id="speakeasy-brand-logo"');
    expect(template).toContain(`src="${logoUrl}"`);
    expect(template).not.toContain('<radialGradient id="a"');
  });

  it('renders a full-page screenshot capture button in the input toolbar', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('id="speakeasy-capture-full-page"');
    expect(template).toContain('aria-label="Capture full-page screenshot"');
    expect(template).toContain('id="speakeasy-extract-page-text"');
    expect(template).toContain('aria-label="Extract page text as markdown"');
  });

  it('renders image preview markup inside the chatpanel container', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('id="speakeasy-image-preview-view"');
    expect(template).toContain('id="speakeasy-image-preview-image"');
    expect(template).toContain('id="speakeasy-image-preview-close"');
    expect(template).toContain('id="speakeasy-text-preview-view"');
    expect(template).toContain('id="speakeasy-text-preview-title"');
    expect(template).toContain('id="speakeasy-text-preview-content"');
    expect(template).toContain('id="speakeasy-text-preview-close"');
    expect(template).not.toContain('id="speakeasy-image-preview-overlay"');
    expect(template).not.toContain('id="speakeasy-image-preview-caption"');
  });

  it('renders image preview as the top in-panel layer without overlay background containers', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.image-preview-view {');
    expect(template).toContain('position: absolute;');
    expect(template).toContain('inset: 0;');
    expect(template).toContain('z-index: 30;');
    expect(template).not.toContain('.image-preview-overlay {');
    expect(template).not.toContain('.image-preview-dialog {');
    expect(template).toContain('.image-preview-close {');
    expect(template).not.toContain('background: rgba(5, 5, 5, 0.72);');
    expect(template).toContain('.text-preview-view {');
    expect(template).toContain('.text-preview-content {');
  });

  it('renders image preview media at full in-panel width and height', () => {
    const template = getChatPanelTemplate();

    expect(template).toContain('.image-preview-view {');
    expect(template).toContain('padding: 0;');
    expect(template).toContain('overflow-y: auto;');
    expect(template).toContain('overflow-x: hidden;');
    expect(template).toMatch(
      /\.image-preview-image\s*{[^}]*width:\s*100%;[^}]*height:\s*auto;[^}]*min-height:\s*100%;[^}]*object-fit:\s*cover;[^}]*}/,
    );
  });

  it('contains wheel and touch overscroll within chatpanel scroll regions', () => {
    const template = getChatPanelTemplate();

    expect(template).toMatch(/\.history-menu\s*{[^}]*overscroll-behavior:\s*contain;/);
    expect(template).toMatch(/\.image-preview-view\s*{[^}]*overscroll-behavior:\s*contain;/);
    expect(template).toMatch(/\.messages\s*{[^}]*overscroll-behavior:\s*contain;/);
    expect(template).toMatch(/\.mention-list\s*{[^}]*overscroll-behavior:\s*contain;/);
    expect(template).toMatch(/\.input\s*{[^}]*overscroll-behavior:\s*contain;/);
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
    expect(template).toContain('#speakeasy-model-dropup .dropup-trigger,');
    expect(template).toContain('#speakeasy-thinking-dropup .dropup-item {');
    expect(template).toContain("font-family: 'IBM Plex Mono'");
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
