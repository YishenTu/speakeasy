export function getComposerTemplate(): string {
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
            <div class="composer-row">
              <textarea id="speakeasy-input" class="input" placeholder="Ask anything..." rows="3"></textarea>
            </div>
            <div class="input-toolbar">
              <div class="dropup" id="speakeasy-model-dropup">
                <button type="button" class="dropup-trigger" data-value="gemini-3-flash-preview">Flash</button>
                <div class="dropup-menu">
                  <button type="button" class="dropup-item" data-value="gemini-3-flash-preview" aria-selected="true">Flash</button>
                  <button type="button" class="dropup-item" data-value="gemini-3.1-pro-preview">Pro</button>
                </div>
              </div>
              <span class="input-toolbar-label">Thinking</span>
              <div class="dropup" id="speakeasy-thinking-dropup">
                <button type="button" class="dropup-trigger" data-value="minimal">Min</button>
                <div class="dropup-menu">
                  <button type="button" class="dropup-item" data-value="high">High</button>
                  <button type="button" class="dropup-item" data-value="medium">Med</button>
                  <button type="button" class="dropup-item" data-value="low">Low</button>
                  <button type="button" class="dropup-item" data-value="minimal" aria-selected="true">Min</button>
                </div>
              </div>
              <div class="input-toolbar-actions">
                <button
                  id="speakeasy-capture-full-page"
                  class="attach-btn"
                  type="button"
                  aria-label="Capture full-page screenshot">
                  <svg class="attach-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M5 8h3l1.1-2h5.8L16 8h3a2 2 0 0 1 2 2v6.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5V10a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="1.8" />
                  </svg>
                </button>
                <button id="speakeasy-attach" class="attach-btn" type="button" aria-label="Attach file">
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
