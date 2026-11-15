import { expect, test, type Page } from "@playwright/test";

// Hosted sign-in in a real browser. The build runs with hosted auth on (see
// playwright.config.ts), and every auth or application request is answered
// here with a synthetic fixture: no provider, mailbox, or real identity.
const apiUrl = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}/api`;
const linkUrl = `http://localhost:${process.env.AUTOEVAL_E2E_HOSTED_LINK_PORT ?? "3012"}`;
const codeUrl = `http://localhost:${process.env.AUTOEVAL_E2E_HOSTED_CODE_PORT ?? "3013"}`;
const viewer = { subject: "00000000-0000-4000-8000-0000000000aa", role: "viewer" };

type Fixture = [number, unknown];

/**
 * Answers `path` with `[status, body]`, or with what a function returns for the
 * request's method; anything else reaches the local API.
 */
async function mockApi(
  page: Page,
  fixtures: Record<string, Fixture | ((method: string) => Fixture | undefined)>,
) {
  const requests: { path: string; method: string; body: unknown }[] = [];
  await page.route(`${apiUrl}/**`, async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers().origin ?? "*",
      "access-control-allow-methods": "GET,POST,DELETE",
      "access-control-allow-headers": "content-type,accept",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const entry = fixtures[path];
    const fixture = typeof entry === "function" ? entry(request.method()) : entry;
    if (!fixture) return route.fallback();
    const posted = request.postData();
    requests.push({ path, method: request.method(), body: posted ? JSON.parse(posted) : null });
    await route.fulfill({
      status: fixture[0],
      headers,
      contentType: "application/json",
      body: JSON.stringify(fixture[1]),
    });
  });
  return requests;
}

const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

test("a successful email link keeps account actions reachable on the landing page", async ({ page }) => {
  const requests = await mockApi(page, {
    "/auth/exchange": [200, { authenticated: true }],
    "/auth/session": [200, viewer],
    "/auth/logout": [200, {}],
    "/applications": [200, []],
  });
  await page.goto(`${linkUrl}/?code=${"f".repeat(36)}`);
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: /applications/ })).toBeVisible();
  await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(requests.map((request) => request.path)).toEqual(["/auth/exchange", "/auth/session"]);

  await header.getByRole("link", { name: /applications/ }).click();
  await expect(page).toHaveURL(`${linkUrl}/applications`);
  await expect(page.getByText("No applications shared with you")).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(sidebar.getByRole("link", { name: "Applications" })).toBeVisible();

  await sidebar.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  expect(requests.at(-1)?.path).toBe("/auth/logout");
});

test("focus follows each sign-in step, including back to the email field", async ({ page }) => {
  await mockApi(page, {
    "/auth/session": [401, { detail: "Not authenticated" }],
    "/auth/request": [200, {}],
    "/auth/verify": [401, { detail: "Invalid code" }],
  });
  await page.goto(codeUrl);
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  expect(await focusedId(page)).toBe("auth-email");

  await page.keyboard.type("reviewer@example.invalid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await expect.poll(() => focusedId(page)).toBe("auth-code");

  await page.keyboard.type("123456");
  await page.keyboard.press("Enter");
  await expect(page.locator("section [role=alert]")).toContainText("That code didn't work");
  await expect.poll(() => focusedId(page)).toBe("auth-code");

  await page.getByRole("button", { name: "Use another email or request a new code" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  await expect.poll(() => focusedId(page)).toBe("auth-email");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("reviewer@example.invalid");
});

test("a spaced ten-digit code arrives whole, and an eleventh digit is refused", async ({ page }) => {
  const requests = await mockApi(page, {
    "/auth/session": [401, { detail: "Not authenticated" }],
    "/auth/request": [200, {}],
    "/auth/verify": [401, { detail: "Invalid code" }],
  });
  await page.goto(codeUrl);
  await page.getByLabel("Email", { exact: true }).fill("reviewer@example.invalid");
  await page.getByRole("button", { name: "Send code" }).click();
  const code = page.getByLabel("Email code");
  await expect(code).toBeFocused();

  // insertText goes through the browser's own input path, as a paste or an
  // autofilled one-time code does, so any length limit would apply here.
  await page.keyboard.insertText("12345 67890");
  await expect(code).toHaveValue("1234567890");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.locator("section [role=alert]")).toBeVisible();
  expect(requests.find((request) => request.path === "/auth/verify")?.body).toEqual({
    email: "reviewer@example.invalid",
    token: "1234567890",
  });

  await code.fill("");
  await page.keyboard.insertText("12345 678901");
  await expect(code).toHaveValue("12345678901");
  expect(await code.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  const verifies = requests.filter((request) => request.path === "/auth/verify").length;
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.waitForTimeout(200);
  expect(requests.filter((request) => request.path === "/auth/verify")).toHaveLength(verifies);
});

const pendingSubject = "00000000-0000-4000-8000-0000000000b2";

/**
 * Stands in for the backend's pending record: verification creates it, a
 * status check reads it, approval consumes it, and DELETE clears it. Pending
 * never answers /auth/session, which stays 401 throughout.
 */
function pendingServer() {
  const state = { pending: false, approved: false };
  const status = (): Fixture => {
    if (!state.pending) return [200, { authenticated: false }];
    if (state.approved) {
      state.pending = false;
      return [200, { authenticated: false, status: "approved" }];
    }
    return [200, { authenticated: false, status: "pending", subject: pendingSubject }];
  };
  const verified = (): Fixture => {
    state.pending = true;
    return [200, { authenticated: false, status: "pending", subject: pendingSubject }];
  };
  return {
    state,
    fixtures: {
      "/auth/session": [401, { detail: "Request not authorized" }] as Fixture,
      "/auth/request": [200, {}] as Fixture,
      "/auth/verify": verified,
      "/auth/exchange": verified,
      "/auth/pending": (method: string): Fixture | undefined => {
        if (method === "POST") return status();
        if (method === "DELETE") {
          state.pending = false;
          return [200, { authenticated: false }];
        }
        return undefined;
      },
    },
  };
}

async function expectPendingOnly(page: Page) {
  await expect(page.getByRole("heading", { name: "Approval pending" })).toBeVisible();
  await expect(page.getByText(pendingSubject)).toBeVisible();
  // The workspace chrome never mounts for a pending identity.
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  expect(
    await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length]),
  ).toEqual([0, 0]);
}

test("a numeric-code registration stays pending across reloads until the user leaves", async ({ page }) => {
  const server = pendingServer();
  const requests = await mockApi(page, server.fixtures);
  await page.goto(codeUrl);
  await page.getByLabel("Email", { exact: true }).fill("new-user@example.invalid");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Email code").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expectPendingOnly(page);

  await page.reload();
  await expectPendingOnly(page);
  expect(requests.slice(-2).map(({ path, method }) => `${method} ${path}`)).toEqual([
    "GET /auth/session",
    "POST /auth/pending",
  ]);

  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("Still waiting for approval.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(pendingSubject)).toBeVisible();

  await page.getByRole("button", { name: "Return to sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ path: "/auth/pending", method: "DELETE" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  await expect(page.getByText(pendingSubject)).toHaveCount(0);
});

test("an email-link registration survives reload and approval asks for a fresh sign-in", async ({ page }) => {
  const server = pendingServer();
  const requests = await mockApi(page, server.fixtures);
  await page.goto(`${linkUrl}/?code=${"e".repeat(36)}`);
  await expectPendingOnly(page);
  expect(new URL(page.url()).search).toBe("");

  await page.reload();
  await expectPendingOnly(page);
  // The one-use code was consumed once; the reload asks only for status.
  expect(requests.filter((request) => request.path === "/auth/exchange")).toHaveLength(1);

  server.state.approved = true;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText(/Your account is approved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeVisible();
  await expect(page.getByText(pendingSubject)).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
});

test("a reload with no pending record, or an expired one, starts at sign-in", async ({ page }) => {
  const server = pendingServer();
  await mockApi(page, server.fixtures);
  await page.goto(codeUrl);
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  await expect(page.getByText(pendingSubject)).toHaveCount(0);

  server.state.pending = true;
  await page.reload();
  await expectPendingOnly(page);
  server.state.pending = false; // The server-side record expired.
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText(/no longer available in this browser/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
});
