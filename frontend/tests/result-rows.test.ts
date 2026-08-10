import { describe, expect, it } from "vitest";
import {
  buildResultRows,
  traceIdForResult,
} from "@/features/results/result-rows";
import type { EvalRun } from "@/lib/types";

const run = {
  id: "run",
  results: [
    { id: "a", model_id: "mock/a" },
    { id: "b", model_id: "mock/b" },
  ],
  item_results: [
    { model_id: "mock/b", trace_id: "trace-b" },
    { model_id: "mock/a", trace_id: "trace-a" },
  ],
} as EvalRun;

describe("evaluation result rows", () => {
  it("flattens model results with their parent run", () => {
    expect(buildResultRows([run])).toHaveLength(2);
    expect(buildResultRows([run])[0]?.run.id).toBe("run");
  });

  it("selects a trace produced by the row model", () => {
    const row = buildResultRows([run])[1]!;
    expect(traceIdForResult(row)).toBe("trace-b");
  });
});
