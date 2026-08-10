import { expect, test } from "@playwright/test";

const incidentRoot = "/systems/incident-triage";

test("serves request-scoped CSP nonces", async ({ page }) => {
  const response = await page.goto(`${incidentRoot}/traces`);
  const policy = response?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const scriptNonces = await page
    .locator("script[nonce]")
    .evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce),
    );
  expect(scriptNonces).toContain(nonce);
});

test("persists an accessible color theme across reloads and routes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Use light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Use dark theme" }),
  ).toBeVisible();

  await page.goto(incidentRoot);
  await page
    .getByRole("link", { name: /Datasets/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /datasets/i })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("uses the shared select treatment and themed JSON disclosures", async ({
  page,
}) => {
  await page.goto(`${incidentRoot}/evaluations`);
  await expect(page.locator("select").first()).toBeVisible();
  const selectStyles = await page.locator("select").evaluateAll((selects) =>
    selects.map((select) => {
      const style = getComputedStyle(select);
      return {
        appearance: style.appearance,
        paddingRight: Number.parseFloat(style.paddingRight),
      };
    }),
  );
  expect(selectStyles.length).toBeGreaterThan(0);
  expect(
    selectStyles.every(
      ({ appearance, paddingRight }) =>
        appearance === "none" && paddingRight >= 32,
    ),
  ).toBe(true);

  await page.goto(`${incidentRoot}/versions`);
  await expect(page.getByText("Structured JSON")).toBeVisible();
  await page.getByRole("button", { name: "Collapse" }).click();
  await expect(page.locator(".json-branch[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand" }).click();
  await expect(page.locator(".json-branch[open]")).toHaveCount(
    await page.locator(".json-branch").count(),
  );
});

test("keeps route navigation immediate when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${incidentRoot}/traces`);
  await page.getByRole("link", { name: /Results/ }).click();
  await expect(page.getByRole("heading", { name: /results/i })).toBeVisible();
  await expect(page.locator("#main-content")).toHaveCount(1);
  await expect(page.locator(".route-content")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("keeps shell geometry stable across primary navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${incidentRoot}/traces`);
  await expect(page.getByRole("heading", { name: /traces/i })).toBeVisible();
  await page.waitForTimeout(550);

  const widths: number[] = [];
  async function recordShellWidth() {
    widths.push(
      await page
        .locator(".shell-header")
        .evaluate((header) => Math.round(header.getBoundingClientRect().width)),
    );
    await expect(page.locator("#main-content")).toHaveCount(1);
  }

  await recordShellWidth();
  await page.getByRole("link", { name: /Evaluate/ }).click();
  await expect(page.getByRole("heading", { name: /Evaluate/i })).toBeVisible();
  await recordShellWidth();
  await page.getByRole("link", { name: /Results/ }).click();
  await expect(page.getByRole("heading", { name: /results/i })).toBeVisible();
  await recordShellWidth();

  expect(new Set(widths).size).toBe(1);
  await expect(page.locator(".route-content-change")).toHaveCount(1);
});

test("uses stable geometry and layered feedback for row hover", async ({
  page,
}) => {
  await page.goto(`${incidentRoot}/results`);
  const row = page.locator(".data-row").first();
  await expect(row).toBeVisible();

  const before = await row.evaluate((element) => ({
    actionTransform: getComputedStyle(
      element.querySelector(".data-row-affordance")!,
    ).transform,
    washOpacity: Number.parseFloat(
      getComputedStyle(element, "::before").opacity,
    ),
  }));

  await row.hover();
  await page.waitForTimeout(30);
  const hovered = await row.evaluate((element) => ({
    actionTransform: getComputedStyle(
      element.querySelector(".data-row-affordance")!,
    ).transform,
    washOpacity: Number.parseFloat(
      getComputedStyle(element, "::before").opacity,
    ),
  }));

  expect(before.washOpacity).toBe(0);
  expect(hovered.washOpacity).toBeGreaterThan(0.7);
  expect(hovered.actionTransform).not.toBe(before.actionTransform);
});

test("inspect a trace and its graph", async ({ page }) => {
  await page.goto(`${incidentRoot}/traces`);
  await expect(page.getByRole("heading", { name: /traces/i })).toBeVisible();
  await page.locator(`a[href^='${incidentRoot}/traces/']`).first().click();
  await expect(page.getByText("Execution graph")).toBeVisible();
  await expect(page.getByTestId("rf__node-normalize_input")).toContainText(
    "Normalize input",
  );
  await expect(page.getByTestId("rf__node-classify_incident")).toContainText(
    "Classify incident",
  );
});

test("run a trace and review it into a draft dataset", async ({ page }) => {
  await page.goto(`${incidentRoot}/traces`);
  await page.getByRole("link", { name: "Run inference" }).click();
  await page.getByLabel("Request input (JSON)").fill(
    JSON.stringify({
      text: "Payment callbacks are delayed for premium customers.",
      service: "payments",
      customer_tier: "standard",
    }),
  );
  await page.getByRole("button", { name: "Run inference" }).click();
  await expect(
    page.getByRole("link", { name: "Inspect full trace" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Inspect full trace" }).click();
  await expect(page.getByText("Execution graph")).toBeVisible();

  await page.getByRole("button", { name: "Add to dataset" }).click();
  await expect(
    page.getByRole("heading", { name: "Review dataset example" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add example" }).click();
  await expect(
    page.getByText("Example added. Membership is now persisted on this trace."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await expect(
    page.getByText(/Incident triage ground truth v\d+ · draft/),
  ).toBeVisible();
});

test("run the seeded evaluation workflow", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto(`${incidentRoot}/evaluations`);
  await expect(page.getByRole("heading", { name: /Evaluate/i })).toBeVisible();
  await page.getByRole("button", { name: "Start evaluation" }).click();
  await expect(page.getByText(/^Run [a-f0-9]{8}$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View results" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "View results" }).click();
  await expect(page.getByText("Model comparison")).toBeVisible();
});

test("results render model metrics and scatter plot", async ({ page }) => {
  await page.goto(`${incidentRoot}/results`);
  await expect(page.getByRole("heading", { name: /results/i })).toBeVisible();
  await expect(page.getByText("Model comparison")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Scatter chart of total cost by accuracy" }),
  ).toBeVisible();
});
