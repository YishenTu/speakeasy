export function getShellTemplate(brandLogoSrc = 'icons/gemini-logo.svg'): string {
  return `
        <header id="speakeasy-drag-handle" class="top">
          <h2 class="brand-title">
            <img id="speakeasy-brand-logo" class="brand-logo" src="${brandLogoSrc}" alt="" />
            Speakeasy
          </h2>
          <div class="controls">
            <button id="speakeasy-new-chat" class="icon-btn" type="button" aria-label="New chat">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <div id="speakeasy-history-control" class="control-wrap">
              <button id="speakeasy-history-toggle" class="icon-btn" type="button" aria-label="History">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v3h3" />
                  <path d="M12 8v5l3 2" />
                </svg>
              </button>
              <div id="speakeasy-history-menu" class="history-menu sp-scrollable" role="menu"></div>
            </div>
            <button id="speakeasy-settings" class="icon-btn" type="button" aria-label="Settings">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 1-3 0 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 1 0-3 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 1 3 0 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.22.37.5.68.85.93a1.7 1.7 0 0 1 0 3c-.35.25-.63.56-.85.93Z" />
              </svg>
            </button>
            <button id="speakeasy-close" class="icon-btn" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>`;
}
