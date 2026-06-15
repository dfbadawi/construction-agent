import { describe, expect, test } from "bun:test";
import {
  buildPlanChunk,
  extractPlanSectionTitle,
  selectPlanPages,
} from "../src/ingestion/pdf-planset";

describe("pdf-planset", () => {
  test("extracts section titles and builds plan chunks", () => {
    const text = "SECTION: DEMOLITION PLAN\n\nREMOVE underdrain";
    expect(extractPlanSectionTitle(text)).toBe("DEMOLITION PLAN");

    expect(buildPlanChunk(12, text, "plans.pdf")).toEqual({
      source: "planset",
      source_file: "plans.pdf",
      page_number: 12,
      page_end: 12,
      section_title: "DEMOLITION PLAN",
      content: text,
    });
  });

  test("selects explicit page numbers", () => {
    expect(selectPlanPages(63, { pages: [1, 2, 3, 4, 5, 12] })).toEqual([
      1, 2, 3, 4, 5, 12,
    ]);
  });
});
