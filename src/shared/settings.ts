export interface GeminiToolSettings {
  googleSearch: boolean;
  googleMaps: boolean;
  codeExecution: boolean;
  urlContext: boolean;
  fileSearch: boolean;
  mcpServers: boolean;
  computerUse: boolean;
  functionCalling: boolean;
}

export const PAGE_TEXT_EXTRACTION_ENGINES = ['defuddle', 'readability'] as const;
export type PageTextExtractionEngine = (typeof PAGE_TEXT_EXTRACTION_ENGINES)[number];
export const DEFAULT_PAGE_TEXT_EXTRACTION_ENGINE: PageTextExtractionEngine = 'defuddle';

export interface GeminiSettings {
  apiKey: string;
  model: string;
  systemInstruction: string;
  storeInteractions: boolean;
  maxToolRoundTrips: number;
  pageTextExtractionEngine: PageTextExtractionEngine;
  tools: GeminiToolSettings;
  fileSearchStoreNames: string[];
  mcpServerUrls: string[];
  mapsLatitude: number | null;
  mapsLongitude: number | null;
  computerUseExcludedActions: string[];
  customModels: string[];
}

export const GEMINI_SETTINGS_STORAGE_KEY = 'geminiSettings';
export const ACTIVE_CHAT_STORAGE_KEY = 'activeChatId';
export const ACTIVE_CHAT_FALLBACK_TAB_SCOPE = 'fallback';
export const CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY = 'chatStorageSchemaVersion';

const DEFAULT_SETTINGS: GeminiSettings = {
  apiKey: '',
  model: 'gemini-3-flash-preview',
  systemInstruction: '',
  storeInteractions: true,
  maxToolRoundTrips: 6,
  pageTextExtractionEngine: DEFAULT_PAGE_TEXT_EXTRACTION_ENGINE,
  tools: {
    googleSearch: true,
    googleMaps: false,
    codeExecution: true,
    urlContext: true,
    fileSearch: false,
    mcpServers: false,
    computerUse: false,
    functionCalling: false,
  },
  fileSearchStoreNames: [],
  mcpServerUrls: [],
  mapsLatitude: null,
  mapsLongitude: null,
  computerUseExcludedActions: [],
  customModels: [],
};

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toBooleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const normalized = item.trim();
    if (!normalized) {
      continue;
    }

    unique.add(normalized);
  }

  return [...unique];
}

function toPageTextExtractionEngineOrDefault(
  value: unknown,
  fallback: PageTextExtractionEngine,
): PageTextExtractionEngine {
  if (typeof value !== 'string') {
    return fallback;
  }

  return PAGE_TEXT_EXTRACTION_ENGINES.includes(value as PageTextExtractionEngine)
    ? (value as PageTextExtractionEngine)
    : fallback;
}

export function parseCommaSeparatedList(raw: string): string[] {
  const unique = new Set<string>();
  for (const segment of raw.split(',')) {
    const value = segment.trim();
    if (value) {
      unique.add(value);
    }
  }

  return [...unique];
}

export function normalizeGeminiSettings(value: unknown): GeminiSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const settings = value as Partial<GeminiSettings> & { tools?: Partial<GeminiToolSettings> };
  const tools: Partial<GeminiToolSettings> =
    settings.tools && typeof settings.tools === 'object' ? settings.tools : {};

  return {
    apiKey: toStringOrEmpty(settings.apiKey).trim(),
    model: toStringOrEmpty(settings.model).trim() || DEFAULT_SETTINGS.model,
    systemInstruction: toStringOrEmpty(settings.systemInstruction).trim(),
    storeInteractions: toBooleanOrDefault(
      settings.storeInteractions,
      DEFAULT_SETTINGS.storeInteractions,
    ),
    maxToolRoundTrips: clampInteger(
      settings.maxToolRoundTrips,
      1,
      20,
      DEFAULT_SETTINGS.maxToolRoundTrips,
    ),
    pageTextExtractionEngine: toPageTextExtractionEngineOrDefault(
      settings.pageTextExtractionEngine,
      DEFAULT_SETTINGS.pageTextExtractionEngine,
    ),
    tools: {
      googleSearch: toBooleanOrDefault(tools.googleSearch, DEFAULT_SETTINGS.tools.googleSearch),
      googleMaps: toBooleanOrDefault(tools.googleMaps, DEFAULT_SETTINGS.tools.googleMaps),
      codeExecution: toBooleanOrDefault(tools.codeExecution, DEFAULT_SETTINGS.tools.codeExecution),
      urlContext: toBooleanOrDefault(tools.urlContext, DEFAULT_SETTINGS.tools.urlContext),
      fileSearch: toBooleanOrDefault(tools.fileSearch, DEFAULT_SETTINGS.tools.fileSearch),
      mcpServers: toBooleanOrDefault(tools.mcpServers, DEFAULT_SETTINGS.tools.mcpServers),
      computerUse: toBooleanOrDefault(tools.computerUse, DEFAULT_SETTINGS.tools.computerUse),
      functionCalling: toBooleanOrDefault(
        tools.functionCalling,
        DEFAULT_SETTINGS.tools.functionCalling,
      ),
    },
    fileSearchStoreNames: sanitizeStringList(settings.fileSearchStoreNames),
    mcpServerUrls: sanitizeStringList(settings.mcpServerUrls),
    mapsLatitude: toNullableNumber(settings.mapsLatitude),
    mapsLongitude: toNullableNumber(settings.mapsLongitude),
    computerUseExcludedActions: sanitizeStringList(settings.computerUseExcludedActions),
    customModels: sanitizeStringList(settings.customModels),
  };
}

export function defaultGeminiSettings(): GeminiSettings {
  return { ...DEFAULT_SETTINGS, tools: { ...DEFAULT_SETTINGS.tools } };
}
