import { execSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { $ } from 'bun';

const rootDir = process.cwd();
const distDir = resolveDistDir();
const mirrorDistDir = resolveMirrorDistDir(distDir);

function resolveDistDir(): string {
  if (process.env.DIST_DIR) {
    return resolve(process.env.DIST_DIR);
  }
  return join(rootDir, 'dist');
}

function resolveMirrorDistDir(primaryDistDir: string): string | undefined {
  if (process.env.DIST_DIR) {
    return undefined;
  }

  try {
    const gitCommonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
      encoding: 'utf-8',
    }).trim();
    const mainRepoDistDir = join(dirname(gitCommonDir), 'dist');
    if (resolve(mainRepoDistDir) === resolve(primaryDistDir)) {
      return undefined;
    }
    return mainRepoDistDir;
  } catch {
    return undefined;
  }
}

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
  // Tailwind's bundled Browserslist data can become stale independently of this project.
  await $`BROWSERSLIST_IGNORE_OLD_DATA=true bunx tailwindcss -c ./tailwind.config.js -i ./src/styles/tailwind.css -o ${join(outDir, 'ui.css')} --minify`;
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
  await sanitizeJavaScriptBundles(outDir);
}

async function mirrorBuildArtifacts(sourceDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

async function sanitizeJavaScriptBundles(rootDirPath: string): Promise<void> {
  const entries = await readdir(rootDirPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootDirPath, entry.name);
      if (entry.isDirectory()) {
        await sanitizeJavaScriptBundles(entryPath);
        return;
      }

      if (!entry.isFile() || !entry.name.endsWith('.js')) {
        return;
      }

      const source = await readFile(entryPath, 'utf8');
      const sanitized = escapeUnicodeNoncharacters(source);
      if (sanitized !== source) {
        await writeFile(entryPath, sanitized, 'utf8');
      }
    }),
  );
}

export function escapeUnicodeNoncharacters(source: string): string {
  return Array.from(source, (character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isUnicodeNoncharacter(codePoint)) {
      return character;
    }

    return escapeCodePointAsUnicodeSequence(codePoint);
  }).join('');
}

function isUnicodeNoncharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint <= 0x10ffff && (codePoint & 0xfffe) === 0xfffe)
  );
}

function escapeCodePointAsUnicodeSequence(codePoint: number): string {
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  }

  const scalar = codePoint - 0x10000;
  const highSurrogate = 0xd800 + (scalar >> 10);
  const lowSurrogate = 0xdc00 + (scalar & 0x3ff);
  return (
    `\\u${highSurrogate.toString(16).toUpperCase().padStart(4, '0')}` +
    `\\u${lowSurrogate.toString(16).toUpperCase().padStart(4, '0')}`
  );
}

export async function buildExtension(): Promise<void> {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await buildArtifacts(distDir);
  if (mirrorDistDir) {
    await mirrorBuildArtifacts(distDir, mirrorDistDir);
    console.log(
      `Build complete: ${distDir} is ready. Mirrored artifacts to ${mirrorDistDir} for extension loading.`,
    );
    return;
  }

  console.log(`Build complete: ${distDir} is ready to load as an unpacked extension.`);
}

if (import.meta.main) {
  buildExtension().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
