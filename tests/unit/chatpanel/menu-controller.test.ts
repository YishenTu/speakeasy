import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createMenuController } from '../../../src/chatpanel/core/menu-controller';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

describe('menu controller', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment(
      '<!doctype html><html><body><div id="control"><button id="trigger"></button></div><div id="outside"></div></body></html>',
    );
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
  });

  it('toggles open class and aria-expanded state', () => {
    const control = document.getElementById('control') as HTMLDivElement | null;
    const trigger = document.getElementById('trigger') as HTMLButtonElement | null;
    expect(control).not.toBeNull();
    expect(trigger).not.toBeNull();
    if (!control || !trigger) {
      throw new Error('Expected menu test nodes.');
    }

    const controller = createMenuController({
      container: control,
      trigger,
    });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(control.classList.contains('open')).toBe(false);

    controller.setOpen(true);
    expect(controller.isOpen()).toBe(true);
    expect(control.classList.contains('open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    controller.toggle();
    expect(controller.isOpen()).toBe(false);
    expect(control.classList.contains('open')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when pointerdown occurs outside the control', () => {
    const testWindow = dom?.window;
    const control = document.getElementById('control') as HTMLDivElement | null;
    const trigger = document.getElementById('trigger') as HTMLButtonElement | null;
    const outside = document.getElementById('outside') as HTMLDivElement | null;
    if (!testWindow || !control || !trigger || !outside) {
      throw new Error('Expected menu test nodes.');
    }

    const controller = createMenuController({
      container: control,
      trigger,
      closeOnOutsidePointerDown: {
        target: document,
        isInside: (event) => {
          const eventPath = event.composedPath?.() ?? [];
          return eventPath.includes(control);
        },
      },
    });

    controller.setOpen(true);
    trigger.dispatchEvent(new testWindow.Event('pointerdown', { bubbles: true, composed: true }));
    expect(controller.isOpen()).toBe(true);

    outside.dispatchEvent(new testWindow.Event('pointerdown', { bubbles: true, composed: true }));
    expect(controller.isOpen()).toBe(false);
  });

  it('stops handling outside events after dispose', () => {
    const testWindow = dom?.window;
    const control = document.getElementById('control') as HTMLDivElement | null;
    const outside = document.getElementById('outside') as HTMLDivElement | null;
    if (!testWindow || !control || !outside) {
      throw new Error('Expected menu test nodes.');
    }

    const controller = createMenuController({
      container: control,
      closeOnOutsidePointerDown: {
        target: document,
        isInside: (event) => {
          const eventPath = event.composedPath?.() ?? [];
          return eventPath.includes(control);
        },
      },
    });

    controller.setOpen(true);
    controller.dispose();

    outside.dispatchEvent(new testWindow.Event('pointerdown', { bubbles: true, composed: true }));
    expect(controller.isOpen()).toBe(true);
  });
});
