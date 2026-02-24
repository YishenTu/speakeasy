import type { ChatMessage } from '../../../shared/chat';
import { isImageMimeType } from '../../core/media-helpers';

export interface LocalAttachmentPreviewCache {
  previewUrlsByFileUri: Map<string, string>;
  remember(message: ChatMessage): void;
  apply(messages: ChatMessage[]): ChatMessage[];
  prune(messages: ChatMessage[]): void;
}

export function createLocalAttachmentPreviewCache(): LocalAttachmentPreviewCache {
  const previewUrlsByFileUri = new Map<string, string>();
  const previewTextByFileUri = new Map<string, string>();

  function remember(message: ChatMessage): void {
    for (const attachment of message.attachments ?? []) {
      const fileUri = attachment.fileUri?.trim() ?? '';
      if (fileUri) {
        const previewText = attachment.previewText?.trim() ?? '';
        if (previewText) {
          previewTextByFileUri.set(fileUri, previewText);
        }
      }

      const previewUrl = attachment.previewUrl?.trim() ?? '';
      if (fileUri && previewUrl && isImageMimeType(attachment.mimeType)) {
        const existing = previewUrlsByFileUri.get(fileUri);
        if (existing) {
          if (existing === previewUrl) {
            continue;
          }

          // Keep local blob previews because they preserve original fidelity for in-session rehydration.
          if (isBlobObjectUrl(existing) && !isBlobObjectUrl(previewUrl)) {
            continue;
          }

          if (isBlobObjectUrl(existing)) {
            URL.revokeObjectURL(existing);
          }
        }
        previewUrlsByFileUri.set(fileUri, previewUrl);
      }
    }
  }

  function apply(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((message) => {
      const attachments = message.attachments;
      if (!attachments || attachments.length === 0) {
        return message;
      }

      let changed = false;
      const nextAttachments = attachments.map((attachment) => {
        const fileUri = attachment.fileUri?.trim() ?? '';
        if (!fileUri) {
          return attachment;
        }

        let nextAttachment = attachment;
        if (isImageMimeType(attachment.mimeType)) {
          const localPreviewUrl = previewUrlsByFileUri.get(fileUri);
          if (localPreviewUrl) {
            const currentPreviewUrl = attachment.previewUrl?.trim() ?? '';
            if (currentPreviewUrl !== localPreviewUrl) {
              nextAttachment = {
                ...nextAttachment,
                previewUrl: localPreviewUrl,
              };
              changed = true;
            }
          }
        }

        const localPreviewText = previewTextByFileUri.get(fileUri);
        if (localPreviewText) {
          const currentPreviewText = nextAttachment.previewText?.trim() ?? '';
          if (currentPreviewText !== localPreviewText) {
            nextAttachment = {
              ...nextAttachment,
              previewText: localPreviewText,
            };
            changed = true;
          }
        }

        return nextAttachment;
      });

      if (!changed) {
        return message;
      }

      return {
        ...message,
        attachments: nextAttachments,
      };
    });
  }

  function prune(messages: ChatMessage[]): void {
    const renderedPreviewUrlByUri = new Map<string, string>();
    const renderedPreviewTextByUri = new Map<string, string>();
    for (const message of messages) {
      for (const attachment of message.attachments ?? []) {
        const fileUri = attachment.fileUri?.trim() ?? '';
        if (!fileUri) {
          continue;
        }

        if (isImageMimeType(attachment.mimeType)) {
          const previewUrl = attachment.previewUrl?.trim() ?? '';
          renderedPreviewUrlByUri.set(fileUri, previewUrl);
        }

        const previewText = attachment.previewText?.trim() ?? '';
        if (previewText) {
          renderedPreviewTextByUri.set(fileUri, previewText);
        }
      }
    }

    for (const [fileUri, previewUrl] of previewUrlsByFileUri) {
      const renderedPreviewUrl = renderedPreviewUrlByUri.get(fileUri);
      if (renderedPreviewUrl && renderedPreviewUrl === previewUrl) {
        continue;
      }
      if (isBlobObjectUrl(previewUrl)) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrlsByFileUri.delete(fileUri);
    }

    for (const [fileUri, previewText] of previewTextByFileUri) {
      if (renderedPreviewTextByUri.get(fileUri) === previewText) {
        continue;
      }
      previewTextByFileUri.delete(fileUri);
    }
  }

  return {
    previewUrlsByFileUri,
    remember,
    apply,
    prune,
  };
}

function isBlobObjectUrl(value: string): boolean {
  return value.startsWith('blob:');
}
