import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEvalRunPending,
  useEvalRunPolling,
} from "@/features/evaluations/use-eval-run-polling";
import type { EvalRun } from "@/lib/types";

function evalRun(status: string): EvalRun {
  return {
    id: "run",
    status,
    model_ids: [],
    results: [],
    item_results: [],
  } as unknown as EvalRun;
}

afterEach(() => vi.useRealTimers());

describe("evaluation polling", () => {
  it("recognizes only active run states", () => {
    expect(isEvalRunPending(evalRun("queued"))).toBe(true);
    expect(isEvalRunPending(evalRun("running"))).toBe(true);
    expect(isEvalRunPending(evalRun("complete"))).toBe(false);
  });

  it("polls an active run and stops when it completes", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValue(evalRun("complete"));
    const { result } = renderHook(() => useEvalRunPolling(loader, 100));
    act(() => result.current.setRuns([evalRun("running")]));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(loader).toHaveBeenCalledOnce();
    expect(result.current.runs[0]?.status).toBe("complete");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(loader).toHaveBeenCalledOnce();
  });

  it("polls only the runs still pending, and keeps a run whose poll failed", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async (id: string) => {
      if (id === "flaky") throw new Error("interrupted");
      return { ...evalRun("complete"), id };
    });
    const { result } = renderHook(() => useEvalRunPolling(loader, 100));
    act(() =>
      result.current.setRuns([
        { ...evalRun("complete"), id: "done" },
        { ...evalRun("running"), id: "active" },
        { ...evalRun("queued"), id: "flaky" },
      ]),
    );
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(loader.mock.calls.map(([id]) => id)).toEqual(["active", "flaky"]);
    expect(result.current.runs.map((run) => run.status)).toEqual([
      "complete",
      "complete",
      "queued",
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(loader).toHaveBeenLastCalledWith("flaky");
  });
});
