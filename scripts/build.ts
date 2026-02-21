import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';

const rootDir = process.cwd();
const distDir = join(rootDir, 'dist');

const staticFileCopies: ReadonlyArray<[string, string]> = [
  ['src/manifest.json', 'manifest.json'],
  ['src/options/options.html', 'options.html'],
];

const iconDir = 'src/icons';
const iconFiles = [
  'gemini-icon-logo.svg',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
];

async function buildTypeScript(outDir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [
      join(rootDir, 'src/background/background.ts'),
      join(rootDir, 'src/chatpanel/chatpanel.ts'),
      join(rootDir, 'src/options/options.ts'),
    ],
    outdir: outDir,
    naming: '[name].[ext]',
    target: 'browser',
    format: 'esm',
    sourcemap: 'external',
    minify: true,
  });

  if (result.success) {
    return;
  }

  for (const log of result.logs) {
    console.error(log);
  }

  throw new Error('TypeScript build failed.');
}

async function buildTailwind(outDir: string): Promise<void> {
  await $`bunx tailwindcss -c ./tailwind.config.js -i ./src/styles/tailwind.css -o ${join(outDir, 'ui.css')} --minify`;
}

async function copyStaticFiles(outDir: string): Promise<void> {
  const iconsDistDir = join(outDir, 'icons');
  await mkdir(iconsDistDir, { recursive: true });
  await Promise.all([
    ...staticFileCopies.map(([sourcePath, outputName]) =>
      cp(join(rootDir, sourcePath), join(outDir, outputName)),
    ),
    ...iconFiles.map((file) => cp(join(rootDir, iconDir, file), join(iconsDistDir, file))),
  ]);
}

async function buildArtifacts(outDir: string): Promise<void> {
  await Promise.all([buildTypeScript(outDir), buildTailwind(outDir)]);
  await copyStaticFiles(outDir);
}

export async function buildExtension(): Promise<void> {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await buildArtifacts(distDir);
  console.log('Build complete: dist/ is ready to load as an unpacked extension.');
}

if (import.meta.main) {
  buildExtension().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
