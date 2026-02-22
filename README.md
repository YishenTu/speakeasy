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
- `src/chatpanel/chatpanel.ts`: in-page chat panel UI (content script)
- `src/shared/chat.ts`: chatpanel-to-background chat bridge
- `src/shared/runtime.ts`: runtime message contracts
- `src/shared/settings.ts`: Gemini settings schema and normalization
- `src/options/options.html`: options page UI for Gemini settings
- `src/options/options.ts`: options page logic and validation
- `src/manifest.json`: extension manifest source
- `scripts/build.ts`: produces loadable extension output in `dist/`
- `scripts/test-gemini.ts`: live Gemini API format verifier using `.env`
- `.dependency-cruiser.cjs`: import-boundary and circular-dependency rules

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
bun run deps:check
bun run lint
bun run typecheck
bun run build
bun run test:unit
bun run test:contract
bun run verify
bun run test:gemini:canary
```

`bun run dev` watches source files and rebuilds `dist/` automatically.
`bun run deps:check` enforces module boundaries and blocks circular imports.
`bun run build` outputs a complete unpacked extension in `dist/`.
`bun run test:unit` runs deterministic unit tests from `tests/unit`.
`bun run test:contract` runs deterministic request-shape contract tests from `tests/contract`.
`bun run verify` is the canonical local/CI gate:
`deps:check -> lint -> typecheck -> build -> test:unit -> test:contract`.
`bun run test:gemini:canary` runs the live Gemini API canary using `gemini-3-flash-preview`.

## CI policy

- Pull requests are merge-blocked by the required `quality-gate` check.
- `quality-gate` runs `bun run verify` and never performs live Gemini API calls.
- Live Gemini validation is isolated to the `gemini-canary` workflow on `main` only.
- `gemini-canary` runs daily (UTC) and supports manual `workflow_dispatch`.
- `gemini-canary` is informational and is not a required PR status check.

## Testing policy

- Unit and contract tests must stay deterministic and offline.
- External network/API calls are disallowed in PR CI and local deterministic suites.
- The only allowed live Gemini check is `test:gemini:canary` in the canary workflow.

## Dependency direction

- `src/shared` can only depend on `src/shared`.
- `src/background` can depend on `src/shared`, never on `src/chatpanel` or `src/options`.
- `src/chatpanel` can depend on `src/shared`, never on `src/background` or `src/options`.
- `src/options` can depend on `src/shared`, never on `src/background` or `src/chatpanel`.
- Circular dependencies are forbidden globally.

## Chat backend behavior

- Multi-turn history is persisted in browser-managed IndexedDB (`speakeasy-chat`), keyed by `chatId`.
- Conversation continuity uses Gemini interaction chaining via `previous_interaction_id` and persisted `lastInteractionId`.
- Model `content.parts` are preserved as-is between turns (including tool outputs and attachments).
- Gemini calls are made through the official `@google/genai` SDK (`interactions.create`).
- Runtime supports both native Gemini tools and function calling, with compatibility checks.
- Sessions are retained with a 30-day TTL and pruned automatically.

## Overlay behavior

- Toolbar click (or command shortcut) toggles the in-page Speakeasy overlay.
- Overlay can open settings, start a new chat, switch chats from a history dropdown, and delete a specific session from that dropdown.
- Overlay currently injects on `http://*/*` and `https://*/*` pages.

## Tooling notes

- Native tools exposed in settings: Google Search, Code Execution, URL Context, Google Maps, File Search, MCP Servers.
- Function calling (local tool execution loop) is supported in a separate mode.
- Function calling and native tools are blocked together in `interactions.create`.
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
