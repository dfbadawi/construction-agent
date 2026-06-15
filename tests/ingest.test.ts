import { describe, expect, test } from "bun:test";
import { resolveFileType } from "../src/ingestion/ingest";
import { parsePages } from "../src/utils/path";

describe("parsePages", () => {
  test("parses comma-separated pages and ranges", () => {
    expect(parsePages("1-5,12")).toEqual([1, 2, 3, 4, 5, 12]);
  });
});

describe("resolveFileType", () => {
  test(".csv extension detects as csv", () => {
    expect(resolveFileType("/data/bid.csv")).toBe("csv");
    expect(resolveFileType("/data/bid.csv", "auto")).toBe("csv");
  });

  test("explicit file type is required for .pdf", () => {
    expect(() => resolveFileType("/data/plans.pdf")).toThrow(
      "PDF files require an explicit file type",
    );
  });

  test("accepts explicit planset and specs for pdf", () => {
    expect(resolveFileType("/data/plans.pdf", "planset")).toBe("planset");
    expect(resolveFileType("/data/specs.pdf", "specs")).toBe("specs");
  });
});
