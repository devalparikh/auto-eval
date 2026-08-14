import { expect, test } from "@playwright/test";

const incidentRoot = "/systems/incident-triage";
const portfolioQueryRoot = "/systems/portfolio-query";

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

test("renders the landing page without first-load fade gaps", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".route-content")).toHaveCSS("opacity", "1");
  await expect(page.locator(".landing-art-image")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".landing-title canvas")).toHaveCSS("opacity", "1");
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

  await page.goto(`${incidentRoot}/artifacts`);
  await expect(page.getByLabel("Agent graph structure")).toBeVisible();
  await page.getByRole("button", { name: "Expand graph" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByLabel("Agent graph structure"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("groups growing node-output snapshots by deterministic node", async ({
  page,
}) => {
  await page.goto(`${portfolioQueryRoot}/artifacts`);
  await expect(page.getByLabel("Agent graph structure")).toBeVisible();
  await page.getByRole("button", { name: "Expand graph" }).click();
  const graphDialog = page.getByRole("dialog");
  await expect(
    graphDialog.getByText("external input · options_chain"),
  ).toBeVisible();
  await expect(graphDialog.getByText("run refresh")).toBeVisible();
  await expect(graphDialog.getByText("eval locked").first()).toBeVisible();
  await expect(graphDialog.getByText("conditional")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Snapshots/ }).click();
  await expect(
    page.getByRole("heading", { name: "Node snapshots" }),
  ).toBeVisible();
  await expect(page.getByText("Deterministic nodes")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Persist immutable portfolio snapshot/ }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /Resolve or fetch external options observation/,
    })
    .click();
  await expect(page.getByText("options_chain").first()).toBeVisible();
});

test("fits the artifact graph on initial load and reload", async ({ page }) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 0) {
      await page.goto(`${portfolioQueryRoot}/artifacts`);
    } else {
      await page.reload();
    }

    const graph = page.getByLabel("Agent graph structure");
    await expect(graph).toBeVisible();
    await expect(graph.locator(".react-flow__node")).toHaveCount(8);
    const allNodesInView = await graph.evaluate((element) => {
      const graphBounds = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll(".react-flow__node")).every(
        (node) => {
          const nodeBounds = node.getBoundingClientRect();
          return (
            nodeBounds.width > 0 &&
            nodeBounds.height > 0 &&
            nodeBounds.right > graphBounds.left &&
            nodeBounds.left < graphBounds.right &&
            nodeBounds.bottom > graphBounds.top &&
            nodeBounds.top < graphBounds.bottom
          );
        },
      );
    });
    expect(allNodesInView).toBe(true);
  }
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
  await expect(page.locator(".route-content")).toHaveCSS("opacity", "1");
});

test("zooms through code structure and switches Git comparisons", async ({
  page,
}) => {
  await page.goto("/codebase");
  await expect(page.getByLabel(/Codebase graph at Areas detail/)).toBeVisible();
  await expect(page.locator(".codebase-summary")).toContainText(
    "Local changes",
  );

  await page.getByRole("button", { name: "Zoom In" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Zoom In" }).click();
  await expect(page.locator(".codebase-map-level")).toContainText("Modules");

  await page.getByRole("button", { name: "Logic", exact: true }).click();
  await expect(page.locator(".codebase-summary")).toContainText(
    "agent-maintained",
  );
  await expect(
    page.getByLabel(/Codebase graph at Systems detail/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Files", exact: true }).click();

  await page.getByRole("button", { name: "Staged", exact: true }).click();
  await expect(page.locator(".codebase-summary")).toContainText(
    "Staged changes",
  );

  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Commit revision" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".codebase-summary")).toContainText("Commit");
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

test("runs Q&A against a server-resolved synthetic portfolio snapshot", async ({
  page,
}) => {
  await page.goto(`${portfolioQueryRoot}/run`);
  const resource = page.getByLabel("Resource version");
  await expect(resource).toBeVisible();
  await resource.selectOption("current:synthetic-indexed-portfolio-v2");
  await expect(resource).toHaveValue("current:synthetic-indexed-portfolio-v2");
  await expect(page.getByText("deterministic current resource")).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: /Capture refreshed external outputs/,
    }),
  ).not.toBeChecked();

  const advancedInput = page.getByLabel("Advanced query input (JSON)");
  const advancedValue = await advancedInput.inputValue();
  expect(advancedValue).not.toContain("snapshot_id");
  expect(advancedValue).not.toContain("positions");
  expect(advancedValue).not.toContain("market_context");

  await page.getByRole("button", { name: "Run inference" }).click();
  await expect(
    page.getByRole("link", { name: "Inspect full trace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand" }).click();
  await expect(page.getByText("candidate-001").first()).toBeVisible();
});

test("contains the Run graph preview across representative widths", async ({
  page,
}) => {
  const widths = [1440, 1180, 768, 390];

  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 768 ? 900 : 820 });
    await page.goto(`${portfolioQueryRoot}/run`);
    const preview = page.getByLabel("Selected graph execution preview");
    await expect(preview).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(8);

    const geometry = await preview.evaluate((element) => {
      const documentElement = document.documentElement;
      const bounds = element.getBoundingClientRect();
      return {
        documentClientWidth: documentElement.clientWidth,
        documentScrollWidth: documentElement.scrollWidth,
        left: bounds.left,
        right: bounds.right,
      };
    });

    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(
      geometry.documentClientWidth,
    );
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.documentClientWidth);

    const nodePositions = await preview
      .locator(".react-flow__node")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const bounds = node.getBoundingClientRect();
          return { left: bounds.left, top: bounds.top };
        }),
      );
    expect(new Set(nodePositions.map(({ top }) => Math.round(top))).size).toBe(
      1,
    );
    expect(
      nodePositions.every(
        ({ left }, index) =>
          index === 0 || left > nodePositions[index - 1]!.left,
      ),
    ).toBe(true);
  }
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
