import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH,
  estimateBase64DecodedByteLength,
} from '../shared/attachment-preview';
import { encodeArrayBufferToBase64 } from '../shared/base64';
import type { FileDataAttachmentPayload } from '../shared/runtime';
import {
  formatByteSize,
  getFilePreviewTypeLabel,
  isAcceptedMimeType,
  isImageMimeType,
  isPdfMimeType,
} from './media-helpers';
import { toErrorMessage } from './message-renderer';
import { uploadFilesToGemini } from './uploads';

export const MAX_STAGED_FILES = 5;
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const PREVIEW_MAX_EDGE_PX = 960;
const PREVIEW_MIN_EDGE_PX = 64;
const PREVIEW_SCALE_STEP = 0.75;

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
  onStagedFilesChanged?: () => void;
  uploadFiles?: (files: File[]) => Promise<FileDataAttachmentPayload[]>;
}

export interface AttachmentManager {
  stageFromFiles(files: File[]): void;
  getStaged(): readonly StagedFile[];
  setStagedPreviewsHidden(hidden: boolean): void;
  hasUploadingFiles(): boolean;
  hasFailedFiles(): boolean;
  getUploadedAttachments(): FileDataAttachmentPayload[];
  clearStage(revokePreviews: boolean): void;
  dispose(): void;
}

export function createAttachmentManager(deps: AttachmentManagerDeps): AttachmentManager {
  let stagedFiles: StagedFile[] = [];
  let stagedPreviewsHidden = false;
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

    for (const staged of stagedPreviewsHidden ? [] : stagedFiles) {
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
        image.className = 'file-preview-image previewable-image';
        image.dataset.speakeasyPreviewImage = 'true';
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
    deps.onStagedFilesChanged?.();
  }

  function setStagedPreviewsHidden(hidden: boolean): void {
    if (stagedPreviewsHidden === hidden) {
      return;
    }

    stagedPreviewsHidden = hidden;
    renderStagedFiles();
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
        const { uploadError: _, ...rest } = candidate;
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
        const { uploadedAttachment: _, ...rest } = candidate;
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

  function clearStage(revokePreviews: boolean): void {
    if (revokePreviews) {
      const retainedUrls = new Set(deps.localAttachmentPreviewUrls.values());
      for (const staged of stagedFiles) {
        if (staged.previewUrl && !retainedUrls.has(staged.previewUrl)) {
          URL.revokeObjectURL(staged.previewUrl);
        }
      }
    }
    stagedPreviewsHidden = false;
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
    return stagedFiles.flatMap((staged) =>
      staged.uploadedAttachment ? [staged.uploadedAttachment] : [],
    );
  }

  return {
    stageFromFiles,
    getStaged,
    setStagedPreviewsHidden,
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
  const directDataUrl = await toInlineImageDataUrl(file, normalizedMimeType);
  if (directDataUrl) {
    return directDataUrl;
  }

  return toDownscaledImageDataUrl(file, normalizedMimeType);
}

async function toInlineImageDataUrl(file: File, mimeType: string): Promise<string | undefined> {
  if (file.size > ATTACHMENT_PREVIEW_MAX_BYTES) {
    return undefined;
  }

  const base64Bytes = encodeArrayBufferToBase64(await file.arrayBuffer());
  if (estimateBase64DecodedByteLength(base64Bytes) > ATTACHMENT_PREVIEW_MAX_BYTES) {
    return undefined;
  }

  const dataUrl = `data:${mimeType};base64,${base64Bytes}`;
  if (dataUrl.length > ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH) {
    return undefined;
  }

  return dataUrl;
}

async function toDownscaledImageDataUrl(file: File, mimeType: string): Promise<string | undefined> {
  const image = await loadImageFromFile(file);
  if (!image) {
    return undefined;
  }

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    return undefined;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  const baseScale = Math.min(1, PREVIEW_MAX_EDGE_PX / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * baseScale));
  let height = Math.max(1, Math.round(sourceHeight * baseScale));

  while (width >= PREVIEW_MIN_EDGE_PX && height >= PREVIEW_MIN_EDGE_PX) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const dataUrl = canvas.toDataURL(mimeType);
    if (isDataUrlWithinPreviewBudget(dataUrl)) {
      return dataUrl;
    }

    const nextWidth = Math.max(PREVIEW_MIN_EDGE_PX, Math.floor(width * PREVIEW_SCALE_STEP));
    const nextHeight = Math.max(PREVIEW_MIN_EDGE_PX, Math.floor(height * PREVIEW_SCALE_STEP));
    if (nextWidth === width && nextHeight === height) {
      break;
    }
    width = nextWidth;
    height = nextHeight;
  }

  return undefined;
}

function isDataUrlWithinPreviewBudget(dataUrl: string): boolean {
  if (dataUrl.length > ATTACHMENT_PREVIEW_MAX_DATA_URL_LENGTH) {
    return false;
  }

  const [, base64Bytes = ''] = dataUrl.split(',', 2);
  if (!base64Bytes) {
    return false;
  }

  return estimateBase64DecodedByteLength(base64Bytes) <= ATTACHMENT_PREVIEW_MAX_BYTES;
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => {
        resolve(image);
      };
      image.onerror = () => {
        resolve(null);
      };
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
