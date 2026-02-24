export interface CreateTitleMetaButtonOptions {
  buttonClassName: string;
  titleClassName: string;
  metaClassName: string;
  titleText: string;
  metaText: string;
  role?: string;
  disabled?: boolean;
  selected?: boolean;
  dataset?: Record<string, string | number | undefined>;
}

export function createTitleMetaButton(options: CreateTitleMetaButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.buttonClassName;

  if (options.role) {
    button.setAttribute('role', options.role);
  }
  if (typeof options.disabled === 'boolean') {
    button.disabled = options.disabled;
  }
  if (typeof options.selected === 'boolean') {
    button.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      if (typeof value === 'undefined') {
        continue;
      }
      button.dataset[key] = String(value);
    }
  }

  const title = document.createElement('span');
  title.className = options.titleClassName;
  title.textContent = options.titleText;

  const meta = document.createElement('span');
  meta.className = options.metaClassName;
  meta.textContent = options.metaText;

  button.append(title, meta);
  return button;
}
