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

  describe("with a cache key", () => {
    it("shows the last response immediately and refreshes behind it", async () => {
      const refresh = deferred<string>();
      const loader = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("first")
        .mockReturnValueOnce(refresh.promise);
      const first = renderHook(() =>
        useApiResource(loader, [], { cacheKey: "resource" }),
      );
      await waitFor(() => expect(first.result.current.data).toBe("first"));
      first.unmount();

      const second = renderHook(() =>
        useApiResource(loader, [], { cacheKey: "resource" }),
      );
      expect(second.result.current.data).toBe("first");
      expect(second.result.current.loading).toBe(false);
      await act(async () => refresh.resolve("second"));
      await waitFor(() => expect(second.result.current.data).toBe("second"));
    });

    it("keeps the same object when a refresh changes nothing", async () => {
      const loader = vi.fn(async () => ({ value: 1 }));
      const first = renderHook(() =>
        useApiResource(loader, [], { cacheKey: "stable" }),
      );
      await waitFor(() => expect(first.result.current.data).not.toBeNull());
      const original = first.result.current.data;
      first.unmount();

      const second = renderHook(() =>
        useApiResource(loader, [], { cacheKey: "stable" }),
      );
      await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
      await act(async () => {});
      expect(second.result.current.data).toBe(original);
    });

    it("keeps showing cached data, with the error, when a refresh fails", async () => {
      const loader = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("kept")
        .mockRejectedValueOnce(new Error("offline"));
      const first = renderHook(() =>
        useApiResource(loader, [], { cacheKey: "offline" }),
      );
      await waitFor(() => expect(first.result.current.data).toBe("kept"));
      first.unmount();

      const second = renderHook(() =>
        useApiResource(loader, [], { cacheKey: "offline" }),
      );
      await waitFor(() => expect(second.result.current.error).toBe("offline"));
      expect(second.result.current.data).toBe("kept");
    });

    it("remembers what setData writes", async () => {
      const loader = vi.fn(async () => "server");
      const first = renderHook(() =>
        useApiResource(loader, [], { cacheKey: "written" }),
      );
      await waitFor(() => expect(first.result.current.data).toBe("server"));
      act(() => first.result.current.setData("local"));
      first.unmount();

      const never = new Promise<string>(() => {});
      const second = renderHook(() =>
        useApiResource(() => never, [], { cacheKey: "written" }),
      );
      expect(second.result.current.data).toBe("local");
    });

    it("does not share data between keys", async () => {
      const loader = vi.fn(async (key: string) => key);
      const { result, rerender } = renderHook(
        ({ id }) =>
          useApiResource(() => loader(id), [id], { cacheKey: `key:${id}` }),
        { initialProps: { id: "a" } },
      );
      await waitFor(() => expect(result.current.data).toBe("a"));
      rerender({ id: "b" });
      await waitFor(() => expect(result.current.data).toBe("b"));
    });
  });
});
