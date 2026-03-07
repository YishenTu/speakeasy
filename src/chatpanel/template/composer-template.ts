import {
  type BuiltinGeminiModelKey,
  type ThinkingLevel,
  getBuiltinGeminiModelByKey,
} from '../../shared/settings';

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
  minimal: 'Min',
};
const MODEL_MENU_ORDER: readonly BuiltinGeminiModelKey[] = ['pro', 'flash', 'flash-lite'];

function renderModelMenuItems(selectedModel: string): string {
  return MODEL_MENU_ORDER.map((key) => {
    const entry = getBuiltinGeminiModelByKey(key);
    const selected = entry.model === selectedModel ? ' aria-selected="true"' : '';
    return `<button type="button" class="dropup-item" data-value="${entry.model}"${selected}>${entry.label}</button>`;
  }).join('');
}

function renderThinkingMenuItems(
  levels: readonly ThinkingLevel[],
  selectedLevel: ThinkingLevel,
): string {
  return [...levels]
    .reverse()
    .map((level) => {
      const selected = level === selectedLevel ? ' aria-selected="true"' : '';
      return `<button type="button" class="dropup-item" data-value="${level}"${selected}>${THINKING_LABELS[level] ?? level}</button>`;
    })
    .join('');
}

export function getComposerTemplate(): string {
  const defaultModel = getBuiltinGeminiModelByKey('flash');
  const defaultThinkingLevel = defaultModel.defaultThinkingLevel;
  return `
        <form id="speakeasy-form" class="composer" autocomplete="off">
          <div class="composer-inner">
            <input
              id="speakeasy-file-input"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain"
              multiple
              hidden />
            <div id="speakeasy-file-previews" class="file-preview-strip"></div>
            <div class="composer-input-wrap">
              <div id="speakeasy-slash-command-menu" class="slash-command-menu" hidden>
                <div id="speakeasy-slash-command-empty" class="slash-command-empty" hidden>No matching commands</div>
                <div id="speakeasy-slash-command-list" class="slash-command-list sp-scrollable" role="listbox"></div>
              </div>
              <div id="speakeasy-tab-mention-menu" class="mention-menu" hidden>
                <div id="speakeasy-tab-mention-empty" class="mention-empty">No matching tabs</div>
                <div id="speakeasy-tab-mention-list" class="mention-list sp-scrollable" role="listbox"></div>
              </div>
              <div class="composer-row">
                <textarea id="speakeasy-input" class="input sp-scrollable" placeholder="Ask anything..." rows="3"></textarea>
              </div>
            </div>
            <div class="input-toolbar">
              <div class="dropup" id="speakeasy-model-dropup">
                <button type="button" class="dropup-trigger" data-value="${defaultModel.model}" title="Select model">${defaultModel.label}</button>
                <div class="dropup-menu">${renderModelMenuItems(defaultModel.model)}</div>
              </div>
              <span class="input-toolbar-separator" aria-hidden="true">|</span>
              <div class="dropup" id="speakeasy-thinking-dropup">
                <button type="button" class="dropup-trigger" data-value="${defaultThinkingLevel}" title="Select effort level">${THINKING_LABELS[defaultThinkingLevel] ?? defaultThinkingLevel}</button>
                <div class="dropup-menu">${renderThinkingMenuItems(defaultModel.thinkingLevels, defaultThinkingLevel)}</div>
              </div>
              <div class="input-toolbar-actions">
                <button
                  id="speakeasy-extract-page-text"
                  class="attach-btn"
                  type="button"
                  aria-label="Extract page text as markdown"
                  title="Extract page text as markdown">
                  <svg class="attach-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M9 13h6M9 17h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </svg>
                </button>
                <button
                  id="speakeasy-capture-full-page"
                  class="attach-btn"
                  type="button"
                  aria-label="Capture full-page screenshot"
                  title="Capture full-page screenshot">
                  <svg class="attach-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M5 8h3l1.1-2h5.8L16 8h3a2 2 0 0 1 2 2v6.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5V10a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="1.8" />
                  </svg>
                </button>
                <button
                  id="speakeasy-attach-video-url"
                  class="attach-btn"
                  type="button"
                  aria-label="Attach current YouTube URL"
                  title="Attach current YouTube URL"
                  hidden>
                  <svg class="attach-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="4" y="6" width="16" height="12" rx="3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M10 9.5L14.5 12L10 14.5V9.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button id="speakeasy-attach" class="attach-btn" type="button" aria-label="Attach file" title="Attach file">
                  <svg class="attach-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M8 12.5L14.8 5.7a3 3 0 1 1 4.2 4.2l-8.6 8.6a5 5 0 1 1-7.1-7.1l9-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </form>`;
}

export function getResizeZonesTemplate(): string {
  return `
      <div class="resize-zone resize-top" data-resize="top"></div>
      <div class="resize-zone resize-right" data-resize="right"></div>
      <div class="resize-zone resize-bottom" data-resize="bottom"></div>
      <div class="resize-zone resize-left" data-resize="left"></div>
      <div class="resize-zone resize-corner resize-top-left" data-resize="top-left"></div>
      <div class="resize-zone resize-corner resize-top-right" data-resize="top-right"></div>
      <div class="resize-zone resize-corner resize-bottom-right" data-resize="bottom-right"></div>
      <div class="resize-zone resize-corner resize-bottom-left" data-resize="bottom-left"></div>`;
}
