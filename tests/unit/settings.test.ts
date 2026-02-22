import { describe, expect, it } from 'bun:test';
import {
  defaultGeminiSettings,
  normalizeGeminiSettings,
  parseCommaSeparatedList,
} from '../../src/shared/settings';

describe('defaultGeminiSettings', () => {
  it('returns the expected defaults and fresh object copies', () => {
    const first = defaultGeminiSettings();
    const second = defaultGeminiSettings();

    expect(first).toEqual({
      apiKey: '',
      model: 'gemini-3-flash-preview',
      systemInstruction: '',
      storeInteractions: true,
      maxToolRoundTrips: 6,
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

describe('normalizeGeminiSettings', () => {
  it('normalizes malformed input into safe defaults', () => {
    const normalized = normalizeGeminiSettings({
      apiKey: 123,
      model: '   ',
      systemInstruction: null,
      storeInteractions: 'yes',
      maxToolRoundTrips: '7',
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
    });

    expect(normalized.apiKey).toBe('');
    expect(normalized.model).toBe('gemini-3-flash-preview');
    expect(normalized.systemInstruction).toBe('');
    expect(normalized.storeInteractions).toBe(true);
    expect(normalized.maxToolRoundTrips).toBe(6);
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
  });
});

describe('parseCommaSeparatedList', () => {
  it('trims, drops empties, and deduplicates while preserving order', () => {
    const parsed = parseCommaSeparatedList(' alpha, beta ,, alpha, gamma,  beta ');
    expect(parsed).toEqual(['alpha', 'beta', 'gamma']);
  });
});
