import { Window } from 'happy-dom';

interface DomGlobalsSnapshot {
  window: typeof globalThis.window | undefined;
  document: typeof globalThis.document | undefined;
  SyntaxError: typeof globalThis.SyntaxError | undefined;
  HTMLElement: typeof globalThis.HTMLElement | undefined;
  HTMLButtonElement: typeof globalThis.HTMLButtonElement | undefined;
  HTMLInputElement: typeof globalThis.HTMLInputElement | undefined;
  HTMLTextAreaElement: typeof globalThis.HTMLTextAreaElement | undefined;
  HTMLFormElement: typeof globalThis.HTMLFormElement | undefined;
  HTMLOListElement: typeof globalThis.HTMLOListElement | undefined;
  ShadowRoot: typeof globalThis.ShadowRoot | undefined;
  Node: typeof globalThis.Node | undefined;
  Event: typeof globalThis.Event | undefined;
  MouseEvent: typeof globalThis.MouseEvent | undefined;
  URL: typeof globalThis.URL | undefined;
}

export interface InstalledDomEnvironment {
  window: Window;
  restore: () => void;
}

export function installDomTestEnvironment(
  html = '<!doctype html><html><body></body></html>',
): InstalledDomEnvironment {
  const window = new Window({ url: 'https://example.test' });
  window.document.write(html);
  window.document.close();
  (window as unknown as { SyntaxError?: typeof SyntaxError }).SyntaxError = SyntaxError;

  const snapshot: DomGlobalsSnapshot = {
    window: (globalThis as { window?: typeof globalThis.window }).window,
    document: (globalThis as { document?: typeof globalThis.document }).document,
    SyntaxError: (globalThis as { SyntaxError?: typeof globalThis.SyntaxError }).SyntaxError,
    HTMLElement: (globalThis as { HTMLElement?: typeof globalThis.HTMLElement }).HTMLElement,
    HTMLButtonElement: (globalThis as { HTMLButtonElement?: typeof globalThis.HTMLButtonElement })
      .HTMLButtonElement,
    HTMLInputElement: (globalThis as { HTMLInputElement?: typeof globalThis.HTMLInputElement })
      .HTMLInputElement,
    HTMLTextAreaElement: (
      globalThis as {
        HTMLTextAreaElement?: typeof globalThis.HTMLTextAreaElement;
      }
    ).HTMLTextAreaElement,
    HTMLFormElement: (globalThis as { HTMLFormElement?: typeof globalThis.HTMLFormElement })
      .HTMLFormElement,
    HTMLOListElement: (globalThis as { HTMLOListElement?: typeof globalThis.HTMLOListElement })
      .HTMLOListElement,
    ShadowRoot: (globalThis as { ShadowRoot?: typeof globalThis.ShadowRoot }).ShadowRoot,
    Node: (globalThis as { Node?: typeof globalThis.Node }).Node,
    Event: (globalThis as { Event?: typeof globalThis.Event }).Event,
    MouseEvent: (globalThis as { MouseEvent?: typeof globalThis.MouseEvent }).MouseEvent,
    URL: (globalThis as { URL?: typeof globalThis.URL }).URL,
  };

  Object.assign(globalThis, {
    window: window as unknown as typeof globalThis.window,
    document: window.document as unknown as typeof globalThis.document,
    SyntaxError: SyntaxError as typeof globalThis.SyntaxError,
    HTMLElement: window.HTMLElement as unknown as typeof globalThis.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement as unknown as typeof globalThis.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement as unknown as typeof globalThis.HTMLInputElement,
    HTMLTextAreaElement:
      window.HTMLTextAreaElement as unknown as typeof globalThis.HTMLTextAreaElement,
    HTMLFormElement: window.HTMLFormElement as unknown as typeof globalThis.HTMLFormElement,
    HTMLOListElement: window.HTMLOListElement as unknown as typeof globalThis.HTMLOListElement,
    ShadowRoot: window.ShadowRoot as unknown as typeof globalThis.ShadowRoot,
    Node: window.Node as unknown as typeof globalThis.Node,
    Event: window.Event as unknown as typeof globalThis.Event,
    MouseEvent: window.MouseEvent as unknown as typeof globalThis.MouseEvent,
    URL: window.URL as unknown as typeof globalThis.URL,
  });

  return {
    window,
    restore: () => {
      window.close();
      Object.assign(globalThis, snapshot);
    },
  };
}
