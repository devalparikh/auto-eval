import { expect, test, type Page } from "@playwright/test";

// Hosted sign-in in a real browser. The build runs with hosted auth on (see
// playwright.config.ts), and every auth or application request is answered
// here with a synthetic fixture: no provider, mailbox, or real identity.
const apiUrl = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}/api`;
const linkUrl = `http://localhost:${process.env.AUTOEVAL_E2E_HOSTED_LINK_PORT ?? "3012"}`;
const codeUrl = `http://localhost:${process.env.AUTOEVAL_E2E_HOSTED_CODE_PORT ?? "3013"}`;
const viewer = { subject: "00000000-0000-4000-8000-0000000000aa", role: "viewer" };

type Fixture = [number, unknown];
type Answer = Fixture | undefined | Promise<Fixture | undefined>;

/**
 * The API sets these HttpOnly cookies on the page's own origin, and the page's
 * server reads them to decide whether a sign-in check is worth making. The
 * mocked API answers cross-origin, so tests place them as the API would.
 */
const SESSION_COOKIE = "__Host-autoeval";
const PENDING_COOKIE = "__Host-autoeval-pending";
async function authCookie(page: Page, name: string, present: boolean) {
  if (present)
    await page.context().addCookies([
      // Chrome accepts a __Host- cookie from the test API only with an explicit
      // host and path; it is still sent to localhost on every port.
      { name, value: "synthetic", domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Strict" },
    ]);
  else await page.context().clearCookies({ name });
}

/**
 * Answers `path` with `[status, body]`, or with what a function returns for the
 * request's method; anything else reaches the local API.
 */
async function mockApi(
  page: Page,
  fixtures: Record<string, Fixture | ((method: string) => Answer)>,
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
    const fixture = typeof entry === "function" ? await entry(request.method()) : entry;
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

test("without an auth cookie, sign-in arrives in the page itself and the API is not asked", async ({ page }) => {
  const requests = await mockApi(page, { "/auth/session": [401, { detail: "Not authenticated" }] });
  const response = await page.goto(codeUrl);
  // Server-rendered: the form is in the HTML, not drawn after a session check.
  expect(await response!.text()).toContain("Sign in to AutoEval");
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  await expect(page.getByText(/Checking your session/)).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);
});

test("a session cookie is still verified by the API, and a refused one shows sign-in", async ({ page }) => {
  let allowed = true;
  const requests = await mockApi(page, {
    "/auth/session": () => (allowed ? [200, viewer] : [401, { detail: "Request not authorized" }]),
    "/applications": [200, []],
  });
  await authCookie(page, SESSION_COOKIE, true);
  await page.goto(codeUrl);
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(requests.map((request) => request.path)).toEqual(["/auth/session"]);

  allowed = false;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  // No pending cookie, so a refused session does not go on to ask for one.
  expect(requests.filter((request) => request.path === "/auth/pending")).toEqual([]);
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

  await page.getByRole("button", { name: "Use another email or resend" }).click();
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
function pendingServer(page: Page) {
  const state = { pending: false, approved: false };
  const status = async (): Promise<Fixture> => {
    if (!state.pending) {
      await authCookie(page, PENDING_COOKIE, false);
      return [200, { authenticated: false }];
    }
    if (state.approved) {
      state.pending = false;
      await authCookie(page, PENDING_COOKIE, false);
      return [200, { authenticated: false, status: "approved" }];
    }
    return [200, { authenticated: false, status: "pending", subject: pendingSubject }];
  };
  const verified = async (): Promise<Fixture> => {
    state.pending = true;
    await authCookie(page, PENDING_COOKIE, true);
    return [200, { authenticated: false, status: "pending", subject: pendingSubject }];
  };
  return {
    state,
    fixtures: {
      "/auth/session": [401, { detail: "Request not authorized" }] as Fixture,
      "/auth/request": [200, {}] as Fixture,
      "/auth/verify": verified,
      "/auth/exchange": verified,
      "/auth/pending": async (method: string): Promise<Fixture | undefined> => {
        if (method === "POST") return status();
        if (method === "DELETE") {
          state.pending = false;
          await authCookie(page, PENDING_COOKIE, false);
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
  const server = pendingServer(page);
  const requests = await mockApi(page, server.fixtures);
  await page.goto(codeUrl);
  await page.getByLabel("Email", { exact: true }).fill("new-user@example.invalid");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Email code").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expectPendingOnly(page);

  const before = requests.length;
  await page.reload();
  await expectPendingOnly(page);
  // Only the pending cookie is present, so only its status is asked for.
  expect(requests.slice(before).map(({ path, method }) => `${method} ${path}`)).toEqual([
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
  const server = pendingServer(page);
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
  const server = pendingServer(page);
  await mockApi(page, server.fixtures);
  await page.goto(codeUrl);
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
  await expect(page.getByText(pendingSubject)).toHaveCount(0);

  server.state.pending = true;
  await authCookie(page, PENDING_COOKIE, true);
  await page.reload();
  await expectPendingOnly(page);
  server.state.pending = false; // The server-side record expired.
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText(/expired in this browser/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to AutoEval" })).toBeVisible();
});
