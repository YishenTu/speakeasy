import type { AssistantResponseStats } from '../shared/messages';

export interface GeminiContent {
  id?: string;
  role: 'user' | 'model';
  parts: GeminiPart[];
  metadata?: GeminiContentMetadata;
}

interface GeminiPartBase {
  [key: string]: unknown;
}

interface GeminiFunctionCallPartPayload extends GeminiPartBase {
  id?: string;
  name: string;
  args?: unknown;
}

interface GeminiFunctionResponsePartPayload extends GeminiPartBase {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
}

interface GeminiFileDataPartPayload extends GeminiPartBase {
  fileUri?: string;
  file_uri?: string;
  mimeType?: string;
  mime_type?: string;
  displayName?: string;
  display_name?: string;
}

interface GeminiInlineDataPartPayload extends GeminiPartBase {
  mimeType?: string;
  mime_type?: string;
  data?: string;
  displayName?: string;
  display_name?: string;
}

interface GeminiExecutableCodePartPayload extends GeminiPartBase {
  language?: string;
  code?: string;
}

interface GeminiCodeExecutionResultPartPayload extends GeminiPartBase {
  output?: string;
}

interface GeminiInteractionOutputPartPayload extends GeminiPartBase {
  type?: string;
  name?: string;
  id?: string;
  resultCount?: number;
}

interface GeminiTextPart extends GeminiPartBase {
  text: string;
}

interface GeminiThoughtSummaryPart extends GeminiPartBase {
  thoughtSummary: string;
}

interface GeminiFunctionCallPart extends GeminiPartBase {
  functionCall: GeminiFunctionCallPartPayload;
}

interface GeminiFunctionCallSnakeCasePart extends GeminiPartBase {
  function_call: GeminiFunctionCallPartPayload;
}

interface GeminiFunctionResponsePart extends GeminiPartBase {
  functionResponse: GeminiFunctionResponsePartPayload;
}

interface GeminiFunctionResponseSnakeCasePart extends GeminiPartBase {
  function_response: GeminiFunctionResponsePartPayload;
}

interface GeminiFileDataPart extends GeminiPartBase {
  fileData: GeminiFileDataPartPayload;
}

interface GeminiFileDataSnakeCasePart extends GeminiPartBase {
  file_data: GeminiFileDataPartPayload;
}

interface GeminiInlineDataPart extends GeminiPartBase {
  inlineData: GeminiInlineDataPartPayload;
}

interface GeminiInlineDataSnakeCasePart extends GeminiPartBase {
  inline_data: GeminiInlineDataPartPayload;
}

interface GeminiExecutableCodePart extends GeminiPartBase {
  executableCode: GeminiExecutableCodePartPayload;
}

interface GeminiExecutableCodeSnakeCasePart extends GeminiPartBase {
  executable_code: GeminiExecutableCodePartPayload;
}

interface GeminiCodeExecutionResultPart extends GeminiPartBase {
  codeExecutionResult: GeminiCodeExecutionResultPartPayload;
}

interface GeminiCodeExecutionResultSnakeCasePart extends GeminiPartBase {
  code_execution_result: GeminiCodeExecutionResultPartPayload;
}

interface GeminiInteractionOutputPart extends GeminiPartBase {
  interactionOutput: GeminiInteractionOutputPartPayload;
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiThoughtSummaryPart
  | GeminiFunctionCallPart
  | GeminiFunctionCallSnakeCasePart
  | GeminiFunctionResponsePart
  | GeminiFunctionResponseSnakeCasePart
  | GeminiFileDataPart
  | GeminiFileDataSnakeCasePart
  | GeminiInlineDataPart
  | GeminiInlineDataSnakeCasePart
  | GeminiExecutableCodePart
  | GeminiExecutableCodeSnakeCasePart
  | GeminiCodeExecutionResultPart
  | GeminiCodeExecutionResultSnakeCasePart
  | GeminiInteractionOutputPart;

export interface GeminiContentMetadata {
  responseStats?: AssistantResponseStats;
  interactionId?: string;
  sourceModel?: string;
  createdAt?: string;
  attachmentPreviewByFileUri?: Record<string, string>;
  attachmentPreviewTextByFileUri?: Record<string, string>;
}

export interface GeminiFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatBranchNode {
  id: string;
  parentNodeId?: string;
  childNodeIds: string[];
  content?: GeminiContent;
}

export interface ChatBranchTree {
  rootNodeId: string;
  activeLeafNodeId: string;
  nodes: Record<string, ChatBranchNode>;
}

export interface ChatSession {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  // Invariant: contents is the snapshot of the active branch path in branchTree.
  // Use sessions.ts branch helpers to mutate session history so both stay in sync.
  contents: GeminiContent[];
  lastInteractionId?: string | undefined;
  branchTree?: ChatBranchTree;
}
