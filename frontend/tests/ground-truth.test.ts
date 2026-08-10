import { describe, expect, it } from "vitest";
import {
  groundTruthFromForm,
  groundTruthFromRecord,
} from "@/features/datasets/ground-truth";

describe("ground truth parsing", () => {
  it("normalizes missing trace output to review defaults", () => {
    expect(groundTruthFromRecord({})).toEqual({
      severity: "medium",
      route: "support",
      requires_human: false,
    });
  });

  it("reads the shared form field names", () => {
    const form = new FormData();
    form.set("severity", "critical");
    form.set("route", "security");
    form.set("requiresHuman", "true");
    expect(groundTruthFromForm(form)).toEqual({
      severity: "critical",
      route: "security",
      requires_human: true,
    });
  });
});
