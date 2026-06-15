import { createCanvas } from "@napi-rs/canvas";
import OpenAI from "openai";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, requireOpenAIKey } from "../config";
import type { Chunk } from "../types";
import { parsePages, resolveInputPath, sourceFileName } from "../utils/path";

type PDFDocumentProxy = Awaited<ReturnType<typeof loadPdfDocument>>;

const OCR_PROMPT = `You are an OCR assistant for engineering construction drawings.

Extract all readable text from this construction plan set page.

Include:
- Sheet title, sheet number, project name, and title block text if visible.
- All annotation labels and callout text.
- All dimension values, measurements, station numbers, and quantities.
- All CAUTION, NOTE, and DEMOLITION NOTES text verbatim.
- Table contents if present.
- Legend items and their descriptions.
- Labels attached to arrows, leaders, hatching, pipes, pavement, markings, or utilities.

If you can identify a section type such as DEMOLITION PLAN, DRAINAGE PLAN, GRADING PLAN, STRIPING PLAN, EROSION CONTROL, or TITLE SHEET, put it on the first line as:
SECTION: <section type>

Return plain text. Preserve hierarchy where visible. If a note list is numbered, keep the numbers.
If the page is mostly a drawing with sparse text, still extract every visible label.
Do not invent missing text. If a word is unreadable, write [illegible].`;

const INFERRED_SECTION_TITLES = [
  "TITLE SHEET",
  "DEMOLITION PLAN",
  "DRAINAGE PLAN",
  "GRADING PLAN",
  "EROSION CONTROL",
  "MARKING",
  "STRIPING",
] as const;

const RENDER_SCALE = 2.0;
const BATCH_SIZE = 3;
const OCR_MAX_TOKENS = 1800;

let pdfWorkerConfigured = false;
let openaiClient: OpenAI | null = null;

function configurePdfWorker(): void {
  if (pdfWorkerConfigured) return;
  const workerPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
  pdfWorkerConfigured = true;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: requireOpenAIKey() });
  }
  return openaiClient;
}

export function selectPlanPages(
  totalPages: number,
  options?: { pages?: number[] },
): number[] {
  const requested = options?.pages?.length
    ? options.pages
    : parsePages(config.ingestPlanPages);

  return [...new Set(requested)]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
}

export function extractPlanSectionTitle(text: string): string | undefined {
  const sectionMatch = text.match(/^SECTION:\s*(.+)$/im);
  if (sectionMatch?.[1]) {
    return sectionMatch[1].trim();
  }

  return inferPlanSectionTitle(text);
}

function inferPlanSectionTitle(text: string): string | undefined {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const upperLine = line.toUpperCase();
    for (const section of INFERRED_SECTION_TITLES) {
      if (upperLine === section || upperLine.endsWith(` - ${section}`)) {
        return section;
      }
    }
  }

  return undefined;
}

export function buildPlanChunk(
  pageNumber: number,
  text: string,
  sourceFile?: string,
): Chunk {
  const content = text.trim();
  if (!content) {
    throw new Error(`Empty OCR result for plan page ${pageNumber}`);
  }

  return {
    source: "planset",
    source_file: sourceFile,
    page_number: pageNumber,
    page_end: pageNumber,
    section_title: extractPlanSectionTitle(text),
    content: text,
  };
}

async function loadPdfDocument(filePath: string): Promise<pdfjs.PDFDocumentProxy> {
  configurePdfWorker();
  const resolvedPath = resolveInputPath(filePath);
  const data = new Uint8Array(await Bun.file(resolvedPath).arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  return loadingTask.promise;
}

async function renderPlanPageToPng(pdf: PDFDocumentProxy, pageNumber: number): Promise<Buffer> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");

  await page.render({
    canvas: null,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  return canvas.toBuffer("image/png");
}

async function ocrPlanPageImage(base64: string, pageNumber: number): Promise<string> {
  const openai = getOpenAIClient();
  const response = await openai.chat.completions.create({
    model: config.chatModel,
    max_tokens: OCR_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error(`OpenAI returned empty OCR text for plan page ${pageNumber}`);
  }
  return text;
}

export async function extractPlanPageText(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const pngBuffer = await renderPlanPageToPng(pdf, pageNumber);
  const base64 = pngBuffer.toString("base64");
  return ocrPlanPageImage(base64, pageNumber);
}

export async function ingestPlanSet(
  filePath: string,
  options?: { pages?: number[] },
): Promise<Chunk[]> {
  const pdf = await loadPdfDocument(filePath);
  const selectedPages = selectPlanPages(pdf.numPages, options);

  if (selectedPages.length === 0) {
    throw new Error(`No valid plan pages selected from ${filePath}`);
  }

  console.log(
    `Plan PDF loaded: ${pdf.numPages} pages total, processing pages [${selectedPages.join(", ")}] (${selectedPages.length} pages)`,
  );

  const chunks: Chunk[] = [];
  const total = selectedPages.length;
  const sourceFile = sourceFileName(filePath);

  for (let index = 0; index < selectedPages.length; index += BATCH_SIZE) {
    const batch = selectedPages.slice(index, index + BATCH_SIZE);
    const batchTexts = await Promise.all(
      batch.map(async (pageNumber, batchIndex) => {
        const step = index + batchIndex + 1;
        console.log(`[${step}/${total}] Processing page ${pageNumber} (render + OCR)...`);
        const text = await extractPlanPageText(pdf, pageNumber);
        const title = extractPlanSectionTitle(text) ?? "untitled";
        console.log(
          `[${step}/${total}] Page ${pageNumber} done — ${title} (${text.trim().length.toLocaleString()} chars)`,
        );
        return text;
      }),
    );

    for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
      chunks.push(buildPlanChunk(batch[batchIndex], batchTexts[batchIndex], sourceFile));
    }
  }

  return chunks;
}
