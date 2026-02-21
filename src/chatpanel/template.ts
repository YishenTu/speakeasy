export function getChatPanelTemplate(): string {
  return `
    <style>
      :host {
        all: initial;
      }

      .shell {
        position: fixed;
        top: 18px;
        left: 18px;
        width: min(390px, calc(100vw - 24px));
        height: min(620px, calc(100vh - 96px));
        z-index: 2147483647;
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        color: #f8fafc;
        box-sizing: border-box;
      }

      .shell[hidden] {
        display: none;
      }

      .panel {
        width: 100%;
        height: 100%;
        position: relative;
        border-radius: 8px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(18, 18, 18, 0.65);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
      }

      .top {
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        user-select: none;
        touch-action: none;
      }

      .brand-title {
        margin: 0;
        font-size: 14px;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.85);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .brand-logo {
        width: 18px;
        height: 18px;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .control-btn {
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.5);
        border-radius: 0;
        padding: 6px 8px;
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
        transition: color 120ms ease, background 120ms ease;
      }

      .controls,
      .control-btn {
        cursor: pointer;
        user-select: auto;
        touch-action: manipulation;
      }

      .control-btn:hover {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.08);
      }

      .control-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .messages {
        margin: 0;
        padding: 16px;
        overflow: auto;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 12px;
        scroll-behavior: smooth;
      }

      .messages::-webkit-scrollbar {
        width: 4px;
      }

      .messages::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 0;
      }

      .messages::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .row-user {
        align-items: flex-end;
      }

      .row-assistant {
        align-items: flex-start;
      }

      .bubble {
        max-width: 85%;
        margin: 0;
        padding: 10px 14px;
        border-radius: 0;
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
      }

      .bubble-user {
        background: rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.95);
        border-radius: 8px;
      }

      .bubble-assistant {
        width: calc(100% + 28px);
        max-width: calc(100% + 28px);
        box-sizing: border-box;
        background: transparent;
        color: rgba(255, 255, 255, 0.85);
        margin: 0 -14px;
      }

      .composer {
        padding: 12px 14px;
        background: transparent;
      }

      .composer-inner {
        display: flex;
        flex-direction: column;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 2px 4px;
        transition: border-color 150ms ease, background 150ms ease;
      }

      .composer-row {
        display: flex;
        align-items: flex-end;
      }

      .input-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px 6px;
      }

      .dropup {
        position: relative;
      }

      .dropup-trigger {
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.5);
        font-family: inherit;
        font-size: 11px;
        padding: 4px 18px 4px 6px;
        border-radius: 0;
        cursor: pointer;
        outline: none;
        transition: color 120ms ease, background 120ms ease;
        background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 5l4-4 4 4' stroke='rgba(255,255,255,0.5)' fill='none' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 4px center;
      }

      .dropup-trigger:hover,
      .dropup.open .dropup-trigger {
        color: rgba(255, 255, 255, 0.9);
        background-color: rgba(255, 255, 255, 0.08);
        background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 5l4-4 4 4' stroke='rgba(255,255,255,0.9)' fill='none' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 4px center;
      }

      .dropup-menu {
        display: none;
        position: absolute;
        bottom: calc(100% + 4px);
        left: 0;
        min-width: 100%;
        background: rgba(24, 24, 24, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        padding: 2px 0;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 10;
        flex-direction: column;
      }

      .dropup.open .dropup-menu {
        display: flex;
      }

      .dropup-item {
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        font-family: inherit;
        font-size: 11px;
        padding: 5px 12px;
        cursor: pointer;
        text-align: left;
        white-space: nowrap;
        transition: color 80ms ease, background 80ms ease;
      }

      .dropup-item:hover {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.95);
      }

      .dropup-item[aria-selected="true"] {
        color: rgba(255, 255, 255, 0.95);
      }

      .composer-inner:focus-within {
        border-color: rgba(255, 255, 255, 0.3);
        background: transparent;
      }

      .composer[aria-busy="true"] .composer-inner {
        opacity: 0.6;
        pointer-events: none;
      }

      .input {
        flex: 1;
        min-width: 0;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.95);
        padding: 10px 12px;
        font-size: 13px;
        resize: none;
        font-family: inherit;
        max-height: 200px;
        overflow-y: auto;
      }

      .input::-webkit-scrollbar {
        width: 8px;
        background: transparent;
      }

      .input::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }

      .input::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.25);
      }

      .input::placeholder {
        color: rgba(255, 255, 255, 0.3);
      }

      .input:focus {
        outline: none;
      }

      .resize-zone {
        position: absolute;
        z-index: 2;
        background: transparent;
        touch-action: none;
      }

      .resize-top {
        top: 0;
        left: 12px;
        right: 12px;
        height: 10px;
        cursor: ns-resize;
      }

      .resize-right {
        top: 12px;
        right: 0;
        bottom: 12px;
        width: 10px;
        cursor: ew-resize;
      }

      .resize-bottom {
        right: 12px;
        bottom: 0;
        left: 12px;
        height: 10px;
        cursor: ns-resize;
      }

      .resize-left {
        top: 12px;
        bottom: 12px;
        left: 0;
        width: 10px;
        cursor: ew-resize;
      }

      .resize-corner {
        width: 14px;
        height: 14px;
      }

      .resize-top-left {
        top: 0;
        left: 0;
        cursor: nwse-resize;
      }

      .resize-top-right {
        top: 0;
        right: 0;
        cursor: nesw-resize;
      }

      .resize-bottom-right {
        right: 0;
        bottom: 0;
        cursor: nwse-resize;
      }

      .resize-bottom-left {
        bottom: 0;
        left: 0;
        cursor: nesw-resize;
      }

      .resize-zone::before {
        content: '';
        position: absolute;
        inset: 0;
      }
    </style>

    <div id="speakeasy-shell" class="shell" hidden>
      <section id="speakeasy-panel" class="panel">
        <header id="speakeasy-drag-handle" class="top">
          <h2 class="brand-title">
            <svg class="brand-logo" viewBox="0 0 28.01 28" xmlns="http://www.w3.org/2000/svg" width="2500" height="2499"><radialGradient id="a" cx="-576.08" cy="491.7" gradientTransform="matrix(28.2302 9.54441 76.4642 -226.16369 -21336.18 116711.38)" gradientUnits="userSpaceOnUse" r="1"><stop offset=".07" stop-color="#9168c0"/><stop offset=".34" stop-color="#5684d1"/><stop offset=".67" stop-color="#1ba1e3"/></radialGradient><path d="M14 28c0-1.94-.37-3.76-1.12-5.46-.72-1.7-1.72-3.19-2.98-4.45s-2.74-2.25-4.44-2.97C3.76 14.37 1.94 14 0 14c1.94 0 3.76-.36 5.46-1.09 1.7-.75 3.19-1.75 4.44-3.01 1.26-1.26 2.25-2.74 2.98-4.44C13.63 3.76 14 1.94 14 0c0 1.94.36 3.76 1.09 5.46.75 1.7 1.75 3.19 3.01 4.44 1.26 1.26 2.74 2.26 4.45 3.01 1.7.72 3.52 1.09 5.46 1.09-1.94 0-3.76.37-5.46 1.12-1.7.72-3.19 1.71-4.45 2.97s-2.26 2.74-3.01 4.45A13.86 13.86 0 0 0 14 28z" fill="url(#a)"/></svg>
            Speakeasy
          </h2>
          <div class="controls">
            <button id="speakeasy-settings" class="control-btn" type="button">Settings</button>
            <button id="speakeasy-new-chat" class="control-btn" type="button">New</button>
            <button id="speakeasy-close" class="control-btn" type="button" aria-label="Close">Close</button>
          </div>
        </header>

        <ol id="speakeasy-messages" class="messages"></ol>

        <form id="speakeasy-form" class="composer" autocomplete="off">
          <div class="composer-inner">
            <div class="composer-row">
              <textarea id="speakeasy-input" class="input" placeholder="Ask anything..." rows="3" required></textarea>
            </div>
            <div class="input-toolbar">
              <div class="dropup" id="speakeasy-model-dropup">
                <button type="button" class="dropup-trigger" data-value="gemini-3-flash-preview">Flash</button>
                <div class="dropup-menu">
                  <button type="button" class="dropup-item" data-value="gemini-3-flash-preview" aria-selected="true">Flash</button>
                  <button type="button" class="dropup-item" data-value="gemini-3.1-pro-preview">Pro</button>
                </div>
              </div>
              <div class="dropup" id="speakeasy-thinking-dropup">
                <button type="button" class="dropup-trigger" data-value="minimal">Min</button>
                <div class="dropup-menu">
                  <button type="button" class="dropup-item" data-value="high">High</button>
                  <button type="button" class="dropup-item" data-value="medium">Med</button>
                  <button type="button" class="dropup-item" data-value="low">Low</button>
                  <button type="button" class="dropup-item" data-value="minimal" aria-selected="true">Min</button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </section>
      <div class="resize-zone resize-top" data-resize="top"></div>
      <div class="resize-zone resize-right" data-resize="right"></div>
      <div class="resize-zone resize-bottom" data-resize="bottom"></div>
      <div class="resize-zone resize-left" data-resize="left"></div>
      <div class="resize-zone resize-corner resize-top-left" data-resize="top-left"></div>
      <div class="resize-zone resize-corner resize-top-right" data-resize="top-right"></div>
      <div class="resize-zone resize-corner resize-bottom-right" data-resize="bottom-right"></div>
      <div class="resize-zone resize-corner resize-bottom-left" data-resize="bottom-left"></div>
    </div>
  `;
}
