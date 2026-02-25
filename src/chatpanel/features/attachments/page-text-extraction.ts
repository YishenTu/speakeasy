import { Readability } from '@mozilla/readability';
import Defuddle, { type DefuddleOptions, type DefuddleResponse } from 'defuddle/full';
import TurndownService from 'turndown';
import type { TabExtractTextPayload } from '../../../shared/runtime';
import {
  DEFAULT_PAGE_TEXT_EXTRACTION_ENGINE,
  type PageTextExtractionEngine,
} from '../../../shared/settings';
import {
  type PageTextExtractionPreprocessInput,
  resolvePageTextPreprocessSourceHtml,
} from './page-text-extraction-plugins/runtime';

const SPEAKEASY_OVERLAY_ROOT_SELECTOR = '#speakeasy-overlay-root';
const DEFAULT_EXTRACTED_TEXT_FILE_BASENAME = 'speakeasy-page-extract';
const MAX_EXTRACTED_TEXT_FILE_NAME_LENGTH = 96;

type DefuddleExtractor = {
  parse: () => Pick<DefuddleResponse, 'content' | 'contentMarkdown' | 'title'>;
};

type ReadabilityExtractor = {
  parse: () => ReadabilityParseResult | null;
};

type ReadabilityParseResult = {
  content: string | null | undefined;
  textContent: string | null | undefined;
  title: string | null | undefined;
};

interface ExtractedPageContent {
  markdown: string;
}

interface ExtractionEngineAdapterInput {
  extractionDocument: Document;
  sourceUrl: string;
  parseHtmlToDocument: (html: string) => Document;
  createDefuddle: ((doc: Document, options: DefuddleOptions) => DefuddleExtractor) | undefined;
  createReadability: ((doc: Document) => ReadabilityExtractor) | undefined;
  convertHtmlToMarkdown: ((html: string) => string) | undefined;
}

type ExtractionEngineAdapter = (input: ExtractionEngineAdapterInput) => ExtractedPageContent;
type PreprocessSourceHtml = (input: PageTextExtractionPreprocessInput) => string;

export interface ExtractCurrentTabTextDependencies {
  extractionEngine?: PageTextExtractionEngine;
  sourceDocument?: Document;
  sourceTitle?: string;
  sourceUrl?: string;
  parseHtmlToDocument?: (html: string) => Document;
  createDefuddle?: (doc: Document, options: DefuddleOptions) => DefuddleExtractor;
  createReadability?: (doc: Document) => ReadabilityExtractor;
  convertHtmlToMarkdown?: (html: string) => string;
  preprocessSourceHtml?: PreprocessSourceHtml;
  resolvePreprocessSourceHtml?: () => Promise<PreprocessSourceHtml>;
}

export interface ExtractAndStageCurrentTabTextDependencies
  extends ExtractCurrentTabTextDependencies {
  stageFromFiles: (files: File[]) => void;
}

interface ExtractedTextFileInput {
  markdown: string;
  title?: string;
}

export async function extractAndStageCurrentTabText(
  dependencies: ExtractAndStageCurrentTabTextDependencies,
): Promise<File> {
  const extractedPayload = await extractCurrentTabTextWithPlugins(dependencies);
  const textFile = toExtractedTextFile({
    markdown: extractedPayload.markdown,
    title: extractedPayload.title,
  });
  dependencies.stageFromFiles([textFile]);
  return textFile;
}

export async function extractCurrentTabTextWithPlugins(
  dependencies: ExtractCurrentTabTextDependencies = {},
): Promise<TabExtractTextPayload> {
  const resolvePreprocessSourceHtml =
    dependencies.resolvePreprocessSourceHtml ?? resolvePageTextPreprocessSourceHtml;
  const preprocessSourceHtml =
    dependencies.preprocessSourceHtml ?? (await resolvePreprocessSourceHtml());
  return extractCurrentTabText({
    ...dependencies,
    preprocessSourceHtml,
  });
}

export function extractCurrentTabText(
  dependencies: ExtractCurrentTabTextDependencies = {},
): TabExtractTextPayload {
  const sourceDocument = dependencies.sourceDocument ?? document;
  const sourceHtml = sourceDocument.documentElement?.outerHTML?.trim() ?? '';
  if (!sourceHtml) {
    throw new Error('Cannot extract page text because current tab HTML is unavailable.');
  }

  const sourceUrl = resolveSourceUrl(dependencies.sourceUrl, sourceDocument);
  const parseHtmlToDocument =
    dependencies.parseHtmlToDocument ??
    ((html: string) => new DOMParser().parseFromString(html, 'text/html'));
  const preprocessSourceHtml = dependencies.preprocessSourceHtml ?? ((input) => input.sourceHtml);
  const preprocessedSourceHtml = preprocessSourceHtml({
    sourceHtml,
    sourceUrl,
    parseHtmlToDocument,
  });
  if (!preprocessedSourceHtml.trim()) {
    throw new Error('Cannot extract page text because preprocessed HTML is empty.');
  }

  // Defuddle normalizes and mutates document nodes, so extraction must run on a detached copy.
  const extractionDocument = parseHtmlToDocument(preprocessedSourceHtml);
  extractionDocument.querySelector(SPEAKEASY_OVERLAY_ROOT_SELECTOR)?.remove();

  const extractionEngine = dependencies.extractionEngine ?? DEFAULT_PAGE_TEXT_EXTRACTION_ENGINE;
  const content = extractPageContentByEngine({
    extractionDocument,
    sourceUrl,
    parseHtmlToDocument,
    extractionEngine,
    createDefuddle: dependencies.createDefuddle,
    createReadability: dependencies.createReadability,
    convertHtmlToMarkdown: dependencies.convertHtmlToMarkdown,
  });
  if (!content.markdown) {
    throw new Error(
      `${toExtractionEngineLabel(extractionEngine)} returned no readable text for this page.`,
    );
  }

  const sourceTitle = resolveSourceTitle(dependencies.sourceTitle, sourceDocument);
  return {
    markdown: content.markdown,
    title: sourceTitle,
    url: sourceUrl,
  };
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

const EXTRACT_CONTENT_ADAPTERS: Record<PageTextExtractionEngine, ExtractionEngineAdapter> = {
  defuddle: extractContentWithDefuddle,
  readability: extractContentWithReadability,
};

interface ExtractPageContentByEngineInput extends ExtractionEngineAdapterInput {
  extractionEngine: PageTextExtractionEngine;
}

function extractPageContentByEngine(input: ExtractPageContentByEngineInput): ExtractedPageContent {
  const extract = EXTRACT_CONTENT_ADAPTERS[input.extractionEngine];
  return extract(input);
}

function extractContentWithDefuddle(input: ExtractionEngineAdapterInput): ExtractedPageContent {
  const createDefuddle =
    input.createDefuddle ??
    ((doc: Document, options: DefuddleOptions) => new Defuddle(doc, options));
  const extracted = createDefuddle(input.extractionDocument, {
    url: input.sourceUrl,
    markdown: true,
  }).parse();
  return { markdown: resolveExtractedMarkdown(extracted) };
}

function extractContentWithReadability(input: ExtractionEngineAdapterInput): ExtractedPageContent {
  const createReadability = input.createReadability ?? ((doc: Document) => new Readability(doc));
  const parsed = createReadability(input.extractionDocument).parse();
  if (!parsed) {
    return { markdown: '' };
  }

  const convertHtmlToMarkdown =
    input.convertHtmlToMarkdown ??
    ((html: string) => convertHtmlToMarkdownWithTurndown(html, input.parseHtmlToDocument));

  const markdownFromHtml = convertHtmlToMarkdown(parsed.content ?? '').trim();
  if (markdownFromHtml) {
    return { markdown: markdownFromHtml };
  }

  return { markdown: normalizeReadabilityText(parsed.textContent ?? '') };
}

function convertHtmlToMarkdownWithTurndown(
  html: string,
  parseHtmlToDocument: (html: string) => Document,
): string {
  const content = html.trim();
  if (!content) {
    return '';
  }

  const readabilityDocument = parseHtmlToDocument(content);
  const body = readabilityDocument.body;
  if (!body) {
    return '';
  }

  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
  });

  return turndown.turndown(body).trim();
}

function normalizeReadabilityText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('\n');
}

function toExtractionEngineLabel(engine: PageTextExtractionEngine): string {
  return engine === 'readability' ? 'Readability' : 'Defuddle';
}

function resolveSourceUrl(explicitSourceUrl: string | undefined, sourceDocument: Document): string {
  return explicitSourceUrl?.trim() || sourceDocument.location?.href?.trim() || '';
}

function normalizeExtractedTextFileName(title: string | undefined): string {
  const normalizedBaseName = sanitizeTitleForFileName(title);
  return `${normalizedBaseName}.md`;
}

function sanitizeTitleForFileName(title: string | undefined): string {
  const collapsedWhitespace = (title ?? '').replace(/\s+/g, ' ').trim();
  const withoutControlCharacters = stripAsciiControlCharacters(collapsedWhitespace);
  const sanitized = withoutControlCharacters
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return DEFAULT_EXTRACTED_TEXT_FILE_BASENAME;
  }

  const truncated = sanitized.slice(0, MAX_EXTRACTED_TEXT_FILE_NAME_LENGTH).trim();
  return truncated || DEFAULT_EXTRACTED_TEXT_FILE_BASENAME;
}

function resolveSourceTitle(
  explicitSourceTitle: string | undefined,
  sourceDocument: Document,
): string {
  const explicit = explicitSourceTitle?.trim();
  if (explicit) {
    return explicit;
  }

  return sourceDocument.title?.trim() ?? '';
}

function stripAsciiControlCharacters(input: string): string {
  let result = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    result += code <= 0x1f || code === 0x7f ? ' ' : ch;
  }
  return result;
}
