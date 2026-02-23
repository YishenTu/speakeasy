export function getImagePreviewTemplate(): string {
  return `
      <div id="speakeasy-image-preview-view" class="image-preview-view" hidden>
        <img id="speakeasy-image-preview-image" class="image-preview-image" alt="" />
      </div>`;
}
