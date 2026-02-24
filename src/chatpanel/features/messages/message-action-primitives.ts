const SVG_NS = 'http://www.w3.org/2000/svg';

export type MessageActionIconName = 'stats' | 'copy' | 'refresh' | 'fork';

export interface CreateMessageActionButtonOptions {
  className?: string;
  title: string;
  icon: SVGSVGElement;
  onClick?: () => void;
}

export function createMessageActionButton(
  options: CreateMessageActionButtonOptions,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = ['message-action-btn', options.className ?? ''].filter(Boolean).join(' ');
  button.type = 'button';
  button.setAttribute('title', options.title);
  button.setAttribute('aria-label', options.title);
  button.append(options.icon);
  if (options.onClick) {
    button.addEventListener('click', options.onClick);
  }
  return button;
}

export function createMessageActionIcon(iconName: MessageActionIconName): SVGSVGElement {
  const icon = createActionSvg();
  switch (iconName) {
    case 'stats':
      icon.append(svgPath('M18 20V10'), svgPath('M12 20V4'), svgPath('M6 20V14'));
      return icon;
    case 'copy':
      icon.append(
        svgRect(9, 9, 13, 13, 2),
        svgPath('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'),
      );
      return icon;
    case 'refresh':
      icon.append(
        svgPath('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'),
        svgPath('M3 3v5h5'),
      );
      return icon;
    case 'fork':
      icon.append(
        svgCircle(12, 18, 3),
        svgCircle(6, 6, 3),
        svgCircle(18, 6, 3),
        svgPath('M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9'),
        svgPath('M12 12v3'),
      );
      return icon;
  }
}

function createActionSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('message-action-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  return svg;
}

function svgPath(d: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  return path;
}

function svgRect(x: number, y: number, w: number, h: number, rx: number): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('rx', String(rx));
  return rect;
}

function svgCircle(cx: number, cy: number, r: number): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(r));
  return circle;
}
