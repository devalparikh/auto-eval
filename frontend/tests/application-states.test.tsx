import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { ApplicationsScreen } from "@/features/applications/applications-screen";
import {
  applicationStage,
  formatMetric,
  initialApplication,
  orderedChecks,
  summarizeFeed,
  type FeedObservation,
} from "@/features/applications/observation-feed";
import { apiRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  API_URL: "/api/backend/api",
}));
const api = vi.mocked(apiRequest);

const settings = {
  production_enabled: true,
  retention_days: null,
  content_retention_days: null,
  content_categories: [],
};
const lifty = { id: "lifty", name: "Lifty", settings, settingsVersion: "v1" };
const sandbox = { id: "sandbox", name: "Sandbox", settings, settingsVersion: "v1" };
const key = {
  id: "key-1",
  label: "App connection",
  scope: "application:connect",
  createdAt: 0,
  expiresAt: null,
  retireAt: null,
  revoked: false,
};
const trace = (id: string, overrides: Partial<FeedObservation> = {}) => ({
  id,
  experimentId: "e".repeat(64),
  source: "production",
  status: "ok",
  startedAt: Date.now() - 60_000,
  endedAt: Date.now() - 58_000,
  metrics: { latency_ms: 2000, cost_usd: null },
  checks: { reply_valid: true, within_budget: false },
  ...overrides,
});

function serve({
  apps,
  traces = {},
  keys = [],
  role = "admin",
}: {
  apps: (typeof lifty)[];
  traces?: Record<string, unknown[] | (() => unknown[])>;
  keys?: unknown[];
  role?: string;
}) {
  api.mockImplementation(async (path) => {
    if (path === "/auth/session") return { role };
    if (path === "/applications") return apps;
    const match = path.match(/^\/applications\/([^/]+)\/(traces|keys|experiments)/);
    if (!match) throw new Error(`unexpected ${path}`);
    const [, app, kind] = match;
    if (kind === "keys") return keys;
    if (kind === "experiments") return [];
    const value = traces[app] ?? [];
    return typeof value === "function" ? value() : value;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/applications");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("application stage", () => {
  it("moves connect → waiting → receiving as keys and traces arrive", () => {
    expect(applicationStage({ traces: [], keys: [], now: 1 })).toBe("connect");
    expect(
      applicationStage({ traces: [], keys: [{ ...key, revoked: true }], now: 1 }),
    ).toBe("connect");
    expect(
      applicationStage({ traces: [], keys: [{ ...key, expiresAt: 1 }], now: 2 }),
    ).toBe("connect");
    expect(applicationStage({ traces: [], keys: [key], now: 1 })).toBe("waiting");
    // A viewer sees no keys, yet arriving traces still prove the connection.
    expect(applicationStage({ traces: [trace("t")], keys: [], now: 1 })).toBe(
      "receiving",
    );
  });

  it("summarizes errors, failed checks and the latest arrival", () => {
    const summary = summarizeFeed([
      trace("a", { status: "error", endedAt: 5, checks: { ok: true } }),
      trace("b", { endedAt: 9 }),
      trace("c", { endedAt: undefined, startedAt: 7, checks: {} }),
    ]);
    expect(summary).toEqual({ total: 3, errors: 1, failedChecks: 1, lastSeen: 9 });
  });

  it("leads with failures and never prints a missing metric as zero", () => {
    expect(
      orderedChecks({ b: true, a: null, c: false }).map((check) => check.name),
    ).toEqual(["c", "a", "b"]);
    expect(formatMetric("cost_usd", null)).toBe("—");
    expect(formatMetric("latency_ms", 2400)).toBe("2.40s");
    expect(formatMetric("rows", 3)).toBe("3");
  });

  it("opens the URL's application, else the only one, and ignores unknown ids", () => {
    expect(initialApplication(["a", "b"], "b")).toBe("b");
    expect(initialApplication(["a", "b"], "gone")).toBe("");
    expect(initialApplication(["a"], null)).toBe("a");
    expect(initialApplication(["a"], "gone")).toBe("a");
    expect(initialApplication([], null)).toBe("");
  });
});

test("a single application opens without a chooser", async () => {
  serve({ apps: [lifty], traces: { lifty: [trace("t-1")] } });
  render(<ApplicationsScreen />);
  expect(await screen.findByRole("button", { name: "t-1" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Choose an application" })).toBeNull();
  expect(screen.getByLabelText("Application")).toHaveValue("lifty");
});

test("several applications show a chooser; choosing one writes it to the URL", async () => {
  serve({ apps: [lifty, sandbox], traces: { lifty: [trace("t-1")] } });
  render(<ApplicationsScreen />);
  const chooser = await screen.findByRole("heading", { name: "Choose an application" });
  const card = chooser.closest("section")!;
  within(card).getByRole("button", { name: /Lifty/ }).click();
  expect(await screen.findByRole("button", { name: "t-1" })).toBeVisible();
  expect(new URLSearchParams(window.location.search).get("app")).toBe("lifty");
});

test("a URL naming an application opens it directly", async () => {
  window.history.replaceState(null, "", "/applications?app=sandbox");
  serve({ apps: [lifty, sandbox], keys: [key] });
  render(<ApplicationsScreen />);
  expect(
    await screen.findByRole("heading", { name: "Connect Sandbox" }),
  ).toBeVisible();
});

test("before the first trace, connection leads; after it, traces lead and keys follow", async () => {
  serve({ apps: [lifty], keys: [key] });
  render(<ApplicationsScreen />);
  const connect = await screen.findByRole("heading", { name: "Connect Lifty" });
  const waiting = screen.getByText("Waiting for the first trace");
  expect(
    connect.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByLabelText("SDK environment")).toHaveTextContent(
    "AUTOEVAL_ENDPOINT=http://localhost:3000/api/backend/v2/traces",
  );
  cleanup();

  serve({ apps: [lifty], keys: [key], traces: { lifty: [trace("t-1")] } });
  render(<ApplicationsScreen />);
  const traces = await screen.findByRole("heading", { name: /Recent traces/ });
  const keys = screen.getByRole("heading", { name: /Application keys/ });
  expect(
    traces.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByText("Waiting for the first trace")).toBeNull();
  // The readiness strip marks the connection done and traces arriving.
  const steps = within(screen.getByLabelText("Application readiness")).getAllByRole(
    "listitem",
  );
  expect(steps.map((step) => step.dataset.state)).toEqual([
    "done",
    "done",
    "current",
  ]);
});

test("a waiting application picks up its first trace without a manual refresh", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let arrived: unknown[] = [];
  serve({ apps: [lifty], keys: [key], traces: { lifty: () => arrived } });
  render(<ApplicationsScreen />);
  await screen.findByText("Waiting for the first trace");
  arrived = [trace("first")];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(await screen.findByRole("button", { name: "first" })).toBeVisible();
  expect(screen.queryByText("Waiting for the first trace")).toBeNull();
});

test("the trace row shows status, failed checks first, and readable metrics", async () => {
  serve({
    apps: [lifty],
    traces: { lifty: [trace("t-1", { status: "error" })] },
    role: "viewer",
  });
  render(<ApplicationsScreen />);
  const row = (await screen.findByRole("button", { name: "t-1" })).closest("tr")!;
  const cells = within(row).getAllByRole("cell");
  expect(cells[2]).toHaveTextContent("error");
  expect(cells[3].textContent).toMatch(/^✕ within_budget.*✓ reply_valid$/);
  expect(cells[4]).toHaveTextContent("latency_ms2.00s");
  expect(cells[4]).toHaveTextContent("cost_usd—");
});

test("a refused write says so and leaves writes available; a lost one locks until a read settles it", async () => {
  let refuse = true;
  let keyReads = 0;
  api.mockImplementation(async (path, options) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications") return [lifty];
    if (path.endsWith("/keys") && options?.method === "POST") {
      if (refuse) throw Object.assign(new Error("Forbidden"), { status: 403 });
      throw new Error("response lost");
    }
    if (path.endsWith("/keys")) {
      keyReads++;
      return [key];
    }
    return [];
  });
  render(<ApplicationsScreen />);
  (await screen.findByRole("button", { name: "Issue key" })).click();
  expect(await screen.findByText("Rejected")).toBeVisible();
  expect(screen.getByText(/HTTP 403\). Nothing was saved/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Issue key" })).toBeEnabled();

  refuse = false;
  screen.getByRole("button", { name: "Issue key" }).click();
  expect(await screen.findByText("Not confirmed")).toBeVisible();
  expect(screen.getByRole("button", { name: "Issue key" })).toBeDisabled();

  const reads = keyReads;
  screen.getByRole("button", { name: "Refresh" }).click();
  await vi.waitFor(() => expect(keyReads).toBeGreaterThan(reads));
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Issue key" })).toBeEnabled(),
  );
  expect(screen.queryByText("Not confirmed")).toBeNull();
});

test("registering another application sets the open one aside, so one lifespan control shows", async () => {
  serve({ apps: [lifty], keys: [key] });
  render(<ApplicationsScreen />);
  await screen.findByRole("heading", { name: "Connect Lifty" });
  screen.getByRole("button", { name: "Register application" }).click();
  await screen.findByRole("heading", { name: "Register application" });
  expect(screen.getAllByRole("button", { name: "Custom" })).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "Connect Lifty" })).toBeNull();
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(
    await screen.findByRole("heading", { name: "Connect Lifty" }),
  ).toBeVisible();
});
