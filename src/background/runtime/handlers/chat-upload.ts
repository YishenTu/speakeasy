import type { ChatUploadFilesPayload, UploadFileTransportPayload } from '../../../shared/runtime';
import { normalizeUploadFiles } from '../attachments';
import type { RuntimeDependencies } from '../contracts';

export async function handleUploadFiles(
  files: UploadFileTransportPayload[] | undefined,
  uploadTimeoutMs: number | undefined,
  dependencies: RuntimeDependencies,
): Promise<ChatUploadFilesPayload> {
  const normalizedUpload = normalizeUploadFiles(files);
  if (normalizedUpload.files.length === 0) {
    return {
      attachments: [],
      failures: normalizedUpload.failures,
    };
  }

  const settings = await dependencies.readGeminiSettings();
  if (!settings.apiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }

  const uploaded = await dependencies.uploadFilesToGemini(
    normalizedUpload.files,
    settings.apiKey,
    uploadTimeoutMs,
  );
  if (normalizedUpload.failures.length === 0) {
    return uploaded;
  }

  return {
    attachments: uploaded.attachments,
    failures: [...uploaded.failures, ...normalizedUpload.failures],
  };
}
