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
