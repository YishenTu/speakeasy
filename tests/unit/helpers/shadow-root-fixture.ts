export function createShadowRootFixture(markup: string): ShadowRoot {
  const host = document.createElement('div');
  document.body.append(host);
  const shadowRoot = host.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = markup;
  return shadowRoot;
}
