import { describe, expect, it } from 'bun:test';
import {
  BUILTIN_GEMINI_MODEL_CATALOG,
  DEFAULT_GEMINI_MODEL,
  defaultGeminiSettings,
  getBuiltinGeminiModelByKey,
  getModelDisplayLabel,
  getModelThinkingLevels,
  normalizeGeminiSettings,
  parseCommaSeparatedList,
} from '../../../src/shared/settings';

describe('defaultGeminiSettings', () => {
  it('returns the expected defaults and fresh object copies', () => {
    const first = defaultGeminiSettings();
    const second = defaultGeminiSettings();

    expect(first).toEqual({
      apiKey: '',
      model: 'gemini-3-flash-preview',
      modelThinkingLevelMap: {
        'gemini-3-flash-preview': 'minimal',
        'gemini-3.1-pro-preview': 'high',
      },
      systemInstruction: '',
      storeInteractions: true,
      maxToolRoundTrips: 6,
      pageTextExtractionEngine: 'defuddle',
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
    });

    first.tools.googleSearch = false;
    expect(second.tools.googleSearch).toBe(true);
  });
});

describe('model catalog', () => {
  it('provides a single source for built-in models and thinking defaults', () => {
    expect(BUILTIN_GEMINI_MODEL_CATALOG).toEqual([
      {
        key: 'flash',
        model: 'gemini-3-flash-preview',
        label: 'Flash',
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
    ]);

    expect(getBuiltinGeminiModelByKey('flash').model).toBe(DEFAULT_GEMINI_MODEL);
    expect(getModelDisplayLabel('gemini-3.1-pro-preview')).toBe('Pro');
    expect(getModelDisplayLabel('gemini-3.2-custom')).toBe('gemini-3.2-custom');
    expect(getModelThinkingLevels('gemini-3.1-pro-preview')).toEqual(['low', 'medium', 'high']);
    expect(getModelThinkingLevels('gemini-3.2-custom')).toEqual(['low', 'medium', 'high']);
  });
});

describe('normalizeGeminiSettings', () => {
  it('normalizes malformed input into safe defaults', () => {
    const normalized = normalizeGeminiSettings({
      apiKey: 123,
      model: '   ',
      systemInstruction: null,
      storeInteractions: 'yes',
      maxToolRoundTrips: '7',
      pageTextExtractionEngine: 'invalid',
      tools: {
        googleSearch: 'yes',
        googleMaps: true,
        codeExecution: 0,
        urlContext: false,
        fileSearch: true,
        mcpServers: null,
        computerUse: 'no',
        functionCalling: true,
      },
      fileSearchStoreNames: [' alpha ', '', 'beta', 'alpha', 99],
      mcpServerUrls: 'https://example.invalid',
      mapsLatitude: ' 41.5 ',
      mapsLongitude: 'not-a-number',
      computerUseExcludedActions: [' click ', 'drag', '', 'click'],
      modelThinkingLevelMap: {
        ' custom-model ': ' low ',
        '': 'high',
        'gemini-3.1-pro-preview': 9,
      },
    });

    expect(normalized.apiKey).toBe('');
    expect(normalized.model).toBe('gemini-3-flash-preview');
    expect(normalized.systemInstruction).toBe('');
    expect(normalized.storeInteractions).toBe(true);
    expect(normalized.maxToolRoundTrips).toBe(6);
    expect(normalized.pageTextExtractionEngine).toBe('defuddle');
    expect(normalized.tools).toEqual({
      googleSearch: true,
      googleMaps: true,
      codeExecution: true,
      urlContext: false,
      fileSearch: true,
      mcpServers: false,
      computerUse: false,
      functionCalling: true,
    });
    expect(normalized.fileSearchStoreNames).toEqual(['alpha', 'beta']);
    expect(normalized.mcpServerUrls).toEqual([]);
    expect(normalized.mapsLatitude).toBe(41.5);
    expect(normalized.mapsLongitude).toBeNull();
    expect(normalized.computerUseExcludedActions).toEqual(['click', 'drag']);
    expect(normalized.modelThinkingLevelMap).toEqual({
      'gemini-3-flash-preview': 'minimal',
      'gemini-3.1-pro-preview': 'high',
      'custom-model': 'low',
    });
  });

  it('clamps and coerces numeric boundaries', () => {
    expect(normalizeGeminiSettings({ storeInteractions: false }).storeInteractions).toBe(false);
    expect(normalizeGeminiSettings({ maxToolRoundTrips: 0 }).maxToolRoundTrips).toBe(1);
    expect(normalizeGeminiSettings({ maxToolRoundTrips: 200 }).maxToolRoundTrips).toBe(20);
    expect(normalizeGeminiSettings({ maxToolRoundTrips: 4.9 }).maxToolRoundTrips).toBe(4);
    expect(normalizeGeminiSettings({ maxToolRoundTrips: Number.NaN }).maxToolRoundTrips).toBe(6);

    expect(
      normalizeGeminiSettings({ mapsLatitude: Number.POSITIVE_INFINITY }).mapsLatitude,
    ).toBeNull();
    expect(normalizeGeminiSettings({ mapsLongitude: ' -73.98 ' }).mapsLongitude).toBe(-73.98);
    expect(
      normalizeGeminiSettings({ pageTextExtractionEngine: 'readability' }).pageTextExtractionEngine,
    ).toBe('readability');
  });
});

describe('parseCommaSeparatedList', () => {
  it('trims, drops empties, and deduplicates while preserving order', () => {
    const parsed = parseCommaSeparatedList(' alpha, beta ,, alpha, gamma,  beta ');
    expect(parsed).toEqual(['alpha', 'beta', 'gamma']);
  });
});
