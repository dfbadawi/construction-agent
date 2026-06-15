import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { toPgVector } from "../src/storage/embeddings";
import { db } from "../src/storage/db";
import { applySchema, postgresAvailable } from "./helpers/postgres";

function makeVector(values: Record<number, number> = {}): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  for (const [index, value] of Object.entries(values)) {
    vector[Number(index)] = value;
  }
  return vector;
}

const queryVector = makeVector({ 0: 1 });
const mockEmbedTexts = mock(async (_texts: string[]) => [queryVector]);

mock.module("../src/storage/embeddings", () => ({
  embedTexts: mockEmbedTexts,
  toPgVector,
}));

import { formatCitation, searchKnowledge } from "../src/agent/tools/search";

interface ChunkSeed {
  source: "planset" | "specs";
  source_file?: string | null;
  page_number?: number | null;
  page_end?: number | null;
  section_id?: string | null;
  section_title?: string | null;
  content: string;
  vector: number[];
}

async function seedDocumentChunk(chunk: ChunkSeed): Promise<void> {
  await db`
    INSERT INTO document_chunks (
      source, source_file, page_number, page_end, section_id, section_title, content, embedding
    ) VALUES (
      ${chunk.source},
      ${chunk.source_file ?? null},
      ${chunk.page_number ?? null},
      ${chunk.page_end ?? null},
      ${chunk.section_id ?? null},
      ${chunk.section_title ?? null},
      ${chunk.content},
      ${toPgVector(chunk.vector)}
    )
  `;
}

describe("searchKnowledge", () => {
  beforeAll(async () => {
    if (!postgresAvailable) {
      console.warn("Postgres unavailable — skipping searchKnowledge integration tests");
      return;
    }
    await applySchema();
  });

  beforeEach(async () => {
    mockEmbedTexts.mockReset();
    mockEmbedTexts.mockImplementation(async (_texts: string[]) => [queryVector]);
    if (!postgresAvailable) {
      return;
    }
    await db`TRUNCATE document_chunks RESTART IDENTITY`;
  });

  test("formats specification citations with file, pages, and section", () => {
    expect(
      formatCitation({
        source: "specs",
        source_file: "specifications-vol-1.pdf",
        page_number: 303,
        page_end: 308,
        section_id: "D-705",
        section_title: "PIPE UNDERDRAINS FOR AIRPORTS (part 1)",
      }),
    ).toBe(
      "specifications-vol-1.pdf, pages 303\u2013308, section D-705 \u2013 PIPE UNDERDRAINS FOR AIRPORTS (part 1)",
    );
  });

  test.skipIf(!postgresAvailable)("returns matching chunks ordered by similarity", async () => {
    await seedDocumentChunk({
      source: "planset",
      source_file: "plans.pdf",
      page_number: 8,
      page_end: 8,
      section_title: "DRAINAGE PLAN",
      content: "Drainage details for apron underdrain system.",
      vector: makeVector({ 1: 1 }),
    });
    await seedDocumentChunk({
      source: "planset",
      source_file: "plans.pdf",
      page_number: 12,
      page_end: 12,
      section_title: "DEMOLITION PLAN",
      content: "REMOVE 130 L.F. of Underdrain System.",
      vector: makeVector({ 0: 1 }),
    });

    const result = await searchKnowledge({
      query: "underdrain removal",
      min_similarity: 0,
      limit: 5,
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]!.page_number).toBe(12);
    expect(result.chunks[0]!.similarity).toBeGreaterThan(result.chunks[1]!.similarity);
  });

  test.skipIf(!postgresAvailable)("honors source_filter", async () => {
    await seedDocumentChunk({
      source: "planset",
      page_number: 12,
      content: "Plan set underdrain removal note.",
      vector: makeVector({ 0: 1 }),
    });
    await seedDocumentChunk({
      source: "specs",
      source_file: "specifications-vol-1.pdf",
      page_number: 301,
      page_end: 304,
      section_id: "D-705",
      section_title: "PIPE UNDERDRAINS FOR AIRPORTS",
      content: "Specification text for pipe underdrains.",
      vector: makeVector({ 0: 0.95 }),
    });

    const result = await searchKnowledge({
      query: "underdrains",
      source_filter: "specs",
      min_similarity: 0,
      limit: 5,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.source).toBe("specs");
  });
});
