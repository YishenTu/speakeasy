export function getHistoryTemplate(): string {
  return `
      <div id="speakeasy-delete-confirm-overlay" class="delete-confirm-overlay" hidden>
        <section
          class="delete-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="speakeasy-delete-confirm-text">
          <p id="speakeasy-delete-confirm-text" class="delete-confirm-text">Delete this session?</p>
          <label class="delete-confirm-skip" for="speakeasy-delete-confirm-skip">
            <input id="speakeasy-delete-confirm-skip" type="checkbox" />
            Don't ask again
          </label>
          <div class="delete-confirm-actions">
            <button id="speakeasy-delete-confirm-cancel" class="delete-confirm-btn" type="button">
              Cancel
            </button>
            <button
              id="speakeasy-delete-confirm-accept"
              class="delete-confirm-btn delete-confirm-btn-danger"
              type="button">
              Delete
            </button>
          </div>
        </section>
      </div>`;
}
