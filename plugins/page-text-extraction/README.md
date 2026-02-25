# Page Text Extraction Plugins

This folder is optional and can be local-only.

- If the folder exists, `bun run build` copies it to `dist/plugins`.
- At runtime, Speakeasy loads these plugin indexes in order:
  - `plugins/page-text-extraction/index.local.js` (private, gitignored)
  - `plugins/page-text-extraction/index.shared.js` (committed)
- If no plugin is loaded, Speakeasy silently falls back to the default extraction pipeline.

## Plugin Contract

Each plugin is a plain ESM object:

```js
{
  id: string,
  matches: (sourceUrl: string) => boolean,
  preprocess: ({ sourceHtml, sourceUrl, parseHtmlToDocument }) => string
}
```

`preprocess` receives raw HTML and must return HTML.

## How To Add a Plugin

### Local (Recommended for personal rules)

1. Create a local plugin file like `local-my-site.plugin.js`.
2. Create `index.local.js` and export your local plugins.
3. Run `bun run build` (or `bun run dev`).

`index.local.js` and `local-*.plugin.js` are gitignored by default.

### Shared (Committed)

1. Create a shared plugin file (see `example.plugin.js`).
2. Add it to `index.shared.js`.
3. Keep plugin behavior generic and project-safe.

## Files

- `index.shared.js`: committed plugin entry for shared rules.
- `index.local.js`: private plugin entry (gitignored).
- `example.plugin.js`: plugin interface example.
