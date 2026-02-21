export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiPart = Record<string, unknown>;

export interface GeminiFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  contents: GeminiContent[];
}

export interface GenerateContentCandidate {
  content?: GeminiContent;
}

export interface GenerateContentResponse {
  candidates?: GenerateContentCandidate[];
}
