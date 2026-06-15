import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Papa from "papaparse";
import { ingestCSV, normalizeHeaders, normalizeRow } from "../src/ingestion/csv";
import { db } from "../src/storage/db";
import { applySchema, postgresAvailable } from "./helpers/postgres";

const SAMPLE_CSV = join(import.meta.dir, "../data/sample_bid_tabulation.csv");
const FIXTURE_DIR = join(tmpdir(), "construction-agent-csv-tests");

async function writeFixture(name: string, contents: string): Promise<string> {
  await mkdir(FIXTURE_DIR, { recursive: true });
  const filePath = join(FIXTURE_DIR, name);
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

async function countSampleRows(): Promise<number> {
  const raw = await Bun.file(SAMPLE_CSV).text();
  const parsed = Papa.parse<Record<string, unknown>>(raw, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  return parsed.data.length;
}

describe("ingestCSV", () => {
  test("preserves quoted bidder names and leading-zero identifiers", async () => {
    const csv = [
      "PROJ_ID,ITEM_NO,BIDDER,UNIT_PR",
      '0676350,1031000,"BLYTHE CONSTRUCTION, INC.",16500.0',
    ].join("\n");
    const filePath = await writeFixture("quoted-bidder.csv", csv);
    const raw = await Bun.file(filePath).text();
    const parsed = Papa.parse<Record<string, unknown>>(raw, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    });

    const headers = normalizeHeaders(parsed.meta.fields ?? []);
    const normalized = normalizeRow(parsed.data[0]!, headers);

    expect(normalized.proj_id).toBe("0676350");
    expect(normalized.item_no).toBe("1031000");
    expect(normalized.bidder).toBe("BLYTHE CONSTRUCTION, INC.");
  });

  describe("database integration", () => {
    beforeAll(async () => {
      if (!postgresAvailable) {
        console.warn("Postgres unavailable — skipping ingestCSV integration tests");
        return;
      }
      await applySchema();
    });

    beforeEach(async () => {
      if (!postgresAvailable) return;
      await db`TRUNCATE bid_items RESTART IDENTITY`;
    });

    test.skipIf(!postgresAvailable)("loads the sample CSV into bid_items", async () => {
      const expectedRows = await countSampleRows();
      const result = await ingestCSV(SAMPLE_CSV);

      expect(result.rowsInserted).toBe(expectedRows);

      const [{ count }] = await db<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM bid_items
      `;
      expect(Number(count)).toBe(expectedRows);

      const [row] = await db<{ proj_id: string }[]>`
        SELECT proj_id FROM bid_items WHERE proj_id = '0676350' LIMIT 1
      `;
      expect(row?.proj_id).toBe("0676350");
    });
  });
});
