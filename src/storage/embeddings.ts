import OpenAI from "openai";
import { config, requireOpenAIKey } from "../config";
import type { Chunk } from "../types";
import { chunkArray } from "../utils/chunk";
import { db } from "./db";

const EMBEDDING_DIMENSIONS = 1536;
const EMBED_BATCH_SIZE = 100;
const INSERT_BATCH_SIZE = 50;

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: requireOpenAIKey() });
  }
  return openaiClient;
}

export function sanitizeChunkContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function toPgVector(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected 1536-dimensional embedding, got ${vector.length}.`);
  }
  return `[${vector.join(",")}]`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const cleaned = texts.map(sanitizeChunkContent);
  const openai = getOpenAI();
  const vectors: number[][] = [];

  for (const batch of chunkArray(cleaned, EMBED_BATCH_SIZE)) {
    const response = await openai.embeddings.create({
      model: config.embeddingModel,
      input: batch,
    });

    const batchVectors = response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    vectors.push(...batchVectors);
  }

  return vectors;
}

export async function storeChunks(chunks: Chunk[]): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const sanitizedContents = chunks.map((chunk) => sanitizeChunkContent(chunk.content));
  const vectors = await embedTexts(sanitizedContents);

  const rows = chunks.map((chunk, index) => ({
    source: chunk.source,
    source_file: chunk.source_file ?? null,
    page_number: chunk.page_number ?? null,
    page_end: chunk.page_end ?? null,
    section_id: chunk.section_id ?? null,
    section_title: chunk.section_title ?? null,
    content: sanitizedContents[index]!,
    embedding: toPgVector(vectors[index]!),
  }));

  for (const batch of chunkArray(rows, INSERT_BATCH_SIZE)) {
    await db`
      INSERT INTO document_chunks ${db(batch, [
        "source",
        "source_file",
        "page_number",
        "page_end",
        "section_id",
        "section_title",
        "content",
        "embedding",
      ])}
    `;
  }
}
