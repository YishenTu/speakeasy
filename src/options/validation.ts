import type { GeminiSettings } from '../shared/settings';
import { validateGeminiToolConfiguration } from '../shared/tool-validation';

export function validateSettings(settings: GeminiSettings): string | null {
  if (!settings.apiKey) {
    return 'Gemini API key is required.';
  }

  if (!settings.model) {
    return 'Gemini model is required.';
  }

  if ((settings.mapsLatitude === null) !== (settings.mapsLongitude === null)) {
    return 'Provide both maps latitude and longitude, or leave both empty.';
  }

  const toolConfigurationError = validateGeminiToolConfiguration(settings, {
    mcpModelValidationScope: 'available-models',
  });
  if (toolConfigurationError) {
    return toolConfigurationError;
  }

  return null;
}
