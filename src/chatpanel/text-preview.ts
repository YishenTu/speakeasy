const MARKDOWN_EXTENSION_PATTERN = /\.md(?:own|x|wn|arkdown)?$/i;

type PreviewableTextTarget = HTMLElement & {
  speakeasyPreviewText?: string;
  speakeasyPreviewTitle?: string;
};

export interface AttachmentTextPreview {
  text: string;
  title: string;
}

export function isMarkdownPreviewCandidate(name: string, mimeType: string): boolean {
  return isMarkdownMimeType(mimeType) || MARKDOWN_EXTENSION_PATTERN.test(name.trim());
}

export function isMarkdownMimeType(mimeType: string): boolean {
  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return normalizedMimeType === 'text/markdown';
}

export function attachTextPreview(
  element: HTMLElement,
  text: string,
  title: string,
): AttachmentTextPreview | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const normalizedTitle = title.trim() || 'Markdown preview';
  const previewTarget = element as PreviewableTextTarget;
  previewTarget.dataset.speakeasyPreviewText = 'true';
  previewTarget.speakeasyPreviewText = normalizedText;
  previewTarget.speakeasyPreviewTitle = normalizedTitle;
  return {
    text: normalizedText,
    title: normalizedTitle,
  };
}

export function readAttachedTextPreview(element: HTMLElement): AttachmentTextPreview | null {
  const previewTarget = element as PreviewableTextTarget;
  const text = previewTarget.speakeasyPreviewText?.trim() ?? '';
  if (!text) {
    return null;
  }

  const title = previewTarget.speakeasyPreviewTitle?.trim() || 'Markdown preview';
  return {
    text,
    title,
  };
}
