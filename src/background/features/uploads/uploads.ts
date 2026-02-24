import { normalizeMimeType } from '../../../shared/mime';
import type {
  ChatUploadFailurePayload,
  ChatUploadFilesPayload,
  FileDataAttachmentPayload,
  UploadFilePayload,
} from '../../../shared/runtime';
import { toErrorMessage } from '../../core/utils';
import { getGeminiClient } from '../gemini/gemini-client';

const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;
const FILE_STATE_POLL_INTERVAL_MS = 100;

type UploadResult = {
  uri?: string;
  mimeType?: string;
  name?: string;
  state?: string;
};

interface UploadFileClient {
  files: {
    upload: (input: {
      file: File;
      config: {
        displayName: string;
        mimeType?: string;
      };
    }) => Promise<UploadResult>;
    get?: (input: { name: string }) => Promise<UploadResult>;
  };
}

interface UploadDependencies {
  getGeminiClient: (apiKey: string) => UploadFileClient;
}

interface BackgroundUploadOptions {
  uploadTimeoutMs?: number;
}

export async function uploadFilesToGemini(
  files: UploadFilePayload[],
  apiKey: string,
  overrides: Partial<UploadDependencies> = {},
  options: BackgroundUploadOptions = {},
): Promise<ChatUploadFilesPayload> {
  if (files.length === 0) {
    return {
      attachments: [],
      failures: [],
    };
  }

  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('Gemini API key is missing. Add it in Speakeasy Settings.');
  }

  const dependencies: UploadDependencies = {
    getGeminiClient,
    ...overrides,
  };
  const client = dependencies.getGeminiClient(normalizedApiKey);
  const uploadTimeoutMs = normalizeUploadTimeoutMs(options.uploadTimeoutMs);
  const attachments: FileDataAttachmentPayload[] = [];
  const failures: ChatUploadFailurePayload[] = [];

  for (const [index, payload] of files.entries()) {
    const fileName = normalizeFileName(payload.name);
    const mimeType = normalizeMimeType(payload.mimeType, 'application/octet-stream');
    const file = new File([payload.bytes], fileName, { type: mimeType });

    try {
      const upload = await withUploadTimeout(
        uploadAndAwaitReady(client.files, file, fileName, mimeType),
        uploadTimeoutMs,
        fileName,
      );

      const fileUri = typeof upload.uri === 'string' ? upload.uri.trim() : '';
      if (!fileUri) {
        throw new Error(`Failed to upload "${fileName}": Gemini did not return a file URI.`);
      }

      const remoteName = typeof upload.name === 'string' ? upload.name.trim() : '';

      attachments.push({
        name: fileName,
        mimeType: mimeType || 'application/octet-stream',
        fileUri,
        ...(remoteName ? { fileName: remoteName } : {}),
      });
    } catch (error: unknown) {
      failures.push({
        index,
        fileName,
        message: toErrorMessage(error),
      });
    }
  }

  return {
    attachments,
    failures,
  };
}

function normalizeUploadTimeoutMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_UPLOAD_TIMEOUT_MS;
  }

  return Math.floor(value);
}

function normalizeFileName(value: string): string {
  return value.trim() || 'attachment';
}

async function uploadAndAwaitReady(
  filesClient: UploadFileClient['files'],
  file: File,
  fileName: string,
  mimeType: string,
): Promise<UploadResult> {
  const uploaded = await filesClient.upload({
    file,
    config: {
      displayName: fileName,
      ...(mimeType ? { mimeType } : {}),
    },
  });
  const initialState = normalizeFileState(uploaded.state);
  if (initialState === 'FAILED') {
    throw new Error(`Failed to process "${fileName}" after upload.`);
  }

  const resourceName = typeof uploaded.name === 'string' ? uploaded.name.trim() : '';
  if (initialState !== 'PROCESSING' || !resourceName || !filesClient.get) {
    return uploaded;
  }

  let latest = uploaded;
  while (normalizeFileState(latest.state) === 'PROCESSING') {
    await wait(FILE_STATE_POLL_INTERVAL_MS);
    latest = await filesClient.get({ name: resourceName });
  }

  if (normalizeFileState(latest.state) === 'FAILED') {
    throw new Error(`Failed to process "${fileName}" after upload.`);
  }

  return {
    ...uploaded,
    ...latest,
  };
}

type UploadFileState = 'PROCESSING' | 'ACTIVE' | 'FAILED' | 'UNKNOWN';

const VALID_FILE_STATES = new Set<UploadFileState>(['PROCESSING', 'ACTIVE', 'FAILED']);

function normalizeFileState(value: string | undefined): UploadFileState {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return VALID_FILE_STATES.has(normalized as UploadFileState)
    ? (normalized as UploadFileState)
    : 'UNKNOWN';
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function withUploadTimeout<TPayload>(
  uploadPromise: Promise<TPayload>,
  timeoutMs: number,
  fileName: string,
): Promise<TPayload> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<TPayload>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Upload timed out for "${fileName}".`));
    }, timeoutMs);
  });

  return Promise.race([uploadPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}
