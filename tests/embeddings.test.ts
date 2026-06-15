import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { storeChunks, toPgVector } from "../src/storage/embeddings";
import { db } from "../src/storage/db";
import type { Chunk } from "../src/types";
import { applySchema, postgresAvailable } from "./helpers/postgres";

const runOpenAITests = process.env.RUN_OPENAI_TESTS === "true";

function makeVector(values: Record<number, number> = {}): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  for (const [index, value] of Object.entries(values)) {
    vector[Number(index)] = value;
  }
  return vector;
}

describe("embeddings", () => {
  test("formats vectors as pgvector literals", () => {
    const vector = makeVector({ 0: 0, 1: 1, 2: 0.5 });
    expect(toPgVector(vector)).toBe(`[0,1,0.5${",0".repeat(1533)}]`);
  });

  describe("storeChunks integration", () => {
    beforeAll(async () => {
      if (!runOpenAITests || !postgresAvailable) {
        return;
      }
      await applySchema();
    });

    beforeEach(async () => {
      if (!runOpenAITests || !postgresAvailable) {
        return;
      }
      await db`TRUNCATE document_chunks RESTART IDENTITY`;
    });

    test.skipIf(!runOpenAITests || !postgresAvailable)(
      "embeds and stores document chunks",
      async () => {
        const chunks: Chunk[] = [
          {
            source: "planset",
            source_file: "plans.pdf",
            page_number: 12,
            page_end: 12,
            section_title: "DEMOLITION PLAN",
            content: "SECTION: DEMOLITION PLAN\nREMOVE Runway pavement",
          },
          {
            source: "specs",
            source_file: "specifications-vol-1.pdf",
            page_number: 301,
            page_end: 304,
            section_id: "D-705",
            section_title: "PIPE UNDERDRAINS FOR AIRPORTS",
            content: "Provide pipe underdrains for airports per project requirements.",
          },
        ];

        await storeChunks(chunks);

        const rows = await db<{ source: string; embedding_dims: number }[]>`
          SELECT source, vector_dims(embedding) AS embedding_dims
          FROM document_chunks
          ORDER BY source DESC
        `;

        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.embedding_dims === 1536)).toBe(true);
      },
    );
  });
});
