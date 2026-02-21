import { describe, expect, it } from 'bun:test';
import { renderContentForChat } from '../../src/background/gemini';
import { buildGeminiRequestToolSelection } from '../../src/background/gemini-request';
import type { GeminiContent } from '../../src/background/types';
import { defaultGeminiSettings } from '../../src/shared/settings';

const FUNCTION_DECLARATIONS = [
  {
    name: 'get_current_time',
    description: 'Return current time',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

function createSettingsForToolTests() {
  const settings = defaultGeminiSettings();
  settings.apiKey = 'test-key';
  settings.tools = {
    googleSearch: false,
    googleMaps: false,
    codeExecution: false,
    urlContext: false,
    fileSearch: false,
    mcpServers: false,
    computerUse: false,
    functionCalling: false,
  };
  return settings;
}

describe('buildGeminiRequestToolSelection', () => {
  it('rejects mixed native tools with function calling', () => {
    const settings = createSettingsForToolTests();
    settings.tools.functionCalling = true;
    settings.tools.googleSearch = true;

    expect(() => buildGeminiRequestToolSelection(settings, FUNCTION_DECLARATIONS)).toThrow(
      /cannot be enabled together/i,
    );
  });

  it('guards file search and mcp server configuration requirements', () => {
    const fileSearchSettings = createSettingsForToolTests();
    fileSearchSettings.tools.fileSearch = true;
    fileSearchSettings.fileSearchStoreNames = [];
    expect(() =>
      buildGeminiRequestToolSelection(fileSearchSettings, FUNCTION_DECLARATIONS),
    ).toThrow(/file search is enabled/i);

    const mcpSettings = createSettingsForToolTests();
    mcpSettings.tools.mcpServers = true;
    mcpSettings.mcpServerUrls = [];
    expect(() => buildGeminiRequestToolSelection(mcpSettings, FUNCTION_DECLARATIONS)).toThrow(
      /mcp servers are enabled/i,
    );
  });
});

describe('renderContentForChat', () => {
  it('renders text, code execution output, and executable code blocks', () => {
    const content: GeminiContent = {
      role: 'model',
      parts: [
        { text: 'Result summary' },
        { codeExecutionResult: { output: '42\n' } },
        { executableCode: { language: 'python', code: 'print(42)' } },
        { code_execution_result: { output: 'from snake case' } },
        { executable_code: { language: 'JavaScript', code: 'console.log(7);' } },
      ],
    };

    const rendered = renderContentForChat(content);

    expect(rendered).toContain('Result summary');
    expect(rendered).toContain('Code output:\n42');
    expect(rendered).toContain('```python\nprint(42)\n```');
    expect(rendered).toContain('Code output:\nfrom snake case');
    expect(rendered).toContain('```javascript\nconsole.log(7);\n```');
  });
});
