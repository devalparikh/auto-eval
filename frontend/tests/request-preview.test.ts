import { describe, expect, it } from "vitest";
import { textPreview } from "@/lib/format";

describe("request previews", () => {
  it("prefers a readable question over structured policy data", () => {
    expect(textPreview({ policy: { max_dte: 45 }, question: "  What changed?\nExplain. " })).toBe("What changed? Explain.");
  });
  it("summarizes structured input without fabricating a question", () => {
    expect(textPreview({ policy: { max_dte: 45 } }, "Portfolio Q&A")).toBe("Portfolio Q&A · policy");
    expect(textPreview({})).toBe("Structured request");
  });
  it("bounds long text and keeps the original payload intact", () => {
    const value = { text: "x".repeat(600) };
    expect(textPreview(value).length).toBeLessThanOrEqual(180);
    expect(value.text).toHaveLength(600);
  });
});
