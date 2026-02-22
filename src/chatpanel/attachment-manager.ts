import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH,
  estimateBase64DecodedByteLength,
} from '../shared/attachment-preview';
import type { FileDataAttachmentPayload } from '../shared/runtime';
import {
  formatByteSize,
  getFilePreviewTypeLabel,
  isAcceptedMimeType,
  isImageMimeType,
  isPdfMimeType,
} from './media-helpers';
import { toErrorMessage } from './messages';
import { uploadFilesToGemini } from './uploads';

export const MAX_STAGED_FILES = 5;
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export type StagedFile = {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  previewUrl?: string;
  uploadState: 'uploading' | 'uploaded' | 'failed';
  uploadedAttachment?: FileDataAttachmentPayload;
  uploadError?: string;
};

export interface AttachmentManagerDeps {
  filePreviews: HTMLElement;
  localAttachmentPreviewUrls: Map<string, string>;
  onResizeComposer: () => void;
  onError: (message: string) => void;
  uploadFiles?: (files: File[]) => Promise<FileDataAttachmentPayload[]>;
}

export interface AttachmentManager {
  stageFromFiles(files: File[]): void;
  getStaged(): readonly StagedFile[];
  hasUploadingFiles(): boolean;
  hasFailedFiles(): boolean;
  getUploadedAttachments(): FileDataAttachmentPayload[];
  clearStage(revokePreviews: boolean): void;
  dispose(): void;
}

export function createAttachmentManager(deps: AttachmentManagerDeps): AttachmentManager {
  let stagedFiles: StagedFile[] = [];
  const uploadFiles = deps.uploadFiles ?? uploadFilesToGemini;

  function stageFromFiles(files: File[]): void {
    if (files.length === 0) {
      return;
    }

    const nextFiles: StagedFile[] = [];
    const availableSlots = MAX_STAGED_FILES - stagedFiles.length;
    if (availableSlots <= 0) {
      deps.onError(`You can attach up to ${MAX_STAGED_FILES} files per message.`);
      return;
    }

    for (const file of files.slice(0, availableSlots)) {
      if (!isAcceptedMimeType(file.type)) {
        deps.onError(`Unsupported file type for "${file.name}".`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        deps.onError(
          `"${file.name}" exceeds the ${formatByteSize(MAX_FILE_SIZE_BYTES)} file size limit.`,
        );
        continue;
      }

      const previewUrl = isImageMimeType(file.type) ? URL.createObjectURL(file) : undefined;
      nextFiles.push({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        uploadState: 'uploading',
        ...(previewUrl ? { previewUrl } : {}),
      });
    }

    stagedFiles = [...stagedFiles, ...nextFiles];
    if (files.length > availableSlots) {
      deps.onError(`Only ${availableSlots} additional file(s) were staged.`);
    }
    renderStagedFiles();
    for (const staged of nextFiles) {
      void uploadStagedFile(staged.id);
    }
  }

  function renderStagedFiles(): void {
    const fragment = document.createDocumentFragment();

    for (const staged of stagedFiles) {
      const previewItem = document.createElement('div');
      previewItem.className = 'file-preview-item';
      previewItem.dataset.fileId = staged.id;
      const tile = document.createElement('div');
      tile.className = 'file-preview-tile';
      tile.setAttribute('aria-label', `${staged.name} (${staged.mimeType})`);
      tile.setAttribute('title', `${staged.name} (${staged.mimeType})`);
      if (staged.uploadState === 'uploading') {
        tile.classList.add('is-uploading');
      } else if (staged.uploadState === 'failed') {
        tile.classList.add('is-failed');
      }

      if (isImageMimeType(staged.mimeType) && staged.previewUrl) {
        const image = document.createElement('img');
        image.className = 'file-preview-image';
        image.src = staged.previewUrl;
        image.alt = staged.name;
        image.loading = 'lazy';
        tile.append(image);
      } else {
        const generic = document.createElement('div');
        generic.className = 'file-preview-generic';
        if (isPdfMimeType(staged.mimeType)) {
          generic.classList.add('is-pdf');
        }

        const fileTypeLabel = document.createElement('span');
        fileTypeLabel.className = 'file-preview-filetype';
        fileTypeLabel.textContent = getFilePreviewTypeLabel(staged);

        generic.append(fileTypeLabel);
        tile.append(generic);
      }

      const removeButton = document.createElement('button');
      removeButton.className = 'file-preview-remove';
      removeButton.type = 'button';
      removeButton.textContent = '\u00d7';
      removeButton.setAttribute('aria-label', `Remove ${staged.name}`);
      removeButton.addEventListener('click', () => {
        removeStagedFile(staged.id);
      });
      tile.append(removeButton);

      if (staged.uploadState === 'uploading') {
        const overlay = document.createElement('div');
        overlay.className = 'file-preview-upload-overlay';

        const spinner = document.createElement('span');
        spinner.className = 'file-preview-spinner';
        spinner.setAttribute('aria-hidden', 'true');

        overlay.append(spinner);
        tile.append(overlay);
      } else if (staged.uploadState === 'failed') {
        const failedBadge = document.createElement('span');
        failedBadge.className = 'file-preview-failed';
        failedBadge.textContent = '!';
        failedBadge.setAttribute('aria-label', 'Upload failed');
        tile.append(failedBadge);
      }

      const nameLabel = document.createElement('span');
      nameLabel.className = 'file-preview-name';
      nameLabel.textContent = staged.name;
      nameLabel.setAttribute('title', staged.name);

      previewItem.append(tile, nameLabel);
      fragment.append(previewItem);
    }

    deps.filePreviews.replaceChildren(fragment);
    deps.onResizeComposer();
  }

  async function uploadStagedFile(fileId: string): Promise<void> {
    const staged = stagedFiles.find((candidate) => candidate.id === fileId);
    if (!staged || staged.uploadState !== 'uploading') {
      return;
    }

    try {
      const uploaded = await uploadFiles([staged.file]);
      const uploadedWithPreviews = await withAttachmentPreviewDataUrls(uploaded, [staged]);
      const uploadedAttachment = uploadedWithPreviews[0];
      if (!uploadedAttachment) {
        throw new Error(`Failed to upload "${staged.name}".`);
      }

      if (!stagedFiles.some((candidate) => candidate.id === fileId)) {
        return;
      }

      stagedFiles = stagedFiles.map((candidate) => {
        if (candidate.id !== fileId) {
          return candidate;
        }
        const { uploadError, ...rest } = candidate;
        void uploadError;
        return {
          ...rest,
          uploadState: 'uploaded' as const,
          uploadedAttachment,
        };
      });
      renderStagedFiles();
    } catch (error: unknown) {
      const current = stagedFiles.find((candidate) => candidate.id === fileId);
      if (!current) {
        return;
      }

      const errorMessage = toErrorMessage(error);
      stagedFiles = stagedFiles.map((candidate) => {
        if (candidate.id !== fileId) {
          return candidate;
        }
        const { uploadedAttachment, ...rest } = candidate;
        void uploadedAttachment;
        return {
          ...rest,
          uploadState: 'failed' as const,
          uploadError: errorMessage,
        };
      });
      renderStagedFiles();
      deps.onError(`Failed to upload "${current.name}": ${errorMessage}`);
    }
  }

  function removeStagedFile(fileId: string): void {
    const target = stagedFiles.find((staged) => staged.id === fileId);
    if (!target) {
      return;
    }

    if (target.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    stagedFiles = stagedFiles.filter((staged) => staged.id !== fileId);
    renderStagedFiles();
  }

  function isRetainedLocalAttachmentPreview(previewUrl: string): boolean {
    for (const retainedPreviewUrl of deps.localAttachmentPreviewUrls.values()) {
      if (retainedPreviewUrl === previewUrl) {
        return true;
      }
    }

    return false;
  }

  function clearStage(revokePreviews: boolean): void {
    if (revokePreviews) {
      for (const staged of stagedFiles) {
        const previewUrl = staged.previewUrl;
        if (!previewUrl) {
          continue;
        }
        if (isRetainedLocalAttachmentPreview(previewUrl)) {
          continue;
        }
        URL.revokeObjectURL(previewUrl);
      }
    }
    stagedFiles = [];
    renderStagedFiles();
  }

  function dispose(): void {
    for (const staged of stagedFiles) {
      if (staged.previewUrl) {
        URL.revokeObjectURL(staged.previewUrl);
      }
    }
    stagedFiles = [];
  }

  function getStaged(): readonly StagedFile[] {
    return stagedFiles;
  }

  function hasUploadingFiles(): boolean {
    return stagedFiles.some((staged) => staged.uploadState === 'uploading');
  }

  function hasFailedFiles(): boolean {
    return stagedFiles.some((staged) => staged.uploadState === 'failed');
  }

  function getUploadedAttachments(): FileDataAttachmentPayload[] {
    const attachments: FileDataAttachmentPayload[] = [];
    for (const staged of stagedFiles) {
      if (staged.uploadedAttachment) {
        attachments.push(staged.uploadedAttachment);
      }
    }
    return attachments;
  }

  return {
    stageFromFiles,
    getStaged,
    hasUploadingFiles,
    hasFailedFiles,
    getUploadedAttachments,
    clearStage,
    dispose,
  };
}

export async function withAttachmentPreviewDataUrls(
  uploadedAttachments: readonly FileDataAttachmentPayload[],
  stagedFiles: readonly StagedFile[],
): Promise<FileDataAttachmentPayload[]> {
  if (uploadedAttachments.length === 0) {
    return [];
  }

  return Promise.all(
    uploadedAttachments.map(async (attachment, index) => {
      if (!isImageMimeType(attachment.mimeType)) {
        return attachment;
      }

      const stagedFile = stagedFiles[index];
      if (!stagedFile) {
        return attachment;
      }

      const previewDataUrl = await toImageDataUrl(stagedFile.file, attachment.mimeType);
      if (!previewDataUrl) {
        return attachment;
      }

      return {
        ...attachment,
        previewDataUrl,
      };
    }),
  );
}

async function toImageDataUrl(file: File, mimeType: string): Promise<string | undefined> {
  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!normalizedMimeType.startsWith('image/')) {
    return undefined;
  }
  if (file.size > ATTACHMENT_PREVIEW_MAX_BYTES) {
    return undefined;
  }

  const base64Bytes = encodeArrayBufferToBase64(await file.arrayBuffer());
  if (estimateBase64DecodedByteLength(base64Bytes) > ATTACHMENT_PREVIEW_MAX_BYTES) {
    return undefined;
  }

  const dataUrl = `data:${normalizedMimeType};base64,${base64Bytes}`;
  if (dataUrl.length > ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH) {
    return undefined;
  }

  return dataUrl;
}

function encodeArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }
  }

  return btoa(binary);
}

export function hasFileDataTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types).includes('Files')) {
    return true;
  }

  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file') {
        return true;
      }
    }
  }

  return dataTransfer.files.length > 0;
}

export function extractFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  const filesFromItems: File[] = [];
  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') {
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        filesFromItems.push(file);
      }
    }
  }
  if (filesFromItems.length > 0) {
    return filesFromItems;
  }

  return Array.from(dataTransfer.files);
}
