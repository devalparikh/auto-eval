import type { EvalModelResult, EvalRun } from "@/lib/types";

export type ResultRow = EvalModelResult & { run: EvalRun };

export function buildResultRows(runs: EvalRun[] | null): ResultRow[] {
  return runs?.flatMap((run) => run.results.map((result) => ({ ...result, run }))) ?? [];
}

export function traceIdForResult(row: ResultRow): string | null {
  return (
    row.run.item_results.find((itemResult) => itemResult.model_id === row.model_id)
      ?.trace_id ?? null
  );
}
