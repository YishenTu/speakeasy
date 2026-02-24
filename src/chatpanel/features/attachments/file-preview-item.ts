import { getFilePreviewTypeLabel, isImageMimeType, isPdfMimeType } from '../../core/media-helpers';
import { attachTextPreview, isMarkdownPreviewCandidate } from './text-preview';

type FilePreviewUploadState = 'uploading' | 'uploaded' | 'failed';

export interface FilePreviewItemAttachment {
  name: string;
  mimeType: string;
  previewUrl?: string;
  previewText?: string;
  uploadState?: FilePreviewUploadState;
}

export interface CreateFilePreviewItemOptions {
  attachment: FilePreviewItemAttachment;
  onRemove?: (event: MouseEvent) => void;
  onBlobPreviewUrl?: (previewUrl: string) => void;
}

export function createFilePreviewItem(options: CreateFilePreviewItemOptions): HTMLDivElement {
  const { attachment } = options;
  const previewItem = document.createElement('div');
  previewItem.className = 'file-preview-item';

  const tile = document.createElement('div');
  tile.className = 'file-preview-tile';
  tile.setAttribute('aria-label', `${attachment.name} (${attachment.mimeType})`);
  tile.setAttribute('title', `${attachment.name} (${attachment.mimeType})`);

  if (attachment.uploadState === 'uploading') {
    tile.classList.add('is-uploading');
  } else if (attachment.uploadState === 'failed') {
    tile.classList.add('is-failed');
  }

  if (attachment.previewUrl && isImageMimeType(attachment.mimeType)) {
    const previewUrl = attachment.previewUrl;
    const image = document.createElement('img');
    image.className = 'file-preview-image previewable-image';
    image.dataset.speakeasyPreviewImage = 'true';
    image.src = previewUrl;
    image.alt = attachment.name;
    image.loading = 'lazy';
    if (previewUrl.startsWith('blob:')) {
      options.onBlobPreviewUrl?.(previewUrl);
    }
    tile.append(image);
  } else {
    tile.append(createFilePreviewGenericNode(attachment));
    if (
      isMarkdownPreviewCandidate(attachment.name, attachment.mimeType) &&
      attachment.previewText?.trim()
    ) {
      attachTextPreview(tile, attachment.previewText, attachment.name);
      tile.classList.add('previewable-text');
    }
  }

  if (options.onRemove) {
    const removeButton = document.createElement('button');
    removeButton.className = 'file-preview-remove';
    removeButton.type = 'button';
    removeButton.textContent = '\u00d7';
    removeButton.setAttribute('aria-label', `Remove ${attachment.name}`);
    removeButton.addEventListener('click', options.onRemove);
    tile.append(removeButton);
  }

  if (attachment.uploadState === 'uploading') {
    const overlay = document.createElement('div');
    overlay.className = 'file-preview-upload-overlay';

    const spinner = document.createElement('span');
    spinner.className = 'file-preview-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    overlay.append(spinner);
    tile.append(overlay);
  } else if (attachment.uploadState === 'failed') {
    const failedBadge = document.createElement('span');
    failedBadge.className = 'file-preview-failed';
    failedBadge.textContent = '!';
    failedBadge.setAttribute('aria-label', 'Upload failed');
    tile.append(failedBadge);
  }

  const nameLabel = document.createElement('span');
  nameLabel.className = 'file-preview-name';
  nameLabel.textContent = attachment.name;
  nameLabel.setAttribute('title', attachment.name);

  previewItem.append(tile, nameLabel);
  return previewItem;
}

function createFilePreviewGenericNode(attachment: FilePreviewItemAttachment): HTMLDivElement {
  const generic = document.createElement('div');
  generic.className = 'file-preview-generic';
  if (isPdfMimeType(attachment.mimeType)) {
    generic.classList.add('is-pdf');
  }
  if (isMarkdownPreviewCandidate(attachment.name, attachment.mimeType)) {
    generic.classList.add('is-markdown');
  }

  const fileTypeLabel = document.createElement('span');
  fileTypeLabel.className = 'file-preview-filetype';
  fileTypeLabel.textContent = getFilePreviewTypeLabel(attachment);
  generic.append(fileTypeLabel);
  return generic;
}
