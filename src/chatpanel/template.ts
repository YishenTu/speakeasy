export function getChatPanelTemplate(): string {
  return `
    <style>
      :host {
        all: initial;
        --sp-color-shell: #f8fafc;
        --sp-color-text-primary: rgba(255, 255, 255, 0.95);
        --sp-color-text-default: rgba(255, 255, 255, 0.85);
        --sp-color-text-secondary: rgba(255, 255, 255, 0.66);
        --sp-color-text-muted: rgba(255, 255, 255, 0.5);
        --sp-color-text-dim: rgba(255, 255, 255, 0.42);
        --sp-color-border-base: rgba(255, 255, 255, 0.1);
        --sp-color-border-focus: rgba(255, 255, 255, 0.55);
        --sp-color-surface-panel: rgba(12, 12, 12, 0.8);
        --sp-color-surface-overlay: rgba(18, 18, 18, 0.94);
        --sp-color-surface-subtle: rgba(255, 255, 255, 0.04);
        --sp-color-surface-hover: rgba(255, 255, 255, 0.08);
        --sp-radius-panel: 8px;
        --sp-radius-md: 6px;
        --sp-radius-sm: 4px;
        --sp-font-size-xs: 11px;
        --sp-font-size-sm: 12px;
        --sp-action-icon-size: 14px;
        --sp-composer-top-gap: 12px;
        --sp-messages-bottom-clearance: 32px;
        --sp-message-actions-clearance: 16px;
        --sp-transition-fast: 120ms ease;
        --sp-transition-medium: 150ms ease;
      }

      .shell {
        position: fixed;
        top: 18px;
        left: 18px;
        width: min(390px, calc(100vw - 24px));
        height: min(620px, calc(100vh - 96px));
        z-index: 2147483647;
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        color: var(--sp-color-shell);
        box-sizing: border-box;
      }

      .shell[hidden] {
        display: none;
      }

      .panel {
        width: 100%;
        height: 100%;
        position: relative;
        border-radius: var(--sp-radius-panel);
        overflow: hidden;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        border: 1px solid var(--sp-color-border-base);
        background: var(--sp-color-surface-panel);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: none;
      }

      .top {
        padding: 14px 16px;
        border-bottom: none;
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
        font-family: 'Avenir Next', 'SF Pro Text', 'Segoe UI', sans-serif;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.01em;
        text-transform: none;
        color: var(--sp-color-text-default);
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
        position: relative;
      }

      .control-wrap {
        position: relative;
      }

      .icon-btn {
        border: none;
        background: transparent;
        color: var(--sp-color-text-secondary);
        border-radius: var(--sp-radius-panel);
        width: 28px;
        height: 28px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
          color var(--sp-transition-fast),
          border-color var(--sp-transition-fast),
          background var(--sp-transition-fast);
      }

      .icon-btn svg {
        width: 14px;
        height: 14px;
        stroke: currentColor;
        fill: none;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .controls,
      .icon-btn {
        user-select: auto;
        touch-action: manipulation;
      }

      .icon-btn:hover,
      .control-wrap.open .icon-btn {
        color: var(--sp-color-text-primary);
      }

      .icon-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .history-menu {
        display: none;
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: min(300px, 58vw);
        max-height: 260px;
        overflow: auto;
        z-index: 16;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: var(--sp-radius-panel);
        background: var(--sp-color-surface-overlay);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        padding: 4px;
      }

      .control-wrap.open .history-menu {
        display: block;
      }

      .history-item {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .history-item-main {
        flex: 1;
        width: 100%;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.82);
        text-align: left;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px;
        border-radius: var(--sp-radius-md);
        cursor: pointer;
        font-size: var(--sp-font-size-xs);
      }

      .history-item-main:hover {
        background: var(--sp-color-surface-hover);
      }

      .history-item-main:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .history-item-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .history-item-meta {
        color: var(--sp-color-text-muted);
        flex-shrink: 0;
      }

      .history-item-main.history-item-active .history-item-title {
        color: rgba(255, 255, 255, 0.98);
      }

      .history-item-delete {
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.58);
        border-radius: 0;
        width: auto;
        height: auto;
        margin-right: 4px;
        padding: 0;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .history-item-delete:hover {
        color: rgba(255, 255, 255, 0.92);
        background: transparent;
      }

      .history-item-delete:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .history-empty {
        padding: 8px;
        color: var(--sp-color-text-muted);
        font-size: var(--sp-font-size-xs);
      }

      .delete-confirm-overlay {
        position: absolute;
        inset: 0;
        z-index: 22;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(5, 5, 5, 0.54);
      }

      .delete-confirm-overlay[hidden] {
        display: none;
      }

      .delete-confirm-dialog {
        width: min(320px, 100%);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: var(--sp-radius-panel);
        background: var(--sp-color-surface-overlay);
        color: var(--sp-color-text-default);
        padding: 14px;
      }

      .delete-confirm-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
      }

      .delete-confirm-skip {
        margin-top: 10px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--sp-color-text-secondary);
        font-size: var(--sp-font-size-xs);
      }

      .delete-confirm-skip input {
        margin: 0;
      }

      .delete-confirm-actions {
        margin-top: 12px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .delete-confirm-btn {
        border: 1px solid var(--sp-color-border-base);
        background: transparent;
        color: var(--sp-color-text-default);
        border-radius: var(--sp-radius-md);
        padding: 6px 10px;
        font-size: var(--sp-font-size-xs);
        cursor: pointer;
      }

      .delete-confirm-btn:hover {
        background: var(--sp-color-surface-hover);
      }

      .delete-confirm-btn-danger {
        border-color: rgba(239, 68, 68, 0.55);
        color: rgba(254, 202, 202, 0.98);
        background: rgba(239, 68, 68, 0.12);
      }

      .delete-confirm-btn-danger:hover {
        background: rgba(239, 68, 68, 0.2);
      }

      .messages {
        margin: 0;
        padding: 16px 16px var(--sp-messages-bottom-clearance);
        overflow: auto;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
        scroll-behavior: smooth;
      }

      .messages::-webkit-scrollbar {
        width: 4px;
      }

      .messages::-webkit-scrollbar-thumb {
        background: var(--sp-color-border-base);
        border-radius: 0;
      }

      .messages::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .row {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .row-with-actions {
        padding-bottom: var(--sp-message-actions-clearance);
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
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .bubble-user {
        background: #000;
        color: var(--sp-color-text-primary);
        border-radius: var(--sp-radius-panel);
      }

      .bubble-assistant {
        width: calc(100% + 28px);
        max-width: calc(100% + 28px);
        box-sizing: border-box;
        background: transparent;
        color: var(--sp-color-text-default);
        margin: 0 -14px;
      }

      .message-text {
        margin: 0;
      }

      .message-thinking-placeholder {
        color: rgba(255, 255, 255, 0.56);
        display: inline-flex;
        align-items: baseline;
        gap: 0;
      }

      .thinking-placeholder-dots {
        display: inline-flex;
      }

      .thinking-placeholder-dot {
        display: inline-block;
        min-width: 0.34ch;
        opacity: 0.24;
        animation: thinking-dot-pulse 1.2s ease-in-out infinite;
      }

      .thinking-placeholder-dot:nth-child(2) {
        animation-delay: 0.16s;
      }

      .thinking-placeholder-dot:nth-child(3) {
        animation-delay: 0.32s;
      }

      @keyframes thinking-dot-pulse {
        0%,
        80%,
        100% {
          opacity: 0.24;
        }
        40% {
          opacity: 0.88;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .thinking-placeholder-dot {
          animation: none;
          opacity: 0.56;
        }
      }

      .message-text > * {
        margin: 0 0 8px;
      }

      .message-text > *:last-child {
        margin-bottom: 0;
      }

      .message-text p {
        white-space: pre-wrap;
      }

      .message-text h1,
      .message-text h2,
      .message-text h3,
      .message-text h4,
      .message-text h5,
      .message-text h6 {
        line-height: 1.35;
        font-weight: 600;
      }

      .message-text h1 {
        font-size: 1.12em;
      }

      .message-text h2 {
        font-size: 1.08em;
      }

      .message-text h3,
      .message-text h4,
      .message-text h5,
      .message-text h6 {
        font-size: 1.02em;
      }

      .message-text ul,
      .message-text ol {
        padding-left: 18px;
      }

      .message-text li {
        margin: 4px 0;
      }

      .message-text li > input[type='checkbox'] {
        margin: 0 6px 0 0;
        vertical-align: middle;
      }

      .message-text blockquote {
        margin: 0;
        padding-left: 10px;
        border-left: 2px solid rgba(255, 255, 255, 0.24);
        color: rgba(255, 255, 255, 0.74);
      }

      .message-text code {
        font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, monospace;
        font-size: var(--sp-font-size-sm);
        background: rgba(255, 255, 255, 0.1);
        border-radius: var(--sp-radius-sm);
        padding: 1px 4px;
      }

      .message-text pre {
        position: relative;
        margin: 0 0 8px;
        overflow-x: hidden;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 0;
        background: rgba(255, 255, 255, 0.06);
        padding: 10px;
        overflow-wrap: anywhere;
      }

      .message-text pre .code-lang {
        position: absolute;
        top: 0;
        right: 0;
        padding: 2px 8px;
        font-family: inherit;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        user-select: none;
        line-height: 1.5;
        transition: color var(--sp-transition-fast);
      }

      .message-text pre .code-lang:hover {
        color: rgba(255, 255, 255, 0.8);
      }

      .message-text pre:last-child {
        margin-bottom: 0;
      }

      .message-text pre code {
        background: transparent;
        border-radius: 0;
        padding: 0;
        display: block;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .message-text pre code.hljs {
        color: rgba(235, 239, 255, 0.94);
      }

      .message-text pre code .hljs-comment,
      .message-text pre code .hljs-quote {
        color: rgba(255, 255, 255, 0.38);
        font-style: italic;
      }

      .message-text pre code .hljs-keyword,
      .message-text pre code .hljs-selector-tag,
      .message-text pre code .hljs-subst {
        color: #c792ea;
      }

      .message-text pre code .hljs-built_in,
      .message-text pre code .hljs-type,
      .message-text pre code .hljs-params,
      .message-text pre code .hljs-meta .hljs-keyword {
        color: #82aaff;
      }

      .message-text pre code .hljs-string,
      .message-text pre code .hljs-regexp,
      .message-text pre code .hljs-symbol,
      .message-text pre code .hljs-bullet,
      .message-text pre code .hljs-template-tag,
      .message-text pre code .hljs-template-variable {
        color: #c3e88d;
      }

      .message-text pre code .hljs-number,
      .message-text pre code .hljs-literal {
        color: #f78c6c;
      }

      .message-text pre code .hljs-title,
      .message-text pre code .hljs-function .hljs-title {
        color: #dcdcaa;
      }

      .message-text pre code .hljs-variable,
      .message-text pre code .hljs-attr {
        color: #f07178;
      }

      .message-text pre code .hljs-attribute,
      .message-text pre code .hljs-name,
      .message-text pre code .hljs-link {
        color: #ffcb6b;
      }

      .message-text pre code .hljs-meta,
      .message-text pre code .hljs-operator,
      .message-text pre code .hljs-tag,
      .message-text pre code .hljs-selector-attr,
      .message-text pre code .hljs-selector-pseudo {
        color: #89ddff;
      }

      .message-text pre code .hljs-deletion {
        color: #ff5370;
      }

      .message-text table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        border-spacing: 0;
      }

      .message-text th,
      .message-text td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.16);
        overflow-wrap: anywhere;
        vertical-align: top;
      }

      .message-text thead th {
        border-bottom: 1px solid rgba(255, 255, 255, 0.3);
        font-weight: 600;
      }

      .message-text hr {
        border: 0;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
      }

      .message-text a {
        color: rgba(181, 224, 255, 0.98);
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .message-text a:hover {
        color: rgba(228, 242, 255, 0.98);
      }

      .message-text math[display='block'] {
        display: block;
        width: fit-content;
        max-width: 100%;
        margin: 0 auto 8px;
        overflow: hidden;
      }

      .message-text math[display='block']:last-child {
        margin-bottom: 0;
      }

      .message-text math[display='block'] mtable[columnalign='right left'] {
        display: inline-table;
        border-collapse: collapse;
      }

      .message-text math[display='block'] mtable[columnalign='right left'] mtd:nth-child(1) {
        text-align: right;
        padding-right: 0.16em;
      }

      .message-text math[display='block'] mtable[columnalign='right left'] mtd:nth-child(2) {
        text-align: left;
        padding-left: 0.16em;
      }

      .thinking-disclosure {
        margin: 8px 0 10px;
        border: 0;
        padding: 0;
        background: transparent;
      }

      .thinking-disclosure-label {
        cursor: pointer;
        font-size: var(--sp-font-size-xs);
        font-weight: 600;
        color: rgba(255, 255, 255, 0.82);
        user-select: none;
        list-style: none;
      }

      .thinking-disclosure-label::-webkit-details-marker {
        display: none;
      }

      .thinking-disclosure-label::marker {
        content: '';
      }

      .thinking-summary {
        margin: 8px 0 6px;
        padding: 0 0 0 10px;
        border-left: 1px solid rgba(255, 255, 255, 0.22);
        font-size: var(--sp-font-size-sm);
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.68);
      }

      .thinking-summary > * {
        margin: 0 0 6px;
      }

      .thinking-summary > *:last-child {
        margin-bottom: 0;
      }

      .thinking-summary a {
        color: rgba(173, 216, 245, 0.96);
      }

      .thinking-summary a:hover {
        color: rgba(209, 230, 247, 0.98);
      }

      .thinking-summary blockquote {
        color: rgba(255, 255, 255, 0.66);
      }

      .thinking-summary .code-lang {
        color: rgba(255, 255, 255, 0.56);
      }

      .thinking-summary .code-lang:hover {
        color: rgba(255, 255, 255, 0.84);
      }

      .thinking-summary p {
        font-size: var(--sp-font-size-sm);
        white-space: pre-wrap;
      }

      .message-stats {
        margin: 0;
        border: 0;
        padding: 0;
        position: static;
      }

      .message-stats-trigger,
      .message-action-btn {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        min-width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--sp-color-text-dim);
        transition:
          color var(--sp-transition-fast),
          background-color var(--sp-transition-fast);
      }

      .message-stats-trigger {
        list-style: none;
        user-select: none;
      }

      .message-stats-trigger:hover,
      .message-action-btn:hover {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.08);
      }

      .message-stats-trigger:focus-visible,
      .message-action-btn:focus-visible {
        outline: 1px solid var(--sp-color-border-focus);
        outline-offset: 1px;
      }

      .message-action-icon {
        width: var(--sp-action-icon-size);
        height: var(--sp-action-icon-size);
        display: block;
      }

      .message-timestamp {
        margin-left: auto;
        font-size: var(--sp-font-size-xs);
        color: var(--sp-color-text-muted);
        white-space: nowrap;
      }

      .message-stats-trigger::-webkit-details-marker {
        display: none;
      }

      .message-stats-trigger::marker {
        content: '';
      }

      .message-stats[open] .message-stats-trigger {
        color: rgba(255, 255, 255, 0.96);
      }

      .message-stats-panel {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        z-index: 12;
        display: grid;
        gap: 4px;
        width: auto;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: var(--sp-color-surface-subtle);
        border-radius: var(--sp-radius-md);
        padding: 8px 10px;
      }

      .message-stats-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        font-size: var(--sp-font-size-xs);
        line-height: 1.35;
      }

      .message-stats-label {
        color: rgba(255, 255, 255, 0.62);
      }

      .message-stats-value {
        color: rgba(255, 255, 255, 0.9);
        text-align: right;
        white-space: nowrap;
      }

      .message-actions {
        margin-top: 0;
        position: absolute;
        top: calc(100% - var(--sp-message-actions-clearance));
        left: 0;
        right: 0;
        z-index: 2;
        display: flex;
        width: 100%;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        line-height: 1;
        opacity: 0;
        transform: translateY(1px);
        pointer-events: none;
        transition: opacity var(--sp-transition-fast), transform var(--sp-transition-fast);
      }

      .message-actions-assistant {
        margin-top: 0;
        justify-content: flex-start;
      }

      .message-actions-user {
        justify-content: flex-end;
      }

      .row-assistant:hover .message-actions-assistant,
      .row-assistant:focus-within .message-actions-assistant,
      .row-assistant .message-actions-assistant:hover,
      .row-user:hover .message-actions-user,
      .row-user:focus-within .message-actions-user,
      .row-user .message-actions-user:hover {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }

      .message-branch-switch {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        border: 0;
        padding: 0;
        font-size: var(--sp-action-icon-size);
        font-family: 'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
        line-height: 1;
      }

      .message-branch-indicator {
        color: var(--sp-color-text-dim);
        font-family: inherit;
        user-select: none;
      }

      .message-branch-nav {
        appearance: none;
        border: 0;
        background: transparent;
        box-shadow: none;
        color: var(--sp-color-text-dim);
        font-size: inherit;
        font-family: inherit;
        line-height: 1;
        padding: 0;
        margin: 0;
        cursor: pointer;
        transition: color var(--sp-transition-fast);
      }

      .message-branch-nav:not(:disabled):hover {
        color: rgba(255, 255, 255, 0.9);
      }

      .message-branch-nav:disabled {
        color: var(--sp-color-text-dim);
        opacity: 0.45;
        cursor: default;
      }

      .message-branch-nav:focus,
      .message-branch-nav:focus-visible {
        outline: none;
      }

      .message-copy-btn.is-copied {
        color: rgba(255, 255, 255, 0.96);
      }

      .message-copy-btn.is-copy-failed {
        color: #ff8e8e;
      }

      .attachment-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .message-text + .attachment-list,
      .thinking-disclosure + .attachment-list,
      .attachment-list + .message-text {
        margin-top: 8px;
      }

      .message-text + .message-stats,
      .thinking-disclosure + .message-stats,
      .attachment-list + .message-stats {
        margin-top: 8px;
      }

      .attachment-image {
        max-width: min(280px, 100%);
        max-height: 220px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        object-fit: cover;
      }

      .attachment-placeholder {
        display: inline-flex;
        max-width: 100%;
        width: fit-content;
        font-size: var(--sp-font-size-xs);
        color: rgba(255, 255, 255, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: var(--sp-radius-md);
        padding: 6px 8px;
        background: rgba(255, 255, 255, 0.05);
        word-break: break-word;
      }

      .composer {
        padding: 0 14px;
        margin-top: var(--sp-composer-top-gap);
        margin-bottom: 8px;
        background: transparent;
      }

      .composer-inner {
        display: flex;
        flex-direction: column;
        background: transparent;
        border: 1px solid var(--sp-color-border-base);
        border-radius: var(--sp-radius-panel);
        padding: 0 4px;
        transition: border-color var(--sp-transition-medium), background var(--sp-transition-medium);
      }

      .composer-row {
        display: flex;
        align-items: flex-end;
        gap: 2px;
      }

      .attach-btn,
      .dropup-trigger {
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.35);
        padding: 0;
        border-radius: 0;
        cursor: pointer;
        transition: color var(--sp-transition-fast);
      }

      .attach-btn {
        width: auto;
        min-width: 0;
        height: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .attach-btn:hover {
        color: rgba(255, 255, 255, 0.95);
      }

      .attach-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .attach-icon {
        width: 16px;
        height: 16px;
      }

      .file-preview-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 6px 8px 0;
      }

      .file-preview-strip:empty {
        display: none;
        margin: 0;
      }

      .file-preview-item {
        width: 82px;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }

      .message-attachment-strip {
        margin: 0 0 4px;
        max-width: 85%;
      }

      .row-user > .message-attachment-strip {
        align-self: flex-end;
        justify-content: flex-end;
      }

      .file-preview-tile {
        position: relative;
        width: 64px;
        height: 64px;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.08);
      }

      .file-preview-tile.is-failed {
        border-color: rgba(255, 120, 120, 0.82);
      }

      .file-preview-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .file-preview-remove {
        position: absolute;
        top: 3px;
        right: 3px;
        border: 0;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        line-height: 1;
        z-index: 2;
      }

      .file-preview-remove:hover {
        background: rgba(0, 0, 0, 0.78);
      }

      .file-preview-upload-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.45);
      }

      .file-preview-spinner {
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: rgba(255, 255, 255, 0.95);
        animation: file-preview-spin 0.8s linear infinite;
      }

      .file-preview-failed {
        position: absolute;
        left: 4px;
        bottom: 4px;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(185, 44, 44, 0.92);
        color: rgba(255, 255, 255, 0.95);
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }

      .file-preview-generic {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 6px 4px;
        background: linear-gradient(160deg, rgba(44, 47, 58, 0.95), rgba(25, 27, 35, 0.95));
      }

      .file-preview-generic.is-pdf {
        background: linear-gradient(160deg, rgba(94, 33, 33, 0.96), rgba(66, 24, 24, 0.96));
        padding: 0;
      }

      .file-preview-filetype {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 30px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.96);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
        line-height: 1;
        padding: 3px 6px;
      }

      .file-preview-name {
        width: 100%;
        color: rgba(255, 255, 255, 0.88);
        font-size: 10px;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: center;
      }

      .file-preview-generic.is-pdf .file-preview-filetype {
        border: none;
        background: transparent;
        padding: 0;
        min-width: 0;
      }

      @keyframes file-preview-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .input-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px 4px;
      }

      .input-toolbar-label {
        font-size: var(--sp-font-size-xs);
        color: rgba(255, 255, 255, 0.5);
        user-select: none;
      }

      .input-toolbar .attach-btn {
        margin-left: auto;
      }

      .dropup {
        position: relative;
      }

      .dropup-trigger {
        font-family: inherit;
        font-size: var(--sp-font-size-xs);
        outline: none;
      }

      .dropup-trigger:hover,
      .dropup.open .dropup-trigger {
        color: rgba(255, 255, 255, 0.95);
      }

      .dropup-menu {
        display: none;
        position: absolute;
        bottom: calc(100% + 4px);
        left: 0;
        min-width: 100%;
        background: rgba(24, 24, 24, 0.95);
        border: 1px solid var(--sp-color-border-base);
        border-radius: var(--sp-radius-sm);
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
        font-size: var(--sp-font-size-xs);
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

      .composer.drop-active .composer-inner {
        border-color: rgba(255, 255, 255, 0.55);
        background: rgba(255, 255, 255, 0.06);
      }

      .input {
        flex: 1;
        min-width: 0;
        border: none;
        background: transparent;
        color: var(--sp-color-text-primary);
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
              <div id="speakeasy-history-menu" class="history-menu" role="menu"></div>
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
        </header>

        <ol id="speakeasy-messages" class="messages"></ol>

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
              <button id="speakeasy-attach" class="attach-btn" type="button" aria-label="Attach file">
                <svg class="attach-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M8 12.5L14.8 5.7a3 3 0 1 1 4.2 4.2l-8.6 8.6a5 5 0 1 1-7.1-7.1l9-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </form>
      </section>
      <div id="speakeasy-delete-confirm-overlay" class="delete-confirm-overlay" hidden>
        <section
          class="delete-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="speakeasy-delete-confirm-text">
          <p id="speakeasy-delete-confirm-text" class="delete-confirm-text">Delete this session?</p>
          <label class="delete-confirm-skip" for="speakeasy-delete-confirm-skip">
            <input id="speakeasy-delete-confirm-skip" type="checkbox" />
            Don't ask again
          </label>
          <div class="delete-confirm-actions">
            <button id="speakeasy-delete-confirm-cancel" class="delete-confirm-btn" type="button">
              Cancel
            </button>
            <button
              id="speakeasy-delete-confirm-accept"
              class="delete-confirm-btn delete-confirm-btn-danger"
              type="button">
              Delete
            </button>
          </div>
        </section>
      </div>
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
