import { type UploadChatFilesOptions, uploadChatFiles } from '../shared/chat';
import type { ChatUploadFilesPayload, FileDataAttachmentPayload } from '../shared/runtime';

interface UploadDependencies {
  uploadChatFiles: (
    files: File[],
    options: UploadChatFilesOptions,
  ) => Promise<ChatUploadFilesPayload>;
}

export interface UploadFileFailure {
  file: File;
  message: string;
}

export interface UploadFilesOptions {
  uploadTimeoutMs?: number;
  onPartialFailure?: (failures: UploadFileFailure[]) => void;
}

export async function uploadFilesToGemini(
  files: File[],
  overrides: Partial<UploadDependencies> = {},
  options: UploadFilesOptions = {},
): Promise<FileDataAttachmentPayload[]> {
  if (files.length === 0) {
    return [];
  }

  const dependencies: UploadDependencies = {
    uploadChatFiles,
    ...overrides,
  };
  const uploadOptions: UploadChatFilesOptions = {};
  if (typeof options.uploadTimeoutMs === 'number') {
    uploadOptions.uploadTimeoutMs = options.uploadTimeoutMs;
  }

  const payload = await dependencies.uploadChatFiles(files, uploadOptions);
  const failures = mapFailuresToFiles(payload.failures, files);
  if (payload.attachments.length === 0 && failures.length > 0) {
    throw new Error(failures[0]?.message || 'Failed to upload selected file(s).');
  }
  if (payload.attachments.length === 0) {
    throw new Error('Failed to upload selected file(s).');
  }
  if (failures.length > 0) {
    options.onPartialFailure?.(failures);
  }

  return payload.attachments;
}

function mapFailuresToFiles(
  failures: ChatUploadFilesPayload['failures'],
  files: File[],
): UploadFileFailure[] {
  const normalized: UploadFileFailure[] = [];
  for (const failure of failures) {
    const sourceFile = files[failure.index];
    if (sourceFile) {
      normalized.push({
        file: sourceFile,
        message: failure.message,
      });
      continue;
    }

    const fallbackFile = files.find((file) => file.name === failure.fileName);
    if (fallbackFile) {
      normalized.push({
        file: fallbackFile,
        message: failure.message,
      });
    }
  }

  return normalized;
}
