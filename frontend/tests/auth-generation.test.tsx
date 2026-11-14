import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { clearApiResourceCache, useApiResource } from "@/lib/use-api-resource";
import { apiRequest, ApiError } from "@/lib/api";
import { getApiSession } from "@/lib/api-session";

afterEach(() => { cleanup(); clearApiResourceCache(); vi.unstubAllGlobals(); });

test("late admin result cannot repopulate cache after logout and viewer login", async () => {
  clearApiResourceCache("admin");
  let finish!: (value: string) => void;
  const response = new Promise<string>(resolve => { finish = resolve; });
  const adminLoader = vi.fn(() => response);
  const admin = renderHook(() => useApiResource(adminLoader, [], { cacheKey: "custom-models" }));
  await waitFor(() => expect(adminLoader).toHaveBeenCalled());
  act(() => clearApiResourceCache());
  admin.unmount();
  clearApiResourceCache("viewer");
  await act(async () => finish("synthetic-private-model"));
  const viewer = renderHook(() => useApiResource(async () => { throw new ApiError("Forbidden", 403); }, [], { cacheKey: "custom-models" }));
  expect(viewer.result.current.data).toBeNull();
  await waitFor(() => expect(viewer.result.current.error).toBe("Forbidden"));
  expect(viewer.result.current.data).toBeNull();
});

test("mounted resources hide prior identity and reject retained setters across generations", async () => {
  clearApiResourceCache("admin");
  const loader = vi.fn(async () => "private");
  const hook = renderHook(() => useApiResource(loader, [], { cacheKey: "mounted" }));
  await waitFor(() => expect(hook.result.current.data).toBe("private"));
  const staleSetter = hook.result.current.setData;
  loader.mockImplementation(() => new Promise(() => {}));
  act(() => clearApiResourceCache("viewer"));
  expect(hook.result.current.data).toBeNull();
  act(() => staleSetter("private-late"));
  expect(hook.result.current.data).toBeNull();
});

test("403 evicts cached data even without an identity transition", async () => {
  const loader = vi.fn<() => Promise<string>>().mockResolvedValueOnce("private").mockRejectedValueOnce(new ApiError("Forbidden", 403));
  const first = renderHook(() => useApiResource(loader, [], { cacheKey: "denied" }));
  await waitFor(() => expect(first.result.current.data).toBe("private"));
  first.unmount();
  const second = renderHook(() => useApiResource(loader, [], { cacheKey: "denied" }));
  await waitFor(() => expect(second.result.current.error).toBe("Forbidden"));
  expect(second.result.current.data).toBeNull();
});

test("auth transitions abort transport and ignore late unauthorized replies", async () => {
  clearApiResourceCache("admin");
  let finish!: (value: Response) => void;
  let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_url, options) => {
    signal = options.signal;
    return new Promise<Response>(resolve => { finish = resolve; });
  }));
  const unauthorized = vi.fn();
  window.addEventListener("autoeval:unauthorized", unauthorized);
  try {
    const pending = apiRequest("/custom-models");
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    clearApiResourceCache("viewer");
    const viewerSession = getApiSession();
    expect(signal.aborted).toBe(true);
    finish(new Response('{"detail":"Unauthorized"}', { status: 401 }));
    await rejection;
    expect(unauthorized).not.toHaveBeenCalled();
    expect(getApiSession()).toBe(viewerSession);
  } finally { window.removeEventListener("autoeval:unauthorized", unauthorized); }
});
