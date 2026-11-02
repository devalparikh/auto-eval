"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { EvalRun } from "@/lib/types";

export type EvalRunLoader = (runId: string) => Promise<EvalRun>;

export function isEvalRunPending(run: EvalRun | null): boolean {
  return run !== null && ["queued", "running"].includes(run.status);
}

export function useEvalRunPolling(
  loadRun: EvalRunLoader = api.evalRun,
  intervalMs = 900,
) {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const pendingIds = runs
    .filter(isEvalRunPending)
    .map((run) => run.id)
    .join(",");

  useEffect(() => {
    if (!pendingIds) return;
    const ids = pendingIds.split(",");
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      // A rejected poll keeps its last known state; a later one can recover
      // from a short API interruption.
      const results = await Promise.allSettled(ids.map((id) => loadRun(id)));
      if (cancelled) return;
      const updates = new Map(
        results.flatMap((result) =>
          result.status === "fulfilled"
            ? [[result.value.id, result.value] as const]
            : [],
        ),
      );
      setRuns((current) => current.map((run) => updates.get(run.id) ?? run));
      timer = window.setTimeout(poll, intervalMs);
    }

    timer = window.setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [intervalMs, loadRun, pendingIds]);

  return { runs, setRuns };
}
