import { expect, test, type Page } from "@playwright/test";

// Hosted sign-in in a real browser. The build runs with hosted auth on (see
// playwright.config.ts), and every auth or application request is answered
// here with a synthetic fixture: no provider, mailbox, or real identity.
const apiUrl = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}/api`;
const linkUrl = `http://localhost:${process.env.AUTOEVAL_E2E_HOSTED_LINK_PORT ?? "3012"}`;
const codeUrl = `http://localhost:${process.env.AUTOEVAL_E2E_HOSTED_CODE_PORT ?? "3013"}`;
const viewer = { subject: "00000000-0000-4000-8000-0000000000aa", role: "viewer" };

/** Answers `path` with `[status, body]`; anything else reaches the local API. */
async function mockApi(page: Page, fixtures: Record<string, [number, unknown]>) {
  const requests: { path: string; body: unknown }[] = [];
  await page.route(`${apiUrl}/**`, async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers().origin ?? "*",
      "access-control-allow-methods": "GET,POST,DELETE",
      "access-control-allow-headers": "content-type,accept",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const fixture = fixtures[path];
    if (!fixture) return route.fallback();
    const posted = request.postData();
    requests.push({ path, body: posted ? JSON.parse(posted) : null });
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
