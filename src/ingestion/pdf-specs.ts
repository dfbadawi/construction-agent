import { PDFParse } from "pdf-parse";
import type { Chunk } from "../types";
import { resolveInputPath, sourceFileName } from "../utils/path";

const MIN_TOTAL_TEXT_CHARS = 500;
const MIN_CHUNK_CHARS = 80;
const MAX_CHUNK_CHARS = 8000;
const TARGET_SUBCHUNK_MIN = 4000;
const TARGET_SUBCHUNK_MAX = 6000;

const SECTION_NUMBER_RE = /^SECTION\s+(\d{1,3})\s*$/i;
const TECH_SPEC_RE = /^([A-Z]-\d{3}(?:\s+[A-Z]+)?)\s*(?:-|–|—)\s*(.+)$/;
const DEFINITION_RE = /^(\d{2}-\d{2})\s+([A-Z][A-Z\s/\-]+?)(?:\.\s|$)/;

export function hasUsableTextLayer(text: string, pageCount: number): boolean {
  const trimmed = text.trim();
  const avgCharsPerPage = trimmed.length / Math.max(pageCount, 1);
  const hasLikelyTextLayer = avgCharsPerPage >= 200;
  const hasSectionMarkers =
    /SECTION\s+\d+/i.test(trimmed) ||
    /\b[A-Z]-\d{3}\b/.test(trimmed) ||
    /\d{2}-\d{2}\s+[A-Z]/.test(trimmed);
  return hasLikelyTextLayer && hasSectionMarkers;
}

function isSectionTitleLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) {
    return false;
  }
  return /^[A-Z0-9][A-Z0-9\s,/\-–—&()'']+$/.test(trimmed);
}

interface ParsedHeading {
  consumedLines: number;
  section_id: string;
  section_title: string;
}

function parseHeadingAt(lines: string[], index: number): ParsedHeading | null {
  const line = lines[index]?.trim() ?? "";

  const definitionMatch = line.match(DEFINITION_RE);
  if (definitionMatch) {
    return {
      consumedLines: 1,
      section_id: definitionMatch[1],
      section_title: definitionMatch[2].trim(),
    };
  }

  const techMatch = line.match(TECH_SPEC_RE);
  if (techMatch) {
    return {
      consumedLines: 1,
      section_id: techMatch[1],
      section_title: techMatch[2].trim(),
    };
  }

  const sectionMatch = line.match(SECTION_NUMBER_RE);
  if (!sectionMatch) {
    return null;
  }

  const sectionNum = sectionMatch[1];
  const nextLine = lines[index + 1]?.trim() ?? "";

  const techNextMatch = nextLine.match(TECH_SPEC_RE);
  if (techNextMatch) {
    return {
      consumedLines: 2,
      section_id: techNextMatch[1],
      section_title: techNextMatch[2].trim(),
    };
  }

  if (isSectionTitleLine(nextLine)) {
    return {
      consumedLines: 2,
      section_id: `SECTION ${sectionNum}`,
      section_title: nextLine,
    };
  }

  return null;
}

function splitLongChunk(
  chunk: Chunk,
  lines: string[],
  linePages: number[],
  contentStart: number,
  contentEnd: number,
): Chunk[] {
  const sectionLines = lines.slice(contentStart, contentEnd);
  const sectionLinePages = linePages.slice(contentStart, contentEnd);

  if (chunk.content.length <= MAX_CHUNK_CHARS) {
    return [
      {
        ...chunk,
        page_number: sectionLinePages[0],
        page_end: sectionLinePages[sectionLinePages.length - 1],
      },
    ];
  }

  const subchunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentPageStart: number | undefined;
  let currentPageEnd: number | undefined;
  let currentLength = 0;

  const flush = () => {
    if (currentLines.length === 0) {
      return;
    }
    subchunks.push({
      ...chunk,
      content: currentLines.join("\n"),
      page_number: currentPageStart,
      page_end: currentPageEnd,
    });
    currentLines = [];
    currentLength = 0;
    currentPageStart = undefined;
    currentPageEnd = undefined;
  };

  for (let index = 0; index < sectionLines.length; index++) {
    const line = sectionLines[index]!;
    const lineLength = line.length + 1;
    if (
      currentLength > 0 &&
      currentLength + lineLength > TARGET_SUBCHUNK_MAX &&
      currentLength >= TARGET_SUBCHUNK_MIN
    ) {
      flush();
    }
    if (currentPageStart === undefined) {
      currentPageStart = sectionLinePages[index];
    }
    currentPageEnd = sectionLinePages[index];
    currentLines.push(line);
    currentLength += lineLength;
  }

  flush();

  if (subchunks.length <= 1) {
    return [
      {
        ...chunk,
        page_number: sectionLinePages[0],
        page_end: sectionLinePages[sectionLinePages.length - 1],
      },
    ];
  }

  return subchunks.map((part, index) => ({
    ...part,
    section_title: `${chunk.section_title} (part ${index + 1})`,
  }));
}

interface RawSpecsChunk {
  chunk: Chunk;
  contentStart: number;
  contentEnd: number;
}

export function buildPageAwareLines(
  pages: Array<{ num: number; text: string }>,
): { text: string; lines: string[]; linePages: number[] } {
  const lines: string[] = [];
  const linePages: number[] = [];

  for (const page of pages) {
    const pageLines = page.text.replace(/\r\n/g, "\n").split("\n");
    for (const line of pageLines) {
      lines.push(line);
      linePages.push(page.num);
    }
  }

  return { text: lines.join("\n"), lines, linePages };
}

export function splitSpecsIntoChunks(text: string, linePages: number[] = []): Chunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headings: Array<ParsedHeading & { lineIndex: number }> = [];

  for (let index = 0; index < lines.length; index++) {
    const heading = parseHeadingAt(lines, index);
    if (heading) {
      headings.push({ ...heading, lineIndex: index });
      index += heading.consumedLines - 1;
    }
  }

  const rawChunks: RawSpecsChunk[] = [];

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const nextHeading = headings[index + 1];
    const contentStart = heading.lineIndex;
    const contentEnd = nextHeading ? nextHeading.lineIndex : lines.length;
    const content = lines.slice(contentStart, contentEnd).join("\n").trim();

    if (content.length < MIN_CHUNK_CHARS) {
      continue;
    }

    rawChunks.push({
      chunk: {
        source: "specs",
        section_id: heading.section_id,
        section_title: heading.section_title,
        content,
        page_number: linePages[contentStart],
        page_end: linePages[contentEnd - 1],
      },
      contentStart,
      contentEnd,
    });
  }

  return rawChunks.flatMap(({ chunk, contentStart, contentEnd }) =>
    splitLongChunk(chunk, lines, linePages, contentStart, contentEnd),
  );
}

async function extractPdfText(
  filePath: string,
): Promise<{ text: string; pageCount: number; linePages: number[] }> {
  const data = new Uint8Array(await Bun.file(filePath).arrayBuffer());
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const { text, linePages } = buildPageAwareLines(result.pages);
    return {
      text,
      pageCount: result.total || 1,
      linePages,
    };
  } finally {
    await parser.destroy();
  }
}

export async function ingestSpecs(filePath: string): Promise<Chunk[]> {
  const resolvedPath = resolveInputPath(filePath);
  const sourceFile = sourceFileName(filePath);

  let text: string;
  let pageCount: number;
  let linePages: number[];

  try {
    ({ text, pageCount, linePages } = await extractPdfText(resolvedPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse specs PDF: ${message}`);
  }

  if (text.trim().length < MIN_TOTAL_TEXT_CHARS) {
    throw new Error(
      `Specs PDF extracted too little text (${text.trim().length} characters). Direct extraction may have failed.`,
    );
  }

  if (!hasUsableTextLayer(text, pageCount)) {
    throw new Error(
      "Specs PDF does not have a usable text layer for direct extraction. Re-ingest with a PDF that has selectable text.",
    );
  }

  console.log(`Splitting specification text from ${pageCount} pages into sections...`);
  const chunks = splitSpecsIntoChunks(text, linePages).map((chunk) => ({
    ...chunk,
    source_file: sourceFile,
  }));

  if (chunks.length === 0) {
    throw new Error("No specification sections found in PDF text.");
  }

  console.log(`Created ${chunks.length} specification chunks`);
  return chunks;
}
