import { expect, test } from "@playwright/test";

test("serves request-scoped CSP nonces", async ({ page }) => {
  const response = await page.goto("/traces");
  const policy = response?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const scriptNonces = await page.locator("script[nonce]").evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).nonce),
  );
  expect(scriptNonces).toContain(nonce);
});

test("inspect a trace and its graph", async ({ page }) => {
  await page.goto("/traces");
  await expect(page.getByRole("heading", { name: "Traces" })).toBeVisible();
  await page.locator("a[href^='/traces/']").first().click();
  await expect(page.getByText("Execution graph")).toBeVisible();
  await expect(page.getByTestId("rf__node-normalize_input")).toContainText("Normalize input");
  await expect(page.getByTestId("rf__node-classify_incident")).toContainText("Classify incident");
});

test("run a trace and review it into a draft dataset", async ({ page }) => {
  await page.goto("/traces");
  await page.getByRole("button", { name: "Run trace" }).click();
  await page.getByLabel("Incident report").fill("Payment callbacks are delayed for premium customers.");
  await page.getByLabel("Service").fill("payments");
  await page.getByRole("button", { name: "Run trace" }).last().click();
  await expect(page.getByText("Execution graph")).toBeVisible();

  await page.getByRole("button", { name: "Add to dataset" }).click();
  await expect(page.getByRole("heading", { name: "Review dataset example" })).toBeVisible();
  await page.getByRole("button", { name: "Add example" }).click();
  await expect(page.getByRole("button", { name: "Added" })).toBeVisible();
});

test("run the seeded evaluation workflow", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/evaluations");
  await expect(page.getByRole("heading", { name: "Run evaluation" })).toBeVisible();
  await page.getByRole("button", { name: "Start evaluation" }).click();
  await expect(page.getByText(/^Run [a-f0-9]{8}$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View results" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "View results" }).click();
  await expect(page.getByText("Model comparison")).toBeVisible();
});

test("results render model metrics and scatter plot", async ({ page }) => {
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Evaluation results" })).toBeVisible();
  await expect(page.getByText("Model comparison")).toBeVisible();
  await expect(page.getByRole("img", { name: "Scatter chart of total cost by accuracy" })).toBeVisible();
});
