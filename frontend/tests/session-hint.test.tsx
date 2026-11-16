import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthGate } from "@/features/auth/auth-gate";
import {
  PENDING_COOKIE,
  SESSION_COOKIE,
  readSessionHint,
  type SessionHint,
} from "@/features/auth/session-hint";
import { ApiError, apiRequest } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import("@/lib/api")>()).ApiError,
  apiRequest: vi.fn(),
  API_URL: "/api/backend/api",
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const none: SessionHint = { session: false, pending: false, callback: false };

test("cookie names match the ones the API sets", () => {
  const source = readFileSync(
    join(__dirname, "../../backend/src/autoeval_api/services/hosted_auth.py"),
    "utf8",
  );
  expect(source).toContain(`COOKIE = "${SESSION_COOKIE}"`);
  expect(source).toContain(`PENDING_COOKIE = "${PENDING_COOKIE}"`);
  const present = new Set([SESSION_COOKIE]);
  expect(readSessionHint((name) => present.has(name), false)).toEqual({
    session: true,
    pending: false,
    callback: false,
  });
});

test("with no auth cookie, sign-in renders at once and the API is never asked", () => {
  render(<AuthGate enabled hint={none}><p>Private workspace</p></AuthGate>);
  // Synchronously on the first render: there is no spinner to wait through.
  expect(screen.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  expect(screen.queryByText(/Checking your session/)).toBeNull();
  expect(vi.mocked(apiRequest)).not.toHaveBeenCalled();
  expect(screen.queryByText("Private workspace")).toBeNull();
});

test("a session cookie is verified by the API before anything private mounts", async () => {
  const api = vi.mocked(apiRequest).mockResolvedValueOnce({ subject: "viewer" });
  render(<AuthGate enabled hint={{ ...none, session: true }}><p>Private workspace</p></AuthGate>);
  expect(screen.getByText(/Checking your session/)).toBeVisible();
  await screen.findByText("Private workspace");
  expect(api.mock.calls.map(([path]) => path)).toEqual(["/auth/session"]);
});

test("a rejected session cookie with no pending cookie goes straight to sign-in", async () => {
  const api = vi.mocked(apiRequest).mockRejectedValueOnce(new ApiError("Request not authorized", 401));
  render(<AuthGate enabled hint={{ ...none, session: true }}><p>Private workspace</p></AuthGate>);
  await screen.findByRole("heading", { name: "Sign in to AutoEval" });
  expect(api.mock.calls.map(([path]) => path)).toEqual(["/auth/session"]);
});

test("a pending cookie alone asks only for its own status", async () => {
  const api = vi.mocked(apiRequest).mockResolvedValueOnce({
    authenticated: false,
    status: "pending",
    subject: "00000000-0000-4000-8000-0000000000b2",
  });
  render(<AuthGate enabled hint={{ ...none, pending: true }}><p>Private workspace</p></AuthGate>);
  await screen.findByRole("heading", { name: "Approval pending" });
  expect(api.mock.calls.map(([path, options]) => [path, options?.method])).toEqual([
    ["/auth/pending", "POST"],
  ]);
});

test("both cookies: a rejected session falls back to the pending status", async () => {
  const api = vi
    .mocked(apiRequest)
    .mockRejectedValueOnce(new ApiError("Request not authorized", 401))
    .mockResolvedValueOnce({ authenticated: false, status: "approved" });
  render(
    <AuthGate enabled hint={{ ...none, session: true, pending: true }}>
      <p>Private workspace</p>
    </AuthGate>,
  );
  await screen.findByText(/Your account is approved/);
  await waitFor(() =>
    expect(api.mock.calls.map(([path]) => path)).toEqual(["/auth/session", "/auth/pending"]),
  );
});
