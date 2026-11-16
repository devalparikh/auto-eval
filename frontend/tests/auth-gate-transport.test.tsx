import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthGate } from "@/features/auth/auth-gate";
import type { SessionHint } from "@/features/auth/session-hint";

// The real API transport and session, with only `fetch` replaced: a probe's
// 401 must not reach the global unauthorized handler, which would abort every
// request in flight, including the visitor's own sign-in.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const typedVisit: SessionHint = { session: false, pending: false, callback: false, confirm: true };

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a background probe's 401 does not cancel a sign-in started before it answered", async () => {
  const session = deferred();
  const request = deferred();
  const unauthorized = vi.fn();
  window.addEventListener("autoeval:unauthorized", unauthorized);
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const pending = url.endsWith("/auth/session")
      ? session.promise
      : url.endsWith("/auth/request")
        ? request.promise
        : Promise.resolve(json(200, { authenticated: false }));
    // Honor aborts as the browser does.
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
      void pending.then(resolve);
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AuthGate enabled hint={typedVisit}><p>Private workspace</p></AuthGate>);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "someone@example.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  // The probe answers 401 while the visitor's request is still in flight.
  session.resolve(json(401, { detail: "Request not authorized" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  request.resolve(json(200, {}));

  await screen.findByLabelText("Email code");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(unauthorized).not.toHaveBeenCalled();
  window.removeEventListener("autoeval:unauthorized", unauthorized);
});

test("an ordinary 401 still announces the lost session", async () => {
  const unauthorized = vi.fn();
  window.addEventListener("autoeval:unauthorized", unauthorized);
  vi.stubGlobal("fetch", vi.fn(async () => json(401, { detail: "Request not authorized" })));
  const { apiRequest } = await import("@/lib/api");
  await expect(apiRequest("/applications")).rejects.toMatchObject({ status: 401 });
  expect(unauthorized).toHaveBeenCalledTimes(1);
  window.removeEventListener("autoeval:unauthorized", unauthorized);
});
