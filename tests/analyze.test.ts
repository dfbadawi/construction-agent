import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyzeBidData } from "../src/agent/tools/analyze";
import { ingestCSV } from "../src/ingestion/csv";
import { db } from "../src/storage/db";
import { applySchema, postgresAvailable } from "./helpers/postgres";

const SAMPLE_CSV = join(import.meta.dir, "../data/sample_bid_tabulation.csv");

describe("analyzeBidData", () => {
  beforeAll(async () => {
    if (!postgresAvailable) {
      console.warn("Postgres unavailable — skipping analyzeBidData integration tests");
      return;
    }
    await applySchema();
  });

  beforeEach(async () => {
    if (!postgresAvailable) return;
    await db`TRUNCATE bid_items RESTART IDENTITY`;
  });

  test.skipIf(!postgresAvailable)("returns top bid items ordered by ext_amt DESC", async () => {
    await ingestCSV(SAMPLE_CSV);

    const result = await analyzeBidData({
      query_type: "top_items",
      sql: `
        SELECT proj_id, item_no, ext_amt, bidder, bid_rank
        FROM bid_items
        WHERE bid_rank = 1 AND proj_id = '0676350'
        ORDER BY ext_amt DESC NULLS LAST
        LIMIT 10
      `,
    });

    expect(result.results.length).toBeGreaterThan(1);
    const amounts = result.results.map((row) => Number(row.ext_amt));
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i - 1]).toBeGreaterThanOrEqual(amounts[i]!);
    }
  });
});
