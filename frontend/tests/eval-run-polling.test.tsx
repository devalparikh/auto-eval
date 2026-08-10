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
    act(() => result.current.setRun(evalRun("running")));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(loader).toHaveBeenCalledOnce();
    expect(result.current.run?.status).toBe("complete");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(loader).toHaveBeenCalledOnce();
  });
});
