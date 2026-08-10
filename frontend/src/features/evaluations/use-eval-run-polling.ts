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
  const [run, setRun] = useState<EvalRun | null>(null);

  useEffect(() => {
    if (!isEvalRunPending(run)) return;
    const runId = run!.id;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const next = await loadRun(runId);
        if (!cancelled) setRun(next);
      } catch {
        // A later poll can recover from a short API interruption.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, intervalMs);
      }
    }

    timer = window.setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [intervalMs, loadRun, run]);

  return { run, setRun };
}
