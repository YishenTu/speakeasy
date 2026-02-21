import { GoogleGenAI } from '@google/genai';

const model = 'gemini-3-flash-preview';
const apiKey = Bun.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY is missing. Add it to the project root .env file.');
}

const ai = new GoogleGenAI({
  apiKey,
  apiVersion: 'v1beta',
});

type SDKGenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];

type JsonRecord = Record<string, unknown>;

async function generateContent(request: SDKGenerateContentRequest): Promise<JsonRecord> {
  const response = (await ai.models.generateContent(request)) as unknown;
  if (!isRecord(response)) {
    throw new Error('Gemini response was not a JSON object.');
  }

  return response;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstCandidateContent(payload: JsonRecord): JsonRecord {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0];
  if (!isRecord(first)) {
    throw new Error('No candidate returned from Gemini.');
  }

  const content = first.content;
  if (!isRecord(content)) {
    throw new Error('Candidate content is missing.');
  }

  return content;
}

function textFromCandidate(payload: JsonRecord): string {
  const content = firstCandidateContent(payload);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const textBlocks: string[] = [];

  for (const rawPart of parts) {
    if (!isRecord(rawPart)) {
      continue;
    }

    const text = typeof rawPart.text === 'string' ? rawPart.text.trim() : '';
    if (text) {
      textBlocks.push(text);
    }
  }

  return textBlocks.join('\n\n');
}

function hasThoughtSignature(content: JsonRecord): boolean {
  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const rawPart of parts) {
    if (!isRecord(rawPart)) {
      continue;
    }

    if (
      (typeof rawPart.thoughtSignature === 'string' && rawPart.thoughtSignature.length > 0) ||
      (typeof rawPart.thought_signature === 'string' && rawPart.thought_signature.length > 0)
    ) {
      return true;
    }
  }

  return false;
}

function findFunctionCall(content: JsonRecord): JsonRecord | null {
  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const rawPart of parts) {
    if (!isRecord(rawPart)) {
      continue;
    }

    const functionCall = isRecord(rawPart.functionCall)
      ? rawPart.functionCall
      : isRecord(rawPart.function_call)
        ? rawPart.function_call
        : null;

    if (functionCall && typeof functionCall.name === 'string' && functionCall.name.trim()) {
      return functionCall;
    }
  }

  return null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  console.log(`Testing Gemini API format with model: ${model}`);

  console.log('1) Basic generateContent request');
  const basicPayload = await generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Reply with: BASIC_OK' }],
      },
    ],
  });
  const basicText = textFromCandidate(basicPayload);
  assert(basicText.length > 0, 'Basic request returned no text.');

  console.log('2) Multi-turn history pass-through (thought signature compatible)');
  const turn1UserContent = {
    role: 'user',
    parts: [{ text: 'Compute 189 * 73. You may think first, then answer.' }],
  };

  const turn1Payload = await generateContent({
    model,
    contents: [turn1UserContent],
  });
  const turn1AssistantContent = firstCandidateContent(turn1Payload);
  const thoughtSignaturePresent = hasThoughtSignature(turn1AssistantContent);

  const turn2Payload = await generateContent({
    model,
    contents: [
      turn1UserContent,
      turn1AssistantContent,
      {
        role: 'user',
        parts: [{ text: 'Now provide only the final integer value.' }],
      },
    ],
  });

  const turn2Text = textFromCandidate(turn2Payload);
  assert(turn2Text.length > 0, 'Multi-turn request returned no text.');
  console.log(
    `   Thought signature present in turn-1 model parts: ${thoughtSignaturePresent ? 'yes' : 'no'}`,
  );

  console.log('3) Native tool request payload (Google Search + Code Execution + URL Context)');
  const nativeToolPayload = await generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Summarize https://ai.google.dev/gemini-api/docs in one sentence and compute 17 * 19.',
          },
        ],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }, { codeExecution: {} }, { urlContext: {} }],
    },
  });
  const nativeToolText = textFromCandidate(nativeToolPayload);
  assert(nativeToolText.length > 0, 'Native tool request returned no text.');

  console.log('4) Function-calling payload format (separate from native tools)');
  const functionTool = {
    name: 'get_current_time',
    description: 'Get the current time.',
    parameters: {
      type: 'object',
      properties: {},
    },
  };

  const functionCallPromptContent = {
    role: 'user',
    parts: [{ text: 'Call get_current_time before answering. Then provide the ISO value.' }],
  };

  const functionCallPayload = await generateContent({
    model,
    contents: [functionCallPromptContent],
    config: {
      tools: [{ functionDeclarations: [functionTool] }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['get_current_time'],
        },
      },
    },
  });

  const functionCallAssistantContent = firstCandidateContent(functionCallPayload);
  const functionCall = findFunctionCall(functionCallAssistantContent);
  assert(functionCall, 'Model did not return a function call.');
  const functionCallId =
    typeof functionCall.id === 'string' && functionCall.id.trim() ? functionCall.id.trim() : null;

  const functionResultPayload = await generateContent({
    model,
    contents: [
      functionCallPromptContent,
      functionCallAssistantContent,
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              ...(functionCallId ? { id: functionCallId } : {}),
              name: 'get_current_time',
              response: {
                iso: new Date().toISOString(),
              },
            },
          },
        ],
      },
    ],
    config: {
      tools: [{ functionDeclarations: [functionTool] }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      },
    },
  });

  const functionResultText = textFromCandidate(functionResultPayload);
  assert(functionResultText.length > 0, 'Function-response round trip returned no text.');

  console.log('All Gemini format checks passed.');
}

await run();
