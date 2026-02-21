declare module 'katex/contrib/auto-render' {
  import type { KatexOptions } from 'katex';

  interface Delimiter {
    left: string;
    right: string;
    display: boolean;
  }

  interface RenderMathInElementOptions extends KatexOptions {
    delimiters?: Delimiter[];
    ignoredTags?: string[];
    ignoredClasses?: string[];
    preProcess?: (math: string) => string;
    errorCallback?: (message: string, error: Error) => void;
  }

  export default function renderMathInElement(
    element: HTMLElement,
    options?: RenderMathInElementOptions,
  ): void;
}
