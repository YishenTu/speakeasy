# Speakeasy

Speakeasy is a Manifest V3 Chrome extension that injects a Gemini-powered chat overlay into
regular web pages (`http://*/*`, `https://*/*`).

## Current status

- Overlay chat panel is shipped and toggleable via toolbar action or `_execute_action` command.
- Background service worker uses Gemini Interactions API (`@google/genai`) with multi-turn
  continuity (`previous_interaction_id`), streaming deltas, and persisted sessions.
- Conversation history is branch-aware: regenerate, fork, and branch switching are supported.
- File upload flow is wired end-to-end (Gemini Files API upload, attachment metadata, image preview
  persistence).
- Full-page tab screenshot capture is available from the chatpanel toolbar (Chrome debugger API).
- Options page manages API key, model, system instruction, tool toggles, and tool-specific config.
- Deterministic test suites cover unit + contract behavior; live Gemini checks are isolated to
  canary workflow only.

## Tech stack

- Bun (package manager + runtime + build scripts)
- TypeScript (strict mode)
- `@google/genai` (official Gemini SDK)
- Tailwind CSS (options page stylesheet output)
- Biome (lint + formatting)
- dependency-cruiser (import boundaries + circular dependency enforcement)

## Project structure

- `src/background/`: service worker runtime.
  - `app/`: background lifecycle + runtime wiring.
  - `core/`: shared background primitives/utilities.
  - `features/`: domain modules (`chat-storage`, `gemini`, `runtime`, `session`, `tab`, `uploads`).
  - `background.ts`: entrypoint only.
- `src/chatpanel/`: content-script overlay UI.
  - `app/`: chatpanel composition/bootstrap.
  - `core/`: shared chatpanel primitives/utilities.
  - `features/`: domain modules (`attachments`, `composer`, `conversation`, `history`, `layout`, `messages`, `mentions`, `preview`).
  - `template/`: Shadow DOM HTML/CSS templates.
  - `chatpanel.ts`: entrypoint only.
  - `template.ts`: template composition entrypoint only.
- `src/options/`: options page UI, form state, validation.
- `src/shared/`: runtime contracts, settings normalization, chat bridge utilities.
- `scripts/build.ts`: builds TypeScript + Tailwind, copies static assets, sanitizes JS bundles.
- `scripts/dev.ts`: watch mode wrapper around build pipeline.
- `scripts/test-gemini.ts`: live Gemini canary format checker.
- `tests/unit/`: deterministic unit tests.
- `tests/contract/`: deterministic request-shape/contract tests.

## Setup

```bash
bun install
```

`GEMINI_API_KEY` is required for:

- Running the extension against Gemini (set in Speakeasy options UI).
- Running the live canary script locally (`bun run test:gemini` / `bun run test:gemini:canary`).

Optional local `.env` for canary script:

```bash
GEMINI_API_KEY=your-real-gemini-key
```

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Watch + rebuild extension artifacts into `dist/`. |
| `bun run build` | One-shot production build to `dist/`. |
| `bun run deps:check` | Enforce dependency boundaries and no circular imports. |
| `bun run lint` | Run Biome checks. |
| `bun run lint:fix` | Run Biome checks with auto-fixes. |
| `bun run format` | Apply Biome formatting. |
| `bun run format:check` | Check formatting without writing changes. |
| `bun run typecheck` | TypeScript `--noEmit` checks. |
| `bun run test:unit` | Run deterministic unit tests. |
| `bun run test:contract` | Run deterministic contract tests. |
| `bun run verify` | Local/CI quality gate (`deps:check -> lint -> typecheck -> build -> test:unit -> test:contract`). |
| `bun run test:gemini:canary` | Live Gemini canary format test. |
| `bun run test:gemini` | Alias of `test:gemini:canary`. |

## CI policy

- `.github/workflows/ci.yml` runs `quality-gate` (`bun run verify`) on pull requests and pushes to
  `main`.
- `.github/workflows/gemini-canary.yml` runs live Gemini validation daily (UTC) and on
  `workflow_dispatch`, gated to `main`.
- Canary includes transient-network retry logic and is not part of deterministic PR quality checks.

## Testing policy

- Unit + contract suites must remain deterministic and offline.
- External network/API calls are disallowed in local deterministic suites and PR CI checks.
- Live Gemini checks are isolated to canary workflow and explicit canary script runs.

## Dependency direction

- `src/shared` can only depend on `src/shared`.
- `src/background` can depend on `src/shared`, never on `src/chatpanel` or `src/options`.
- `src/chatpanel` can depend on `src/shared`, never on `src/background` or `src/options`.
- `src/options` can depend on `src/shared`, never on `src/background` or `src/chatpanel`.
- Inside `src/background`: `app -> (features|core|shared)`, `features -> (core|shared)`, `core -> shared`.
- `src/background/features` must not depend on `src/background/app`.
- `src/background/core` must not depend on `src/background/app` or `src/background/features`.
- Inside `src/chatpanel`: `app -> (features|core|template)`, `features -> (core|shared)`, `core -> shared`.
- `src/chatpanel/features` must not depend on `src/chatpanel/app` or `src/chatpanel/template`.
- `src/chatpanel/core` must not depend on `src/chatpanel/app`, `src/chatpanel/features`, or `src/chatpanel/template`.
- Circular dependencies are forbidden globally.

## Runtime behavior

- Sessions are persisted in browser-managed IndexedDB and tracked by `chatId`.
- Session branch tree supports assistant regeneration and user forking from earlier turns.
- Sessions use a 30-day TTL and are pruned automatically.
- Assistant metadata includes interaction id, source model, response stats, and attachment preview
  mapping.
- Streaming updates emit text deltas and thinking deltas to the chatpanel during response
  generation.

## Overlay behavior

- In-page panel supports new chat, history list, per-session delete, and settings entrypoint.
- Per-message actions include copy, regenerate response, fork/edit retry, and branch navigation.
- Input toolbar supports model selection, thinking-level selection, and file attachment staging.
- Input toolbar also supports one-click full-page screenshot capture with attachment preview.
- Overlay is injected on `http://*/*` and `https://*/*` pages.

## Tool behavior and constraints

- Native Interactions tools supported: Google Search, Code Execution, URL Context, File Search, MCP
  Servers.
- Local function-calling mode is supported with built-in tools:
  `get_current_time`, `get_extension_info`, `generate_uuid`.
- Function calling cannot be combined with native tools in a single request.
- File Search requires configured store names; MCP servers require configured server URLs.
- Google Maps and Computer Use are visible in settings but blocked in this runtime.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `dist/`.

## Keyboard shortcut

Suggested `_execute_action` keys from manifest:

- Windows/Linux: `Ctrl+Shift+Space`
- macOS: `Command+Shift+Space`

If Chrome blocks the default shortcut, set it at `chrome://extensions/shortcuts`.
