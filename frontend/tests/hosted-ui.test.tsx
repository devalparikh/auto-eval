import { StrictMode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthGate } from "@/features/auth/auth-gate";
import { ApplicationsScreen } from "@/features/applications/applications-screen";
import { useHostedSession } from "@/features/auth/hosted-session";
import { apiRequest } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  API_URL: "/api/backend/api",
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("OTP gates private content until code verification and releases failed pending state", async () => {
  const api = vi.mocked(apiRequest);
  api.mockRejectedValueOnce(new Error("401"));
  render(
    <AuthGate enabled>
      <p>Private workspace</p>
    </AuthGate>,
  );
  expect(screen.queryByText("Private workspace")).toBeNull();
  await screen.findByRole("button", { name: "Send code" });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "test@example.invalid" },
  });
  api.mockResolvedValueOnce({});
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  await screen.findByLabelText("Email code");
  expect(api).toHaveBeenLastCalledWith(
    "/auth/request",
    expect.objectContaining({ body: { email: "test@example.invalid" } }),
  );
  fireEvent.change(screen.getByLabelText("Email code"), {
    target: { value: "123456" },
  });
  api.mockRejectedValueOnce(new Error("invalid"));
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Verify code" })).toBeEnabled();
  expect(screen.queryByText("Private workspace")).toBeNull();
  api.mockResolvedValueOnce({}).mockResolvedValueOnce({ subject: "viewer-subject" });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByText("Private workspace");
});

test("viewer dashboard reads allowed observations without key controls", async () => {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === "/auth/session") return { role: "viewer" };
    if (path === "/applications")
      return [
        { id: "app", name: "Demo", environment: "preview", retention_days: 1 },
      ];
    if (path === "/applications/app/experiments") return [];
    if (path === "/applications/app/traces")
      return [
        {
          id: "trace",
          experimentId: "experiment",
          source: "synthetic",
          status: "ok",
          metrics: { latency_ms: 12 },
          checks: { passed: true },
        },
      ];
    throw new Error("unexpected request");
  });
  render(<ApplicationsScreen />);
  await screen.findByLabelText("Application");
  fireEvent.change(screen.getByLabelText("Application"), {
    target: { value: "app" },
  });
  await screen.findByText("trace");
  expect(screen.queryByText("Issue key")).toBeNull();
  await waitFor(() => expect(screen.getByText("synthetic")).toBeVisible());
});

test("comparison keeps the selected pair fixed until its response settles", async () => {
  let resolveComparison!: (value: unknown) => void;
  const comparison = new Promise((resolve) => {
    resolveComparison = resolve;
  });
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === "/auth/session") return { role: "viewer" };
    if (path === "/applications")
      return [
        { id: "app", name: "Demo", environment: "preview", retention_days: 1 },
      ];
    if (path === "/applications/app/traces") return [];
    if (path === "/applications/app/experiments")
      return ["left", "right"].map((id) => ({
        id,
        model: "mock",
        mode: "scripted",
        datasetHash: "hash",
      }));
    if (path === "/applications/app/comparisons/left/right") return comparison;
    throw new Error("unexpected request");
  });
  render(<ApplicationsScreen />);
  fireEvent.change(await screen.findByLabelText("Application"), {
    target: { value: "app" },
  });
  await waitFor(() =>
    expect(screen.getAllByRole("option", { name: "mock / left" })).toHaveLength(
      2,
    ),
  );
  fireEvent.change(screen.getByLabelText("Baseline"), {
    target: { value: "left" },
  });
  fireEvent.change(screen.getByLabelText("Candidate"), {
    target: { value: "right" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  expect(screen.getByLabelText("Baseline")).toBeDisabled();
  expect(screen.getByLabelText("Candidate")).toBeDisabled();
  expect(screen.getByLabelText("Application")).toBeDisabled();
  resolveComparison({ mode: "scripted", cases: [] });
  await screen.findByText("Mode: scripted");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(screen.queryByText("Mode: scripted")).toBeNull();
});

test("verified registration shows only own pending ID and never mounts private content", async () => {
  const api = vi.mocked(apiRequest);
  api.mockRejectedValueOnce(new Error("401"));
  const privateMount = vi.fn();
  function PrivateContent() { privateMount(); return <p>Private workspace</p>; }
  render(<AuthGate enabled><PrivateContent /></AuthGate>);
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "new@example.invalid" } });
  api.mockResolvedValueOnce({});
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  fireEvent.change(await screen.findByLabelText("Email code"), { target: { value: "12345678" } });
  const subject = "00000000-0000-4000-8000-000000000001";
  api.mockResolvedValueOnce({ authenticated: false, status: "pending", subject });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByText("Approval pending");
  expect(screen.getByText(subject)).toBeVisible();
  expect(privateMount).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole("button", { name: "Return to sign in" }));
  expect(screen.queryByText(subject)).toBeNull();
  expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled();
});

test("email-link callback strips the code and keeps verified registration pending", async () => {
  window.history.replaceState(null, "", "/?code=" + "a".repeat(36));
  const api = vi.mocked(apiRequest);
  const subject = "00000000-0000-4000-8000-000000000001";
  api.mockImplementation(async (path) => {
    expect(window.location.search).toBe("");
    expect(path).toBe("/auth/exchange");
    return { authenticated: false, status: "pending", subject };
  });
  render(<AuthGate enabled emailLink><p>Private workspace</p></AuthGate>);
  await screen.findByText("Approval pending");
  expect(screen.getByText(subject)).toBeVisible();
  expect(screen.queryByText("Private workspace")).toBeNull();
  expect(api).toHaveBeenCalledTimes(1);
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
});

test("implicit tokens are stripped and rejected without any token exchange", async () => {
  window.history.replaceState(null, "", "/#access_token=synthetic&refresh_token=discarded");
  const api = vi.mocked(apiRequest);
  render(<AuthGate enabled emailLink><p>Private workspace</p></AuthGate>);
  await screen.findByRole("alert");
  expect(window.location.hash).toBe("");
  expect(api).not.toHaveBeenCalled();
  expect(screen.queryByText("Private workspace")).toBeNull();
});

test("email link request instructs same browser use without showing a numeric code field", async () => {
  const api = vi.mocked(apiRequest);
  api.mockRejectedValueOnce(new Error("401"));
  render(<AuthGate enabled emailLink><p>Private workspace</p></AuthGate>);
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "team@example.invalid" } });
  api.mockResolvedValueOnce({});
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
  await screen.findByText(/Open it in the same browser/);
  expect(screen.queryByLabelText("Email code")).toBeNull();
  expect(screen.queryByText("Private workspace")).toBeNull();
});


test("PKCE callback has one exchange under StrictMode and a failed proof never reveals content", async () => {
  window.history.replaceState(null, "", "/?code=" + "b".repeat(36));
  const api = vi.mocked(apiRequest);
  api.mockRejectedValueOnce(new Error("Proof rejected"));
  render(<StrictMode><AuthGate enabled emailLink><p>Private workspace</p></AuthGate></StrictMode>);
  await screen.findByRole("alert");
  expect(api).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Private workspace")).toBeNull();
  expect(window.location.search).toBe("");
});

test("PKCE callback says it is verifying the link until the exchange settles", async () => {
  window.history.replaceState(null, "", "/?code=" + "c".repeat(36));
  let settle!: (value: unknown) => void;
  const api = vi.mocked(apiRequest);
  api.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
  render(<AuthGate enabled emailLink><p>Private workspace</p></AuthGate>);
  expect(await screen.findByRole("status")).toHaveTextContent("Verifying your sign-in link");
  expect(screen.queryByText("Private workspace")).toBeNull();
  settle({ authenticated: false, status: "pending", subject: "00000000-0000-4000-8000-000000000002" });
  await screen.findByText("Approval pending");
});

test("pending approval focuses its heading and copies only the caller's own ID", async () => {
  window.history.replaceState(null, "", "/?code=" + "d".repeat(36));
  const subject = "00000000-0000-4000-8000-000000000003";
  vi.mocked(apiRequest).mockResolvedValueOnce({ authenticated: false, status: "pending", subject });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<AuthGate enabled emailLink><p>Private workspace</p></AuthGate>);
  const heading = await screen.findByRole("heading", { name: "Approval pending" });
  await waitFor(() => expect(heading).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Copy user ID" }));
  await screen.findByText("Copied");
  expect(writeText).toHaveBeenCalledWith(subject);
  expect(screen.queryByText("Private workspace")).toBeNull();
});

test("a rejected code keeps the code step with a specific, retryable error", async () => {
  const api = vi.mocked(apiRequest);
  api.mockRejectedValueOnce(new Error("401"));
  render(<AuthGate enabled><p>Private workspace</p></AuthGate>);
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "team@example.invalid" } });
  api.mockResolvedValueOnce({});
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  expect(await screen.findByRole("heading", { name: "Enter your code" })).toBeVisible();
  expect(screen.getByText("team@example.invalid")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Email code"), { target: { value: "123 456" } });
  expect(screen.getByLabelText("Email code")).toHaveValue("123456");
  api.mockRejectedValueOnce(new Error("invalid"));
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work");
  fireEvent.click(screen.getByRole("button", { name: "Use another email or request a new code" }));
  expect(screen.getByLabelText("Email")).toHaveValue("team@example.invalid");
  expect(screen.getByLabelText("Email")).toHaveFocus();
});

test("signed-in chrome gets a sign-out action only on a hosted instance", async () => {
  function Account() {
    const session = useHostedSession();
    return session ? <button onClick={session.signOut}>Sign out</button> : <p>Local workspace</p>;
  }
  render(<AuthGate enabled={false}><Account /></AuthGate>);
  expect(screen.getByText("Local workspace")).toBeVisible();
  cleanup();
  const api = vi.mocked(apiRequest);
  api.mockResolvedValueOnce({ subject: "viewer-subject" });
  render(<AuthGate enabled><Account /></AuthGate>);
  api.mockResolvedValueOnce({});
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  await screen.findByRole("button", { name: "Send code" });
  expect(api).toHaveBeenLastCalledWith("/auth/logout", { method: "POST" });
});

test("first-use dashboard tells an admin to register and a viewer to ask for access", async () => {
  const empty = (role: string) =>
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/auth/session") return { role };
      if (path === "/applications") return [];
      throw new Error("unexpected request");
    });
  empty("admin");
  render(<ApplicationsScreen />);
  await screen.findByText("No applications yet");
  fireEvent.click(screen.getAllByRole("button", { name: "Register application" })[0]);
  expect(screen.getByLabelText("Name")).toBeVisible();
  cleanup();
  empty("viewer");
  render(<ApplicationsScreen />);
  await screen.findByText("No applications shared with you");
  expect(screen.queryByRole("button", { name: "Register application" })).toBeNull();
});
