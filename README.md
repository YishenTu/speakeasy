# Speakeasy

Speakeasy is a Manifest V3 Chrome extension chatbot powered by the Gemini API.
It runs as an in-page overlay on regular websites (`http/https`).

## Tech stack

- Bun (package manager + bundler)
- TypeScript (strict mode)
- `@google/genai` (official Gemini SDK)
- Tailwind CSS
- Biome (lint + formatting)

## Project structure

- `src/background/background.ts`: Gemini backend service (multi-turn sessions, tool loop, storage)
- `src/content/content.ts`: in-page overlay chat UI (content script)
- `src/popup/popup.html`: legacy popup shell (not the primary UI)
- `src/popup/popup.ts`: legacy popup chat surface
- `src/shared/chat.ts`: popup-to-background chat bridge
- `src/shared/runtime.ts`: runtime message contracts
- `src/shared/settings.ts`: Gemini settings schema and normalization
- `src/options/options.html`: options page UI for Gemini settings
- `src/options/options.ts`: options page logic and validation
- `src/manifest.json`: extension manifest source
- `scripts/build.ts`: produces loadable extension output in `dist/`
- `scripts/test-gemini.ts`: live Gemini API format verifier using `.env`

## Setup

```bash
bun install
```

Add a `.env` file in project root:

```bash
GEMINI_API_KEY=your-real-gemini-key
```

## Commands

```bash
bun run dev
bun run lint
bun run typecheck
bun run build
bun run test:gemini
```

`bun run dev` watches source files and rebuilds `dist/` automatically.
`bun run build` outputs a complete unpacked extension in `dist/`.
`bun run test:gemini` verifies request formats against Gemini using `gemini-3-flash-preview`.

## Chat backend behavior

- Multi-turn history is persisted in `chrome.storage.local` using a generated `chatId`.
- Model `content.parts` are preserved as-is between turns (including `thoughtSignature`).
- Gemini calls are made through the official `@google/genai` SDK (`models.generateContent`).
- Runtime supports both native Gemini tools and function calling, with compatibility checks.
- Sessions are capped and pruned to keep extension storage bounded.

## Overlay behavior

- Toolbar click (or command shortcut) toggles the in-page Speakeasy overlay.
- Overlay can open settings, start a new chat, and resume prior multi-turn history.
- Overlay currently injects on `http://*/*` and `https://*/*` pages.

## Tooling notes

- Native tools exposed in settings: Google Search, Code Execution, URL Context, Google Maps, File Search, MCP Servers.
- Function calling (local tool execution loop) is supported in a separate mode.
- Function calling and native tools are blocked together in `generateContent`.
- File Search requires one or more configured `fileSearchStores/...` names.
- Computer Use is listed but intentionally blocked in this runtime (requires separate action/screenshot loop).

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.

## Keyboard shortcut

The extension uses `_execute_action` with suggested keys:

- Windows/Linux: `Ctrl+Shift+Space`
- macOS: `Command+Shift+Space`

If Chrome blocks the default shortcut, set it manually at `chrome://extensions/shortcuts`.
