import { describe, expect, it } from "vitest";
import {
  buildResultRows,
  distinctGraphVersions,
  graphVersionDeltas,
  promptLabel,
  sortResultRows,
  traceIdForResult,
  type VersionNumbers,
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

describe("graph version comparison", () => {
  const numbers: VersionNumbers = {
    graph: new Map([
      ["g1", 1],
      ["g2", 2],
    ]),
    prompt: new Map([
      ["p1", { name: "Triage", version: 3 }],
      ["p2", { name: "Draft", version: 1 }],
    ]),
  };

  function runFor(graphId: string, accuracy: number, cost: number, createdAt: string) {
    return {
      id: `run-${graphId}-${createdAt}`,
      agent_system_version_id: graphId,
      prompt_version_id: "p1",
      item_results: [],
      results: [
        {
          id: `result-${graphId}-${createdAt}`,
          model_id: "mock/a",
          created_at: createdAt,
          metrics: {
            accuracy,
            total_cost_usd: cost,
            average_latency_ms: 100,
          },
        },
      ],
    } as unknown as EvalRun;
  }

  const rows = buildResultRows([
    runFor("g2", 0.9, 0.5, "2026-02-01"),
    runFor("g1", 0.8, 1, "2026-01-01"),
  ]);

  it("measures a later graph against the earliest for the same model", () => {
    const deltas = graphVersionDeltas(rows, numbers);
    const later = deltas.get("result-g2-2026-02-01");
    expect(later?.baselineVersion).toBe(1);
    expect(later?.accuracyPoints).toBeCloseTo(10);
    expect(later?.costPercent).toBeCloseTo(-50);
    expect(later?.latencyPercent).toBeCloseTo(0);
    expect(deltas.has("result-g1-2026-01-01")).toBe(false);
  });

  it("uses the newest run when a baseline version ran twice", () => {
    const repeated = buildResultRows([
      runFor("g1", 0.5, 1, "2026-01-01"),
      runFor("g1", 0.7, 1, "2026-01-15"),
      runFor("g2", 0.9, 1, "2026-02-01"),
    ]);
    expect(
      graphVersionDeltas(repeated, numbers).get("result-g2-2026-02-01")
        ?.accuracyPoints,
    ).toBeCloseTo(20);
  });

  it("has nothing to compare with a single graph version", () => {
    expect(graphVersionDeltas(rows.slice(0, 1), numbers).size).toBe(0);
  });

  it("does not divide by a free baseline", () => {
    const free = buildResultRows([
      runFor("g1", 0.8, 0, "2026-01-01"),
      runFor("g2", 0.8, 1, "2026-02-01"),
    ]);
    expect(
      graphVersionDeltas(free, numbers).get("result-g2-2026-02-01")?.costPercent,
    ).toBeNull();
  });

  it("orders each model's rows by graph version", () => {
    expect(
      sortResultRows(rows, numbers).map((row) => row.run.agent_system_version_id),
    ).toEqual(["g1", "g2"]);
    expect(distinctGraphVersions(rows, numbers)).toEqual([1, 2]);
  });

  it("names every prompt a run pinned, keyed or not", () => {
    expect(promptLabel(rows[0]!.run, numbers)).toBe("Triage v3");
    expect(
      promptLabel(
        {
          prompt_version_id: "p1",
          prompt_version_ids: { triage: "p1", draft: "p2" },
        } as unknown as EvalRun,
        numbers,
      ),
    ).toBe("Triage v3, Draft v1");
  });
});
