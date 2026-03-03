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

export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type BuiltinGeminiModelKey = 'flash' | 'flash-lite' | 'pro';

export interface BuiltinGeminiModelCatalogEntry {
  key: BuiltinGeminiModelKey;
  model: string;
  label: string;
  thinkingLevels: readonly ThinkingLevel[];
  defaultThinkingLevel: ThinkingLevel;
}

export const BUILTIN_GEMINI_MODEL_CATALOG: readonly BuiltinGeminiModelCatalogEntry[] = [
  {
    key: 'flash',
    model: 'gemini-3-flash-preview',
    label: 'Flash',
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
    defaultThinkingLevel: 'minimal',
  },
  {
    key: 'flash-lite',
    model: 'gemini-3.1-flash-lite-preview',
    label: 'Lite',
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
    defaultThinkingLevel: 'minimal',
  },
  {
    key: 'pro',
    model: 'gemini-3.1-pro-preview',
    label: 'Pro',
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'high',
  },
];

export const DEFAULT_GEMINI_MODEL =
  BUILTIN_GEMINI_MODEL_CATALOG[0]?.model ?? 'gemini-3-flash-preview';

const DEFAULT_MODEL_THINKING_LEVEL_MAP: Record<string, string> = Object.fromEntries(
  BUILTIN_GEMINI_MODEL_CATALOG.map((entry) => [entry.model, entry.defaultThinkingLevel]),
) as Record<string, string>;

export function getBuiltinGeminiModelByKey(
  key: BuiltinGeminiModelKey,
): BuiltinGeminiModelCatalogEntry {
  const entry = BUILTIN_GEMINI_MODEL_CATALOG.find((e) => e.key === key);
  if (!entry) {
    throw new Error(`Built-in Gemini model config is missing for key "${key}".`);
  }
  return entry;
}

function findBuiltinGeminiModel(model: string): BuiltinGeminiModelCatalogEntry | undefined {
  return BUILTIN_GEMINI_MODEL_CATALOG.find((entry) => entry.model === model);
}

export function getModelDisplayLabel(model: string): string {
  return findBuiltinGeminiModel(model)?.label ?? model;
}

export function getModelThinkingLevels(model: string): readonly ThinkingLevel[] {
  return findBuiltinGeminiModel(model)?.thinkingLevels ?? THINKING_LEVELS;
}

export interface GeminiSettings {
  apiKey: string;
  model: string;
  modelThinkingLevelMap: Record<string, string>;
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
}

export const GEMINI_SETTINGS_STORAGE_KEY = 'geminiSettings';
export const ACTIVE_CHAT_STORAGE_KEY = 'activeChatId';
export const ACTIVE_CHAT_FALLBACK_TAB_SCOPE = 'fallback';
export const CHAT_STORAGE_SCHEMA_VERSION_STORAGE_KEY = 'chatStorageSchemaVersion';

const DEFAULT_SETTINGS: GeminiSettings = {
  apiKey: '',
  model: DEFAULT_GEMINI_MODEL,
  modelThinkingLevelMap: { ...DEFAULT_MODEL_THINKING_LEVEL_MAP },
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

function sanitizeModelThinkingLevelMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawModel, rawLevel] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawLevel !== 'string') {
      continue;
    }

    const model = rawModel.trim();
    const thinkingLevel = rawLevel.trim();
    if (!model || !thinkingLevel) {
      continue;
    }

    if (!findBuiltinGeminiModel(model)) {
      continue;
    }

    normalized[model] = thinkingLevel;
  }

  return normalized;
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
    return defaultGeminiSettings();
  }

  const settings = value as Partial<GeminiSettings> & { tools?: Partial<GeminiToolSettings> };
  const tools: Partial<GeminiToolSettings> =
    settings.tools && typeof settings.tools === 'object' ? settings.tools : {};
  const modelThinkingLevelMap = sanitizeModelThinkingLevelMap(settings.modelThinkingLevelMap);
  const modelCandidate = toStringOrEmpty(settings.model).trim();
  const model = findBuiltinGeminiModel(modelCandidate) ? modelCandidate : DEFAULT_SETTINGS.model;

  return {
    apiKey: toStringOrEmpty(settings.apiKey).trim(),
    model,
    modelThinkingLevelMap: {
      ...DEFAULT_SETTINGS.modelThinkingLevelMap,
      ...modelThinkingLevelMap,
    },
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
  };
}

export function defaultGeminiSettings(): GeminiSettings {
  return {
    ...DEFAULT_SETTINGS,
    modelThinkingLevelMap: { ...DEFAULT_SETTINGS.modelThinkingLevelMap },
    tools: { ...DEFAULT_SETTINGS.tools },
  };
}
