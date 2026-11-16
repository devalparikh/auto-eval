import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ApplicationsScreen } from "@/features/applications/applications-screen";
import { ApplicationSettings } from "@/features/applications/application-settings";
import { TraceReview } from "@/features/applications/trace-review";
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
  content_categories: ["conversation"],
};
const app = {
  id: "app",
  name: "Synthetic",
  settings,
  settingsVersion: "version1",
};
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

test("minimal creation requests only name, identity and chosen key lifespan", async () => {
  let created = false;
  api.mockImplementation(async (path, options) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications" && options?.method === "POST") {
      created = true;
      return { id: "app", key: { token: "synthetic-once" } };
    }
    if (path === "/applications") return created ? [app] : [];
    return [];
  });
  render(<ApplicationsScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Register application" }),
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Synthetic" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Custom key lifespan in days"), {
    target: { value: "14" },
  });
  expect(screen.queryByLabelText("Allow production capture")).toBeNull();
  expect(screen.queryByText("Content categories")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
  await screen.findByText("synthetic-once");
  const call = api.mock.calls.find(
    ([path, options]) => path === "/applications" && options?.method === "POST",
  )!;
  const body = call[1]!.body as {
    id: string;
    name: string;
    key: { expiresAt: number };
  };
  expect(Object.keys(body).sort()).toEqual(["id", "key", "name"]);
  expect(body.key.expiresAt - Date.now()).toBeGreaterThan(13.9 * 86400000);
  expect(body.key.expiresAt - Date.now()).toBeLessThanOrEqual(14 * 86400000);
  // Once the key is on screen the registration form has done its job.
  expect(screen.queryByRole("heading", { name: "Register application" })).toBeNull();
  expect(screen.queryByLabelText("Name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hide key" }));
  expect(screen.queryByText("synthetic-once")).toBeNull();
});

test("settings distinguish Keep, category permission and user consent; stale save requires reload", async () => {
  api.mockImplementation(async (path, options) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications") return [app];
    if (path.endsWith("/policy-categories"))
      return [{ id: "p", categories: ["body_scans"] }];
    if (options?.method === "PUT") throw new Error("conflict");
    return {};
  });
  render(<ApplicationSettings appId="app" />);
  const enabled = await screen.findByLabelText("Allow production capture");
  expect(enabled).toBeChecked();
  expect(screen.getByLabelText("All evidence retention")).toHaveValue("keep");
  expect(screen.getByLabelText("body scans")).not.toBeChecked();
  fireEvent.click(enabled);
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByRole("alert");
  const write = api.mock.calls.find(
    ([, options]) => options?.method === "PUT",
  )!;
  expect(write[1]?.headers).toEqual({ "if-match": "version1" });
  expect(write[1]?.body).toEqual({ ...settings, production_enabled: false });
  expect(screen.getByRole("button", { name: "Reload settings" })).toBeEnabled();
});

test("viewer trace review never requests diagnostic content or shows assessment writes", async () => {
  api.mockResolvedValue({
    trace: {
      id: "trace",
      policyVersion: "p",
      experimentId: "e",
      status: "error",
      steps: [],
      droppedSteps: 0,
      metrics: { cost_usd: null },
      checks: { passed: true },
      coverage: {},
    },
    outcomes: [],
    assessments: [],
    content: {},
  });
  render(
    <TraceReview
      appId="app"
      traceId="trace"
      admin={false}
      onClose={() => {}}
    />,
  );
  await screen.findByText(/Status: error/);
  expect(
    screen.queryByRole("button", { name: "Load diagnostic content" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Save assessment" })).toBeNull();
  expect(api.mock.calls.map(([path]) => path)).toEqual([
    "/applications/app/traces/trace",
  ]);
});

test("key rotation sends explicit overlap and caller-selected replacement expiry", async () => {
  const expiry = Date.now() + 86400000;
  api.mockImplementation(async (path, options) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications") return [app];
    if (path.endsWith("/keys"))
      return [
        {
          id: "key",
          label: "App connection",
          scope: "application:connect",
          expiresAt: expiry,
          retireAt: null,
          revoked: false,
        },
      ];
    if (options?.method === "POST") return { token: "synthetic-replacement" };
    return [];
  });
  render(<ApplicationsScreen />);
  fireEvent.change(await screen.findByLabelText("Application"), {
    target: { value: "app" },
  });
  await screen.findByText("key");
  fireEvent.change(screen.getByLabelText("Rotation overlap"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
  await screen.findByText("synthetic-replacement");
  const call = api.mock.calls.find(([path]) => path.endsWith("/rotate"))!;
  expect(
    (call[1]!.body as { retireAt: number }).retireAt - Date.now(),
  ).toBeGreaterThan(3500000);
});

test("a key without expiry is chosen explicitly, listed as such, and still rotates", async () => {
  api.mockImplementation(async (path, options) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications") return [app];
    if (path.endsWith("/keys") && options?.method !== "POST")
      return [
        {
          id: "forever",
          label: "App connection",
          scope: "application:connect",
          createdAt: 0,
          expiresAt: null,
          retireAt: null,
          revoked: false,
        },
      ];
    if (options?.method === "POST") return { token: "synthetic-never" };
    return [];
  });
  render(<ApplicationsScreen />);
  fireEvent.change(await screen.findByLabelText("Application"), {
    target: { value: "app" },
  });
  await screen.findByText("forever");
  expect(screen.getByText("No expiry")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Never" }));
  fireEvent.click(screen.getByRole("button", { name: "Issue key" }));
  await screen.findByText("synthetic-never");
  const issued = api.mock.calls.find(
    ([path, options]) => path === "/applications/app/keys" && options?.method === "POST",
  )!;
  expect(issued[1]!.body).toEqual({ expiresAt: null });

  fireEvent.click(await screen.findByRole("button", { name: "Rotate" }));
  await waitFor(() =>
    expect(api.mock.calls.some(([path]) => path.endsWith("/rotate"))).toBe(true),
  );
  const rotated = api.mock.calls.find(([path]) => path.endsWith("/rotate"))!;
  const body = rotated[1]!.body as { expiresAt: number | null; retireAt: number };
  // The old key has no expiry to bound the overlap; the chosen hour does.
  expect(body.expiresAt).toBeNull();
  expect(body.retireAt - Date.now()).toBeGreaterThan(3500000);
  expect(body.retireAt - Date.now()).toBeLessThanOrEqual(3600000);
});

test("a custom lifespan outside 1 to 365 whole days cannot be submitted", async () => {
  api.mockImplementation(async (path) => {
    if (path === "/auth/session") return { role: "admin" };
    return [];
  });
  render(<ApplicationsScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Register application" }),
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Synthetic" } });
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  const days = screen.getByLabelText("Custom key lifespan in days");
  for (const value of ["0", "366", "1.5", ""]) {
    fireEvent.change(days, { target: { value } });
    expect(screen.getByRole("button", { name: "Register" })).toBeDisabled();
  }
  fireEvent.change(days, { target: { value: "365" } });
  expect(screen.getByRole("button", { name: "Register" })).toBeEnabled();
});

test("an unmounted diagnostic request cannot replace a different trace", async () => {
  let resolve!: (value: unknown) => void;
  const delayed = new Promise((value) => {
    resolve = value;
  });
  const detail = (id: string) => ({
    trace: {
      id,
      policyVersion: "p",
      experimentId: "e",
      status: "ok",
      steps: [],
    },
    outcomes: [],
    assessments: [],
    content: {},
  });
  api.mockImplementation(async (path) =>
    path.endsWith("/content") ? delayed : detail(path.split("/").at(-1)!),
  );
  const view = render(
    <TraceReview
      key="one"
      appId="app"
      traceId="one"
      admin
      onClose={() => {}}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Load diagnostic content" }),
  );
  view.rerender(
    <TraceReview
      key="two"
      appId="app"
      traceId="two"
      admin
      onClose={() => {}}
    />,
  );
  await screen.findByRole("button", { name: "Load diagnostic content" });
  resolve({
    ...detail("one"),
    content: { one: { message: "obsolete diagnostic" } },
  });
  await waitFor(() =>
    expect(screen.queryByText(/obsolete diagnostic/)).toBeNull(),
  );
});

test("settings reload blocks edits until the read settles and visits every category page", async () => {
  let resolve!: (value: unknown) => void;
  let reads = 0;
  const delayed = new Promise((value) => {
    resolve = value;
  });
  api.mockImplementation(async (path) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications") {
      reads++;
      return reads === 1 ? [app] : delayed;
    }
    if (path.endsWith("/policy-categories"))
      return Array.from({ length: 100 }, (_, i) => ({
        id: String(i).padStart(64, "0"),
        categories: ["conversation"],
      }));
    if (path.includes("?after="))
      return [{ id: "f".repeat(64), categories: ["late_scope"] }];
    return {};
  });
  render(<ApplicationSettings appId="app" />);
  await screen.findByLabelText("late scope");
  fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("Allow production capture")).toBeNull(),
  );
  resolve([
    {
      ...app,
      settings: { ...settings, production_enabled: false },
      settingsVersion: "version2",
    },
  ]);
  expect(
    await screen.findByLabelText("Allow production capture"),
  ).not.toBeChecked();
});

test("lost creation response requires refresh and keeps the same app identity", async () => {
  let creates = 0;
  let id = "";
  api.mockImplementation(async (path, options) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications" && options?.method === "POST") {
      creates++;
      id = (options.body as { id: string }).id;
      throw new Error("response lost");
    }
    if (path === "/applications") return creates ? [{ ...app, id }] : [];
    return [];
  });
  render(<ApplicationsScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Register application" }),
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Synthetic" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Register" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(/Application created/);
  expect(creates).toBe(1);
});

test("failed refresh clears previously loaded diagnostic content", async () => {
  let loaded = false;
  const detail = {
    trace: {
      id: "trace",
      policyVersion: "p",
      experimentId: "e",
      status: "ok",
      steps: [],
    },
    outcomes: [],
    assessments: [],
    content: {},
  };
  api.mockImplementation(async (path) => {
    if (path.endsWith("/content")) {
      if (loaded) throw new Error("gone");
      loaded = true;
      return {
        ...detail,
        content: { trace: { message: "previous diagnostic" } },
      };
    }
    return detail;
  });
  render(<TraceReview appId="app" traceId="trace" admin onClose={() => {}} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Load diagnostic content" }),
  );
  await screen.findByText(/previous diagnostic/);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh diagnostic content" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText(/previous diagnostic/)).toBeNull();
});

test("a read started before a lost key write cannot clear the uncertain state", async () => {
  let resolve!: (value: unknown) => void;
  const delayed = new Promise((value) => {
    resolve = value;
  });
  api.mockImplementation(async (path, options) => {
    if (path === "/auth/session") return { role: "admin" };
    if (path === "/applications") return [app];
    if (path.endsWith("/keys") && options?.method === "POST")
      throw new Error("response lost");
    if (path.endsWith("/keys")) return delayed;
    return [];
  });
  render(<ApplicationsScreen />);
  fireEvent.change(await screen.findByLabelText("Application"), {
    target: { value: "app" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Issue key" }));
  await screen.findByRole("alert");
  resolve([]);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Issue key" })).toBeDisabled(),
  );
});
