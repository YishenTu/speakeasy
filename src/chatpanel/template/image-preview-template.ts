export function getImagePreviewTemplate(): string {
  return `
      <div id="speakeasy-image-preview-view" class="image-preview-view" hidden>
        <button
          id="speakeasy-image-preview-close"
          class="image-preview-close"
          type="button"
          aria-label="Close image preview">
          &times;
        </button>
        <img id="speakeasy-image-preview-image" class="image-preview-image" alt="" />
      </div>`;
}
