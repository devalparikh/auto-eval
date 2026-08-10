import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, formatPercent } from "@/lib/format";

describe("metric formatting", () => {
  it("keeps small costs visible", () => {
    expect(formatCost(0.00042)).toBe("$0.00042");
  });

  it("uses readable duration units", () => {
    expect(formatDuration(84.4)).toBe("84ms");
    expect(formatDuration(1240)).toBe("1.24s");
  });

  it("formats quality scores as percentages", () => {
    expect(formatPercent(0.875)).toBe("87.5%");
  });
});
