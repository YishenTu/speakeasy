import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';

const rootDir = process.cwd();
const distDir = join(rootDir, 'dist');

const staticFileCopies: ReadonlyArray<[string, string]> = [
  ['src/manifest.json', 'manifest.json'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/options/options.html', 'options.html'],
];

async function cleanDist(): Promise<void> {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function buildTypeScript(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [
      join(rootDir, 'src/background/background.ts'),
      join(rootDir, 'src/popup/popup.ts'),
      join(rootDir, 'src/options/options.ts'),
    ],
    outdir: distDir,
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

async function buildTailwind(): Promise<void> {
  await $`bunx tailwindcss -c ./tailwind.config.js -i ./src/styles/tailwind.css -o ./dist/ui.css --minify`;
}

async function copyStaticFiles(): Promise<void> {
  await Promise.all(
    staticFileCopies.map(([sourcePath, outputName]) =>
      cp(join(rootDir, sourcePath), join(distDir, outputName)),
    ),
  );
}

async function main(): Promise<void> {
  await cleanDist();
  await Promise.all([buildTypeScript(), buildTailwind()]);
  await copyStaticFiles();
  console.log('Build complete: dist/ is ready to load as an unpacked extension.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
