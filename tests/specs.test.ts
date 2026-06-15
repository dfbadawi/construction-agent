import { describe, expect, test } from "bun:test";
import { splitSpecsIntoChunks } from "../src/ingestion/pdf-specs";

describe("splitSpecsIntoChunks", () => {
  test("extracts D-705 underdrain specification sections", () => {
    const text = [
      "SECTION 26",
      "D-705 – PIPE UNDERDRAINS FOR AIRPORTS",
      "DESCRIPTION",
      "705-1.1 This item shall consist of the construction of pipe drains in accordance with these specifications.",
      "705-1.2 Additional requirements apply to airport underdrain installations and outlet connections.",
    ].join("\n");

    const chunks = splitSpecsIntoChunks(text);
    const underdrains = chunks.find((chunk) => chunk.section_id === "D-705");

    expect(underdrains?.section_id).toBe("D-705");
    expect(underdrains?.section_title).toBe("PIPE UNDERDRAINS FOR AIRPORTS");
    expect(underdrains?.content).toContain("705-1.1");
  });
});
