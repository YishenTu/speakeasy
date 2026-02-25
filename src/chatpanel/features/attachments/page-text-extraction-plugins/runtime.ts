const PAGE_TEXT_EXTRACTION_PLUGIN_MODULE_PATHS = [
  'plugins/page-text-extraction/index.local.js',
  'plugins/page-text-extraction/index.shared.js',
] as const;

export interface PageTextExtractionPreprocessInput {
  sourceHtml: string;
  sourceUrl: string;
  parseHtmlToDocument: (html: string) => Document;
}

export interface PageTextExtractionPreprocessPlugin {
  id: string;
  matches: (sourceUrl: string) => boolean;
  preprocess: (input: PageTextExtractionPreprocessInput) => string;
}

interface ResolvePageTextPreprocessSourceHtmlDependencies {
  loadPlugins?: () => Promise<unknown>;
}

let cachedPluginsPromise: Promise<ReadonlyArray<PageTextExtractionPreprocessPlugin>> | null = null;

export async function resolvePageTextPreprocessSourceHtml(
  dependencies: ResolvePageTextPreprocessSourceHtmlDependencies = {},
): Promise<(input: PageTextExtractionPreprocessInput) => string> {
  const plugins = await resolvePlugins(dependencies.loadPlugins);
  return (input: PageTextExtractionPreprocessInput) =>
    preprocessSourceHtmlWithPlugins(input, plugins);
}

export function preprocessSourceHtmlWithPlugins(
  input: PageTextExtractionPreprocessInput,
  plugins: ReadonlyArray<PageTextExtractionPreprocessPlugin>,
): string {
  const plugin = resolveMatchingPlugin(input.sourceUrl, plugins);
  if (!plugin) {
    return input.sourceHtml;
  }

  try {
    const preprocessedHtml = plugin.preprocess(input);
    if (!preprocessedHtml.trim()) {
      return input.sourceHtml;
    }
    return preprocessedHtml;
  } catch (error: unknown) {
    console.warn(
      `[speakeasy] page text extraction plugin "${plugin.id}" failed: ${toErrorMessage(error)}`,
    );
    return input.sourceHtml;
  }
}

async function resolvePlugins(
  loadPluginsOverride: (() => Promise<unknown>) | undefined,
): Promise<ReadonlyArray<PageTextExtractionPreprocessPlugin>> {
  if (loadPluginsOverride) {
    const loadedPlugins = await loadPluginsOverride();
    return normalizePluginsFromUnknown(loadedPlugins);
  }

  if (!cachedPluginsPromise) {
    cachedPluginsPromise = loadPluginsFromExtensionBundle();
  }

  const plugins = await cachedPluginsPromise;
  if (plugins.length === 0) {
    cachedPluginsPromise = null;
  }
  return plugins;
}

async function loadPluginsFromExtensionBundle(): Promise<
  ReadonlyArray<PageTextExtractionPreprocessPlugin>
> {
  const moduleUrls = resolvePageTextPluginModuleUrls();
  if (moduleUrls.length === 0) {
    return [];
  }

  const plugins: PageTextExtractionPreprocessPlugin[] = [];
  for (const moduleUrl of moduleUrls) {
    try {
      const moduleValue = await import(moduleUrl);
      plugins.push(...normalizePluginsFromUnknown(moduleValue));
    } catch {
      // Local plugin modules are optional by design.
    }
  }

  return plugins;
}

function resolvePageTextPluginModuleUrls(): string[] {
  const getUrl = globalThis.chrome?.runtime?.getURL;
  if (typeof getUrl !== 'function') {
    return [];
  }

  const urls: string[] = [];
  for (const path of PAGE_TEXT_EXTRACTION_PLUGIN_MODULE_PATHS) {
    try {
      const moduleUrl = getUrl(path);
      if (moduleUrl.trim()) {
        urls.push(moduleUrl);
      }
    } catch {
      // Optional paths may be absent.
    }
  }

  return urls;
}

function normalizePluginsFromUnknown(
  input: unknown,
): ReadonlyArray<PageTextExtractionPreprocessPlugin> {
  const candidates = resolvePluginCandidates(input);
  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates.filter(isPageTextExtractionPreprocessPlugin);
}

function resolvePluginCandidates(input: unknown): unknown {
  const moduleRecord = toRecord(input);
  if (!moduleRecord) {
    return input;
  }

  if (Array.isArray(moduleRecord.pageTextExtractionPlugins)) {
    return moduleRecord.pageTextExtractionPlugins;
  }

  if (Array.isArray(moduleRecord.default)) {
    return moduleRecord.default;
  }

  return input;
}

function isPageTextExtractionPreprocessPlugin(
  value: unknown,
): value is PageTextExtractionPreprocessPlugin {
  const plugin = toRecord(value);
  if (!plugin) {
    return false;
  }

  return (
    typeof plugin.id === 'string' &&
    plugin.id.trim().length > 0 &&
    typeof plugin.matches === 'function' &&
    typeof plugin.preprocess === 'function'
  );
}

function resolveMatchingPlugin(
  sourceUrl: string,
  plugins: ReadonlyArray<PageTextExtractionPreprocessPlugin>,
): PageTextExtractionPreprocessPlugin | null {
  for (const plugin of plugins) {
    try {
      if (plugin.matches(sourceUrl)) {
        return plugin;
      }
    } catch (error: unknown) {
      console.warn(
        `[speakeasy] page text extraction plugin "${plugin.id}" match failed: ${toErrorMessage(error)}`,
      );
    }
  }

  return null;
}

function toRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  return input as Record<string, unknown>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}
