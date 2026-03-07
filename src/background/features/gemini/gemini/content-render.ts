import type { ChatAttachment } from '../../../../shared/messages';
import type { GeminiContent } from '../../session/types';
import {
  inferAttachmentNameFromMimeType,
  inferFileNameFromUri,
  normalizeFunctionCallArgs,
  readPartRecord,
  readStringField,
} from './common';

export function renderContentForChat(content: GeminiContent): string {
  if (content.role === 'user') {
    const displayText = content.metadata?.userDisplayText?.trim();
    if (displayText) {
      return displayText;
    }
  }

  const blocks: string[] = [];

  for (const part of content.parts) {
    const text = typeof part.text === 'string' ? part.text.trim() : '';
    if (text) {
      blocks.push(text);
      continue;
    }

    const codeExecutionResult = readPartRecord(
      part,
      'codeExecutionResult',
      'code_execution_result',
    );
    if (codeExecutionResult) {
      let output = '';
      if (typeof codeExecutionResult.output === 'string') {
        output = codeExecutionResult.output.trim();
      } else if (typeof codeExecutionResult.result === 'string') {
        output = codeExecutionResult.result.trim();
      }
      if (output) {
        blocks.push(`Code output:\n${createFencedCodeBlock(output, 'text')}`);
      }
      continue;
    }

    const executableCode = readPartRecord(part, 'executableCode', 'executable_code');
    if (executableCode) {
      const code = typeof executableCode.code === 'string' ? executableCode.code.trim() : '';
      if (code) {
        const language =
          typeof executableCode.language === 'string' && executableCode.language.trim()
            ? executableCode.language.trim().toLowerCase()
            : 'text';
        blocks.push(`\`\`\`${language}\n${code}\n\`\`\``);
      }
      continue;
    }

    const functionCall = readPartRecord(part, 'functionCall', 'function_call');
    if (functionCall) {
      const name = typeof functionCall.name === 'string' ? functionCall.name.trim() : '';
      if (!name) {
        continue;
      }

      const args = JSON.stringify(normalizeFunctionCallArgs(functionCall.args));
      blocks.push(`Tool call requested: ${name} ${args}`);
    }
  }

  return blocks.join('\n\n');
}

function createFencedCodeBlock(code: string, language: string): string {
  const longestBacktickRun = Math.max(...(code.match(/`+/g)?.map((run) => run.length) ?? [0]));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

export function renderThinkingSummaryForChat(content: GeminiContent): string {
  return content.parts
    .map((part) => (typeof part.thoughtSummary === 'string' ? part.thoughtSummary.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

export function extractAttachments(content: GeminiContent): ChatAttachment[] {
  const attachments: ChatAttachment[] = [];

  for (const part of content.parts) {
    const fileData = readPartRecord(part, 'fileData', 'file_data');
    if (fileData) {
      const fileUri = readStringField(fileData, 'fileUri', 'file_uri');
      const mimeType = readStringField(fileData, 'mimeType', 'mime_type');
      if (!fileUri || !mimeType) {
        continue;
      }

      const displayName = readStringField(fileData, 'displayName', 'display_name');
      attachments.push({
        name: displayName || inferFileNameFromUri(fileUri),
        mimeType,
        fileUri,
      });
      continue;
    }

    const inlineData = readPartRecord(part, 'inlineData', 'inline_data');
    if (!inlineData) {
      continue;
    }

    const mimeType = readStringField(inlineData, 'mimeType', 'mime_type');
    if (!mimeType) {
      continue;
    }

    const displayName = readStringField(inlineData, 'displayName', 'display_name');
    attachments.push({
      name: displayName || inferAttachmentNameFromMimeType(mimeType),
      mimeType,
    });
  }

  return attachments;
}
