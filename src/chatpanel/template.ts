export function getChatPanelTemplate(): string {
  return `
    <style>
      :host {
        all: initial;
      }

      .shell {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        color: #f8fafc;
      }

      .panel {
        width: min(390px, calc(100vw - 24px));
        height: min(620px, calc(100vh - 96px));
        margin-top: 10px;
        border-radius: 0;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(18, 18, 18, 0.65);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
      }

      .panel[hidden] {
        display: none;
      }

      .top {
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
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

      .role-label {
        font-size: 10px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.3);
        margin: 0 4px;
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
      }

      .bubble-assistant {
        background: transparent;
        color: rgba(255, 255, 255, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .composer {
        padding: 12px 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: transparent;
      }

      .composer-inner {
        display: flex;
        align-items: center;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0;
        padding: 4px 6px;
        transition: border-color 150ms ease, background 150ms ease;
      }

      .composer-inner:focus-within {
        border-color: rgba(255, 255, 255, 0.3);
        background: rgba(0, 0, 0, 0.4);
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
        padding: 8px 10px;
        font-size: 13px;
      }

      .input::placeholder {
        color: rgba(255, 255, 255, 0.3);
      }

      .input:focus {
        outline: none;
      }

      .send {
        flex-shrink: 0;
        border: 0;
        border-radius: 0;
        padding: 6px 10px;
        margin-left: 4px;
        font-size: 16px;
        line-height: 1;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        background: transparent;
        transition: color 150ms ease, transform 100ms ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .send:hover {
        color: rgba(255, 255, 255, 0.95);
      }
      
      .send:active {
        transform: scale(0.95);
      }

      .send:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        color: rgba(255, 255, 255, 0.3);
      }


      @media (max-width: 620px) {
        .shell {
          right: 12px;
          left: 12px;
          bottom: 12px;
        }

        .panel {
          width: calc(100vw - 24px);
          height: min(72vh, 560px);
        }
      }
    </style>

    <div class="shell">
      <section id="speakeasy-panel" class="panel" hidden>
        <header class="top">
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
            <input id="speakeasy-input" class="input" type="text" placeholder="Ask anything..." required />
            <button class="send" type="submit" aria-label="Send">↑</button>
          </div>
        </form>
      </section>
    </div>
  `;
}
