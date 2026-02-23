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
      </div>
      <div id="speakeasy-text-preview-view" class="image-preview-view text-preview-view" hidden>
        <button
          id="speakeasy-text-preview-close"
          class="image-preview-close text-preview-close"
          type="button"
          aria-label="Close text preview">
          &times;
        </button>
        <section class="text-preview-body" aria-live="polite">
          <h3 id="speakeasy-text-preview-title" class="text-preview-title"></h3>
          <pre id="speakeasy-text-preview-content" class="text-preview-content"></pre>
        </section>
      </div>`;
}
