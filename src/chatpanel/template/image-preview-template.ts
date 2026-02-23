export function getImagePreviewTemplate(): string {
  return `
      <div id="speakeasy-image-preview-overlay" class="image-preview-overlay" hidden>
        <section class="image-preview-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
          <button
            id="speakeasy-image-preview-close"
            class="image-preview-close"
            type="button"
            aria-label="Close image preview">
            \u00d7
          </button>
          <img id="speakeasy-image-preview-image" class="image-preview-image" alt="" />
          <p id="speakeasy-image-preview-caption" class="image-preview-caption" hidden></p>
        </section>
      </div>`;
}
