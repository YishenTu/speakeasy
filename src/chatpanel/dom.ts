export function queryRequiredElement<TElement extends Element>(
  root: ParentNode,
  selector: string,
): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Speakeasy overlay is missing required node: ${selector}`);
  }

  return element;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
