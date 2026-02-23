import Defuddle, { type DefuddleOptions, type DefuddleResponse } from 'defuddle/full';

const SPEAKEASY_OVERLAY_ROOT_SELECTOR = '#speakeasy-overlay-root';
const DEFAULT_EXTRACTED_TEXT_FILE_NAME = 'speakeasy-page-extract.md';
const MAX_EXTRACTED_TEXT_FILE_NAME_LENGTH = 96;

type DefuddleExtractor = {
  parse: () => Pick<DefuddleResponse, 'content' | 'contentMarkdown' | 'title'>;
};

export interface ExtractAndStageCurrentTabTextDependencies {
  stageFromFiles: (files: File[]) => void;
  sourceDocument?: Document;
  sourceUrl?: string;
  parseHtmlToDocument?: (html: string) => Document;
  createDefuddle?: (doc: Document, options: DefuddleOptions) => DefuddleExtractor;
}

interface ExtractedTextFileInput {
  markdown: string;
  title?: string;
}

export async function extractAndStageCurrentTabText(
  dependencies: ExtractAndStageCurrentTabTextDependencies,
): Promise<File> {
  const sourceDocument = dependencies.sourceDocument ?? document;
  const sourceHtml = sourceDocument.documentElement?.outerHTML?.trim() ?? '';
  if (!sourceHtml) {
    throw new Error('Cannot extract page text because current tab HTML is unavailable.');
  }

  const parseHtmlToDocument =
    dependencies.parseHtmlToDocument ??
    ((html: string) => new DOMParser().parseFromString(html, 'text/html'));
  // Defuddle normalizes and mutates document nodes, so extraction must run on a detached copy.
  const extractionDocument = parseHtmlToDocument(sourceHtml);
  extractionDocument.querySelector(SPEAKEASY_OVERLAY_ROOT_SELECTOR)?.remove();

  const createDefuddle =
    dependencies.createDefuddle ??
    ((doc: Document, options: DefuddleOptions) => new Defuddle(doc, options));
  const extracted = createDefuddle(extractionDocument, {
    url: resolveSourceUrl(dependencies.sourceUrl, sourceDocument),
    markdown: true,
  }).parse();

  const markdown = resolveExtractedMarkdown(extracted);
  if (!markdown) {
    throw new Error('Defuddle returned no readable text for this page.');
  }

  const textFile = toExtractedTextFile({
    markdown,
    title: extracted.title,
  });
  dependencies.stageFromFiles([textFile]);
  return textFile;
}

export function toExtractedTextFile(input: ExtractedTextFileInput): File {
  const markdown = input.markdown.trim();
  if (!markdown) {
    throw new Error('Extracted markdown content cannot be empty.');
  }

  return new File([markdown], normalizeExtractedTextFileName(input.title), {
    type: 'text/plain',
  });
}

function resolveExtractedMarkdown(
  extracted: Pick<DefuddleResponse, 'content' | 'contentMarkdown'>,
): string {
  return extracted.contentMarkdown?.trim() || extracted.content?.trim() || '';
}

function resolveSourceUrl(explicitSourceUrl: string | undefined, sourceDocument: Document): string {
  return explicitSourceUrl?.trim() || sourceDocument.location?.href?.trim() || '';
}

function normalizeExtractedTextFileName(title: string | undefined): string {
  const normalizedBaseName = sanitizeTitleForFileName(title);
  if (!normalizedBaseName) {
    return DEFAULT_EXTRACTED_TEXT_FILE_NAME;
  }

  const truncatedBaseName = normalizedBaseName.slice(0, MAX_EXTRACTED_TEXT_FILE_NAME_LENGTH);
  return `${truncatedBaseName}.md`;
}

function sanitizeTitleForFileName(title: string | undefined): string {
  return (
    title
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ?? ''
  );
}
