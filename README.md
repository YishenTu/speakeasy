# Speakeasy

Speakeasy is a Manifest V3 Chrome extension scaffold for an AI chatbot popup.

## Tech stack

- Bun (package manager + bundler)
- TypeScript (strict mode)
- Tailwind CSS
- Biome (lint + formatting)

## Project structure

- `src/background/background.ts`: background service worker entry
- `src/popup/popup.html`: popup shell
- `src/popup/popup.ts`: chat UI skeleton and placeholder message handling
- `src/shared/chat.ts`: placeholder `sendMessage` function for future AI wiring
- `src/options/options.html`: options page placeholder
- `src/options/options.ts`: options script
- `src/manifest.json`: extension manifest source
- `scripts/build.ts`: produces loadable extension output in `dist/`

## Setup

```bash
bun install
```

## Commands

```bash
bun run lint
bun run typecheck
bun run build
```

`bun run build` outputs a complete unpacked extension in `dist/`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.

## Keyboard shortcut

The extension uses `_execute_action` with suggested keys:

- Windows/Linux: `Ctrl+Shift+Space`
- macOS: `Command+Shift+Space`

If Chrome blocks the default shortcut, set it manually at `chrome://extensions/shortcuts`.

## Notes

`src/shared/chat.ts` currently contains a placeholder `sendMessage` implementation and does not call any AI backend.
