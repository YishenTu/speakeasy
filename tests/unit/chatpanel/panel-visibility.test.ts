import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createPanelVisibilityController } from '../../../src/chatpanel/app/panel-visibility';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

describe('chatpanel panel visibility controller', () => {
  let dom: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    dom = installDomTestEnvironment();
  });

  afterEach(() => {
    dom?.restore();
    dom = null;
  });

  it('opens panel, clamps layout, and focuses input after loading', async () => {
    const shell = document.createElement('section');
    shell.hidden = true;
    const input = document.createElement('textarea');

    let clampCalls = 0;
    let onOpenCalls = 0;
    const focusSpy = spyOn(input, 'focus').mockImplementation(() => {});
    const controller = createPanelVisibilityController({
      shell,
      input,
      clampLayout: () => {
        clampCalls += 1;
      },
      cancelLayoutInteraction: () => {},
      onOpen: async () => {
        onOpenCalls += 1;
      },
      onClose: () => {},
    });

    await controller.open();

    expect(controller.isOpen()).toBe(true);
    expect(shell.hidden).toBe(false);
    expect(clampCalls).toBe(1);
    expect(onOpenCalls).toBe(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('closes panel and invokes close hooks', async () => {
    const shell = document.createElement('section');
    shell.hidden = true;
    const input = document.createElement('textarea');

    let cancelCalls = 0;
    let onCloseCalls = 0;
    const controller = createPanelVisibilityController({
      shell,
      input,
      clampLayout: () => {},
      cancelLayoutInteraction: () => {
        cancelCalls += 1;
      },
      onOpen: async () => {},
      onClose: () => {
        onCloseCalls += 1;
      },
    });

    await controller.open();
    controller.close();

    expect(controller.isOpen()).toBe(false);
    expect(shell.hidden).toBe(true);
    expect(cancelCalls).toBe(1);
    expect(onCloseCalls).toBe(1);
  });

  it('toggles between open and closed states', async () => {
    const shell = document.createElement('section');
    shell.hidden = true;
    const input = document.createElement('textarea');

    const controller = createPanelVisibilityController({
      shell,
      input,
      clampLayout: () => {},
      cancelLayoutInteraction: () => {},
      onOpen: async () => {},
      onClose: () => {},
    });

    await controller.toggle();
    expect(controller.isOpen()).toBe(true);

    await controller.toggle();
    expect(controller.isOpen()).toBe(false);
  });
});
