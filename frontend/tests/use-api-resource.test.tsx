import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useApiResource } from "@/lib/use-api-resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useApiResource", () => {
  it("ignores a stale request after dependencies change", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loader = vi.fn((key: string) => (key === "first" ? first.promise : second.promise));
    const { result, rerender } = renderHook(
      ({ key }) => useApiResource(() => loader(key), [key]),
      { initialProps: { key: "first" } },
    );

    rerender({ key: "second" });
    await act(async () => second.resolve("new"));
    await waitFor(() => expect(result.current.data).toBe("new"));
    await act(async () => first.resolve("stale"));
    expect(result.current.data).toBe("new");
  });

  it("exposes a reload that refreshes the current resource", async () => {
    const loader = vi.fn().mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    const { result } = renderHook(() => useApiResource(loader, []));
    await waitFor(() => expect(result.current.data).toBe("one"));
    await act(async () => result.current.reload());
    expect(result.current.data).toBe("two");
  });

  it("stays idle when the loader is null", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    const { result } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useApiResource(ready ? loader : null, [ready]),
      { initialProps: { ready: false } },
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();

    await act(async () => result.current.reload());
    expect(loader).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("clears data and stays idle when the loader becomes null again", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useApiResource(ready ? loader : null, [ready]),
      { initialProps: { ready: true } },
    );

    await waitFor(() => expect(result.current.data).toBe("value"));

    rerender({ ready: false });

    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
