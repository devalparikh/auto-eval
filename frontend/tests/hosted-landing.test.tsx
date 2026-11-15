import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/features/auth/auth-gate";
import { apiRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  api: { catalog: vi.fn(() => new Promise(() => {})) },
  API_URL: "/api/backend/api",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function Landing() {
  return (
    <AuthGate enabled emailLink>
      <AppShell initialTheme="dark" initialSidebar="expanded">
        <p>Landing page</p>
      </AppShell>
    </AuthGate>
  );
}

test("a successful email-link callback lands on the page with account actions in its header", async () => {
  window.history.replaceState(null, "", "/?code=" + "e".repeat(36));
  const api = vi.mocked(apiRequest);
  api.mockImplementation(async (path) => {
    expect(window.location.search).toBe("");
    if (path === "/auth/exchange") return { authenticated: true };
    if (path === "/auth/session") return { subject: "00000000-0000-4000-8000-0000000000aa", role: "viewer" };
    throw new Error(`unexpected ${String(path)}`);
  });
  render(<Landing />);
  await screen.findByText("Landing page");
  expect(api.mock.calls.map(([path]) => path)).toEqual(["/auth/exchange", "/auth/session"]);
  const banner = screen.getByRole("banner");
  expect(screen.getByRole("link", { name: /applications/ })).toHaveAttribute("href", "/applications");
  expect(banner).not.toHaveTextContent("open autoeval");

  api.mockImplementation(async (path) => {
    if (path === "/auth/logout") return {};
    throw new Error(`unexpected ${String(path)}`);
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("button", { name: "Send sign-in link" });
  expect(api).toHaveBeenLastCalledWith("/auth/logout", { method: "POST" });
  expect(screen.queryByText("Landing page")).toBeNull();
});

test("local mode keeps the landing header's workbench link and offers no sign-out", async () => {
  render(
    <AuthGate enabled={false}>
      <AppShell initialTheme="dark" initialSidebar="expanded">
        <p>Landing page</p>
      </AppShell>
    </AuthGate>,
  );
  expect(screen.getByRole("link", { name: /open autoeval/ })).toHaveAttribute("href", "/systems");
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  await waitFor(() => expect(apiRequest).not.toHaveBeenCalled());
});
