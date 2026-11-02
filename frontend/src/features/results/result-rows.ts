import type { Catalog, EvalModelResult, EvalRun } from "@/lib/types";

export type ResultRow = EvalModelResult & { run: EvalRun };

export type VersionNumbers = {
  graph: Map<string, number>;
  prompt: Map<string, { name: string; version: number }>;
};

/** A change against the earliest graph version benchmarked for the same model. */
export type ResultDelta = {
  baselineVersion: number;
  accuracyPoints: number;
  costPercent: number | null;
  latencyPercent: number | null;
};

export function buildResultRows(runs: EvalRun[] | null): ResultRow[] {
  return runs?.flatMap((run) => run.results.map((result) => ({ ...result, run }))) ?? [];
}

export function traceIdForResult(row: ResultRow): string | null {
  return (
    row.run.item_results.find((itemResult) => itemResult.model_id === row.model_id)
      ?.trace_id ?? null
  );
}

export function modelName(modelId: string): string {
  return modelId.split("/").slice(-1)[0] ?? modelId;
}

export function versionNumbers(
  catalog: Catalog | null,
  agentSystemId: string | undefined,
): VersionNumbers {
  const system = catalog?.agent_systems.find((item) => item.id === agentSystemId);
  const prompts = catalog?.prompts.filter(
    (prompt) => prompt.agent_system_id === agentSystemId,
  );
  return {
    graph: new Map(system?.versions.map((version) => [version.id, version.version])),
    prompt: new Map(
      prompts?.flatMap((prompt) =>
        prompt.versions.map(
          (version) =>
            [version.id, { name: prompt.name, version: version.version }] as const,
        ),
      ),
    ),
  };
}

export function graphVersionOf(
  row: ResultRow,
  numbers: VersionNumbers,
): number | null {
  return numbers.graph.get(row.run.agent_system_version_id) ?? null;
}

/** Every prompt a run pinned: a graph can use several, keyed per node. */
export function promptLabel(run: EvalRun, numbers: VersionNumbers): string {
  const ids = Object.values(run.prompt_version_ids ?? {});
  return (ids.length ? ids : [run.prompt_version_id])
    .map((id) => numbers.prompt.get(id))
    .filter((prompt) => prompt !== undefined)
    .map((prompt) => `${prompt.name} v${prompt.version}`)
    .join(", ");
}

/** Same model next to itself across graph versions, oldest graph first. */
export function sortResultRows(
  rows: ResultRow[],
  numbers: VersionNumbers,
): ResultRow[] {
  return rows.toSorted(
    (left, right) =>
      left.model_id.localeCompare(right.model_id) ||
      (graphVersionOf(left, numbers) ?? 0) -
        (graphVersionOf(right, numbers) ?? 0) ||
      right.created_at.localeCompare(left.created_at),
  );
}

export function distinctGraphVersions(
  rows: ResultRow[],
  numbers: VersionNumbers,
): number[] {
  return [
    ...new Set(
      rows.flatMap((row) => graphVersionOf(row, numbers) ?? []),
    ),
  ].sort((left, right) => left - right);
}

function percentChange(value: number, baseline: number): number | null {
  return baseline > 0 ? ((value - baseline) / baseline) * 100 : null;
}

export function graphVersionDeltas(
  rows: ResultRow[],
  numbers: VersionNumbers,
): Map<string, ResultDelta> {
  const baselines = new Map<string, { version: number; row: ResultRow }>();
  for (const row of rows) {
    const version = graphVersionOf(row, numbers);
    if (version === null) continue;
    const current = baselines.get(row.model_id);
    if (
      !current ||
      version < current.version ||
      (version === current.version && row.created_at > current.row.created_at)
    ) {
      baselines.set(row.model_id, { version, row });
    }
  }
  const deltas = new Map<string, ResultDelta>();
  for (const row of rows) {
    const version = graphVersionOf(row, numbers);
    const baseline = baselines.get(row.model_id);
    if (version === null || !baseline || version === baseline.version) continue;
    deltas.set(row.id, {
      baselineVersion: baseline.version,
      accuracyPoints:
        (row.metrics.accuracy - baseline.row.metrics.accuracy) * 100,
      costPercent: percentChange(
        row.metrics.total_cost_usd,
        baseline.row.metrics.total_cost_usd,
      ),
      latencyPercent: percentChange(
        row.metrics.average_latency_ms,
        baseline.row.metrics.average_latency_ms,
      ),
    });
  }
  return deltas;
}
