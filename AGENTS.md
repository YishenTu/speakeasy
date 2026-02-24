# Repository Guidelines

## Project Structure & Module Organization
Manifest V3 Chrome extension built with Bun + TypeScript.

- `src/background/`: service worker runtime.
  - `app/`: background lifecycle/runtime wiring.
  - `core/`: reusable background primitives/utilities.
  - `features/`: domain modules (`chat-storage`, `gemini`, `runtime`, `session`, `tab`, `uploads`).
  - Root `background.ts` is entrypoint-only.
- `src/chatpanel/`: in-page overlay UI/content script.
  - `app/`: chatpanel bootstrap/composition.
  - `core/`: reusable chatpanel primitives/utilities.
  - `features/`: domain modules (`attachments`, `composer`, `conversation`, `history`, `layout`, `messages`, `mentions`, `preview`).
  - `template/`: chatpanel Shadow DOM templates/styles.
  - Root `chatpanel.ts` is entrypoint-only; root `template.ts` is template-entrypoint-only.
- `src/options/`: options page UI, form state, validation.
- `src/shared/`: cross-layer contracts (`runtime.ts`), settings schema, chat bridge.
- `tests/unit/`: deterministic unit tests.
- `tests/contract/`: request-shape/contract tests.
- `scripts/`: build/dev/canary scripts.
- `dist/`: build output.

Respect boundaries from `.dependency-cruiser.cjs`: `shared` <- (`background` | `chatpanel` | `options`), no circular imports.
For background internals, follow: `app -> (features|core|shared)`, `features -> (core|shared)`, `core -> shared`.
For chatpanel internals, follow: `app -> (features|core|template)`, `features -> (core|shared)`, `core -> shared`.

## Build, Test, and Development Commands
- `bun run dev`: watch/rebuild extension artifacts.
- `bun run build`: generate `dist/`.
- `bun run deps:check`: enforce import boundaries.
- `bun run lint` / `bun run format`: Biome lint/format.
- `bun run typecheck`: TypeScript check.
- `bun run test:unit`: run unit tests (`tests/unit`).
- `bun run test:contract`: run contract tests (`tests/contract`).
- `bun run verify`: full local quality gate (CI-equivalent).

## Coding Style & Naming Conventions
- TypeScript strict mode; prefer explicit, small modules.
- Biome formatting/linting (`2` spaces, single quotes, semicolons, line width `100`).
- Use kebab-case files (for example `form-state.ts`) and `*.test.ts` for tests.
- Keep comments focused on intent/constraints, not restating code.

## Styling Conventions
- Treat `options` and `chatpanel` as separate styling systems:
  - `options` uses Tailwind output from `src/styles/tailwind.css` -> `dist/ui.css`.
  - `chatpanel` uses Shadow DOM-local CSS inside `src/chatpanel/template.ts`.
- For `options` styles:
  - Prefer semantic component classes in `@layer components` (for example `settings-*`) over repeating long utility strings in `options.html`.
  - Keep one-off layout tweaks inline only when they are truly local and non-reusable.
  - Reuse tokens from `tailwind.config.js` (colors, fonts) instead of hardcoded ad-hoc values.
- For `chatpanel` styles:
  - Keep class names stable because runtime code queries and toggles them (`classList`, selectors in `features/messages/message-renderer.ts`, `app/bootstrap.ts`, `features/composer/input-toolbar.ts`).
  - Prefer consolidating repeated values with `:host` CSS variables (prefix `--sp-`) and shared selector blocks for repeated control patterns.
  - Do not move chatpanel styles into `tailwind.css`; Shadow DOM styles are intentionally self-contained.
- When refactoring styles, preserve behavior and visual parity unless a visual change is explicitly requested.

## Testing Guidelines
- Framework: `bun:test`.
- TDD is mandatory for all behavior changes and bug fixes.
- Follow `Red -> Green -> Refactor`: failing test first, minimal fix, safe refactor.
- Every bug fix must include a regression test that fails before the fix and passes after it.
- Keep unit + contract tests deterministic and offline.
- Mock Chrome APIs and network calls in tests; do not call external services.
- Place tests under `tests/unit/**/*.test.ts` or `tests/contract/**/*.test.ts` matching the module being changed.
- Run `bun run test:unit && bun run test:contract` locally before opening a PR.
- Run `bun test --coverage tests/unit tests/contract` for non-trivial changes and avoid coverage regressions in touched modules.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history: `feat: ...`, `refactor: ...`, `chore: ...`.
- Keep commit messages imperative and scoped to one logical change.
- PRs should include a concise summary, testing evidence (commands + added/updated tests), linked issue if applicable, and screenshots/GIFs for UI changes in `chatpanel` or `options`.
- Ensure `quality-gate` CI passes (`bun run verify`).
- Use GitHub CLI (`gh`) for all GitHub-related actions (for example: PRs, issues, checks, and merges).
- When merging a PR, always use squash merge and provide an appropriate final commit message.
- User workflow preference: when the user says "merge", treat it as a GitHub merge via `gh pr merge` (not a local `git merge`) unless they explicitly ask for a local merge.
- After a GitHub merge, sync local state by pulling `main` from `origin`.

## Security & Configuration Tips
- Store secrets in `.env` (e.g., `GEMINI_API_KEY`); never commit credentials.
- Live API checks belong to canary workflow, not deterministic test suites.
