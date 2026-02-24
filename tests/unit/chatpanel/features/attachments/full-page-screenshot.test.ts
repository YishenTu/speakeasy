import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  captureAndStageFullPageScreenshot,
  toScreenshotFile,
} from '../../../../../src/chatpanel/features/attachments/full-page-screenshot';
import {
  type InstalledDomEnvironment,
  installDomTestEnvironment,
} from '../../../helpers/dom-test-env';

describe('chatpanel full-page screenshot', () => {
  let env: InstalledDomEnvironment | null = null;

  beforeEach(() => {
    env = installDomTestEnvironment();
  });

  afterEach(() => {
    env?.restore();
    env = null;
  });

  it('captures and stages screenshot files for attachment previews', async () => {
    const stagedFiles: File[][] = [];
    const screenshotFile = await captureAndStageFullPageScreenshot({
      requestFullPageScreenshot: async () => ({
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        mimeType: 'image/png',
        fileName: 'captured-page',
        width: 1000,
        height: 2000,
      }),
      stageFromFiles: (files) => {
        stagedFiles.push(files);
      },
    });

    expect(stagedFiles).toHaveLength(1);
    expect(stagedFiles[0]).toHaveLength(1);
    expect(stagedFiles[0]?.[0]).toBe(screenshotFile);
    expect(screenshotFile.name).toBe('captured-page.png');
    expect(screenshotFile.type).toBe('image/png');
    expect(await screenshotFile.text()).toBe('hello');
  });

  it('rejects screenshots when payload mime type does not match data URL', () => {
    expect(() =>
      toScreenshotFile({
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        mimeType: 'image/jpeg',
        fileName: 'captured-page.png',
        width: 1000,
        height: 2000,
      }),
    ).toThrow(/mime type/i);
  });

  it('accepts payload mime types with parameters when normalized value matches data URL', async () => {
    const screenshotFile = toScreenshotFile({
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      mimeType: 'IMAGE/PNG; charset=utf-8',
      fileName: 'captured-page.png',
      width: 1000,
      height: 2000,
    });

    expect(screenshotFile.type).toBe('image/png');
    expect(await screenshotFile.text()).toBe('hello');
  });

  it('rejects screenshots when data URL payload is malformed', () => {
    expect(() =>
      toScreenshotFile({
        dataUrl: 'not-a-data-url',
        mimeType: 'image/png',
        fileName: 'captured-page.png',
        width: 1000,
        height: 2000,
      }),
    ).toThrow(/invalid data url/i);
  });
});
