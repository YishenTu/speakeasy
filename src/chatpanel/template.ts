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

      .launcher {
        width: 56px;
        height: 56px;
        border: 0;
        border-radius: 16px;
        background:
          radial-gradient(circle at 20% 20%, #22d3ee 0%, rgba(34, 211, 238, 0.6) 35%, transparent 70%),
          linear-gradient(155deg, #0f172a 0%, #111827 52%, #1f2937 100%);
        color: #e2e8f0;
        cursor: pointer;
        box-shadow: 0 16px 38px rgba(2, 6, 23, 0.45), inset 0 0 0 1px rgba(148, 163, 184, 0.28);
        transition: transform 140ms ease, box-shadow 140ms ease;
      }

      .launcher:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 42px rgba(2, 6, 23, 0.5), inset 0 0 0 1px rgba(148, 163, 184, 0.36);
      }

      .launcher:focus-visible {
        outline: 2px solid #22d3ee;
        outline-offset: 2px;
      }

      .launcher.is-open {
        background:
          radial-gradient(circle at 20% 20%, #14b8a6 0%, rgba(20, 184, 166, 0.62) 35%, transparent 70%),
          linear-gradient(155deg, #0f172a 0%, #111827 52%, #1f2937 100%);
      }

      .launcher-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 600;
      }

      .panel {
        width: min(390px, calc(100vw - 24px));
        height: min(620px, calc(100vh - 96px));
        margin-top: 10px;
        border-radius: 20px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        border: 1px solid rgba(100, 116, 139, 0.42);
        background:
          linear-gradient(170deg, rgba(15, 23, 42, 0.97) 0%, rgba(17, 24, 39, 0.98) 42%, rgba(30, 41, 59, 0.97) 100%);
        box-shadow: 0 26px 72px rgba(2, 6, 23, 0.58), inset 0 1px 0 rgba(148, 163, 184, 0.16);
      }

      .panel[hidden] {
        display: none;
      }

      .top {
        padding: 14px 14px 12px;
        border-bottom: 1px solid rgba(71, 85, 105, 0.52);
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.88) 0%, rgba(15, 23, 42, 0.35) 100%);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .brand-title {
        margin: 0;
        font-size: 15px;
        font-weight: 650;
        letter-spacing: 0.01em;
      }

      .brand-subtitle {
        margin: 2px 0 0;
        font-size: 12px;
        color: #94a3b8;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .control-btn {
        border: 1px solid rgba(71, 85, 105, 0.7);
        background: rgba(15, 23, 42, 0.8);
        color: #cbd5e1;
        border-radius: 10px;
        padding: 6px 9px;
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease;
      }

      .control-btn:hover {
        border-color: rgba(148, 163, 184, 0.8);
        background: rgba(30, 41, 59, 0.82);
      }

      .control-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .messages {
        margin: 0;
        padding: 14px 14px 12px;
        overflow: auto;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .messages::-webkit-scrollbar {
        width: 8px;
      }

      .messages::-webkit-scrollbar-thumb {
        background: rgba(100, 116, 139, 0.6);
        border-radius: 999px;
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
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #64748b;
      }

      .bubble {
        max-width: 84%;
        margin: 0;
        padding: 9px 11px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre-wrap;
      }

      .bubble-user {
        background: linear-gradient(145deg, #14b8a6 0%, #22d3ee 100%);
        color: #082f49;
        box-shadow: inset 0 0 0 1px rgba(6, 78, 59, 0.2);
      }

      .bubble-assistant {
        background: rgba(30, 41, 59, 0.88);
        color: #e2e8f0;
        box-shadow: inset 0 0 0 1px rgba(100, 116, 139, 0.24);
      }

      .composer {
        padding: 12px 12px 14px;
        border-top: 1px solid rgba(71, 85, 105, 0.52);
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.2) 0%, rgba(15, 23, 42, 0.72) 100%);
      }

      .composer[aria-busy="true"] {
        opacity: 0.8;
      }

      .input {
        border: 1px solid rgba(100, 116, 139, 0.7);
        background: rgba(15, 23, 42, 0.82);
        color: #f1f5f9;
        border-radius: 10px;
        padding: 9px 10px;
        font-size: 13px;
      }

      .input::placeholder {
        color: #64748b;
      }

      .input:focus {
        outline: none;
        border-color: #22d3ee;
        box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.2);
      }

      .send {
        border: 0;
        border-radius: 10px;
        padding: 0 13px;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #022c22;
        cursor: pointer;
        background: linear-gradient(145deg, #2dd4bf 0%, #67e8f9 100%);
      }

      .send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @media (max-width: 620px) {
        .shell {
          right: 12px;
          left: 12px;
          bottom: 12px;
        }

        .launcher {
          width: 52px;
          height: 52px;
        }

        .panel {
          width: calc(100vw - 24px);
          height: min(72vh, 560px);
        }
      }
    </style>

    <div class="shell">
      <button id="speakeasy-launcher" class="launcher" type="button" aria-label="Toggle Speakeasy chat">
        <span class="launcher-label">AI</span>
      </button>

      <section id="speakeasy-panel" class="panel" hidden>
        <header class="top">
          <div>
            <h2 class="brand-title">Speakeasy</h2>
            <p class="brand-subtitle">Gemini chat overlay</p>
          </div>
          <div class="controls">
            <button id="speakeasy-settings" class="control-btn" type="button">Settings</button>
            <button id="speakeasy-new-chat" class="control-btn" type="button">New</button>
            <button id="speakeasy-close" class="control-btn" type="button" aria-label="Close">Close</button>
          </div>
        </header>

        <ol id="speakeasy-messages" class="messages"></ol>

        <form id="speakeasy-form" class="composer" autocomplete="off">
          <input id="speakeasy-input" class="input" type="text" placeholder="Ask anything..." required />
          <button class="send" type="submit">Send</button>
        </form>
      </section>
    </div>
  `;
}
