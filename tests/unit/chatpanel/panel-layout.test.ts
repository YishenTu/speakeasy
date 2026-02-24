import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type InstalledDomEnvironment, installDomTestEnvironment } from '../helpers/dom-test-env';

let env: InstalledDomEnvironment;

beforeAll(() => {
  env = installDomTestEnvironment();
});

afterAll(() => {
  env.restore();
});

// Lazy import so `window` is defined when the module first evaluates
type PanelLayoutModule = typeof import('../../../src/chatpanel/features/layout/panel-layout');

const getModule = () =>
  require('../../../src/chatpanel/features/layout/panel-layout') as PanelLayoutModule;

describe('clampPanelLayout', () => {
  test('clamps width and height to viewport bounds', () => {
    const { clampPanelLayout } = getModule();
    const result = clampPanelLayout({
      width: 50000,
      height: 50000,
      left: 0,
      top: 0,
    });
    expect(result.width).toBeLessThanOrEqual(window.innerWidth);
    expect(result.height).toBeLessThanOrEqual(window.innerHeight);
  });

  test('clamps left and top to minimum margin', () => {
    const { clampPanelLayout } = getModule();
    const result = clampPanelLayout({
      width: 320,
      height: 260,
      left: -100,
      top: -100,
    });
    expect(result.left).toBeGreaterThanOrEqual(12);
    expect(result.top).toBeGreaterThanOrEqual(12);
  });

  test('prevents panel from going off the right or bottom edge', () => {
    const { clampPanelLayout } = getModule();
    const result = clampPanelLayout({
      width: 320,
      height: 260,
      left: 99999,
      top: 99999,
    });
    expect(result.left + result.width + 12).toBeLessThanOrEqual(window.innerWidth);
    expect(result.top + result.height + 12).toBeLessThanOrEqual(window.innerHeight);
  });

  test('preserves valid layout values within bounds', () => {
    const { clampPanelLayout } = getModule();
    const input = { width: 400, height: 500, left: 100, top: 50 };
    const result = clampPanelLayout(input);
    expect(result.width).toBe(400);
    expect(result.height).toBe(500);
    expect(result.left).toBe(100);
    expect(result.top).toBe(50);
  });
});

describe('createDefaultLayout', () => {
  test('returns a valid layout with positive dimensions', () => {
    const { createDefaultLayout } = getModule();
    const layout = createDefaultLayout();
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.left).toBeGreaterThanOrEqual(12);
    expect(layout.top).toBeGreaterThanOrEqual(12);
  });
});

describe('applyPanelLayout', () => {
  test('sets style properties on the shell element', () => {
    const { applyPanelLayout } = getModule();
    const shell = document.createElement('div');
    applyPanelLayout(shell, { width: 430, height: 600, left: 100, top: 50 });
    expect(shell.style.width).toBe('430px');
    expect(shell.style.height).toBe('600px');
    expect(shell.style.left).toBe('100px');
    expect(shell.style.top).toBe('50px');
  });
});

describe('createPanelLayoutController', () => {
  test('restores panel size after transient viewport shrink and recovery', () => {
    const { createPanelLayoutController } = getModule();
    const shell = document.createElement('div');
    const dragHandle = document.createElement('div');
    document.body.append(shell, dragHandle);

    env.window.innerWidth = 1200;
    env.window.innerHeight = 900;

    const controller = createPanelLayoutController({
      shell,
      dragHandle,
      resizeHandles: [],
      onLayoutApplied: () => {},
    });

    controller.clampAndSync();

    const stableWidth = shell.style.width;
    const stableHeight = shell.style.height;
    expect(stableWidth).toBe('430px');
    expect(stableHeight).toBe('720px');

    env.window.innerWidth = 300;
    env.window.innerHeight = 320;
    window.dispatchEvent(new Event('resize'));
    expect(shell.style.width).toBe('276px');
    expect(shell.style.height).toBe('296px');

    env.window.innerWidth = 1200;
    env.window.innerHeight = 900;
    window.dispatchEvent(new Event('resize'));
    expect(shell.style.width).toBe(stableWidth);
    expect(shell.style.height).toBe(stableHeight);

    controller.dispose();
    shell.remove();
    dragHandle.remove();
  });
});
