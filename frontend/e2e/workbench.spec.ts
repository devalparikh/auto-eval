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
  await expect(
    page.getByLabel("Interactive AutoEval workflow"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trace your agent. Test every change." }),
  ).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "AutoEval workflow steps" });
  await tabs.getByRole("tab", { name: /Connect/ }).click();
  await expect(page.getByText("CODE ADAPTER", { exact: true })).toBeVisible();
  await tabs.getByRole("tab", { name: /Save/ }).click();
  await expect(page.getByText("Finalize v4")).toBeVisible();
  await tabs.getByRole("tab", { name: /Compare/ }).click();
  await expect(
    page
      .getByLabel("Interactive AutoEval workflow")
      .getByText("128 × 6 candidates"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Use the agent you already have." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "open autoeval", exact: true }).first(),
  ).toHaveAttribute("href", "/systems");
  await expect(page.locator("canvas").first()).toHaveCSS("opacity", "1");
});

test("keeps the marketing navigation and desktop preview interactive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const github = page.getByRole("link", { name: "github", exact: true });
  await expect(github).toHaveAttribute(
    "href",
    "https://github.com/devalparikh/auto-eval",
  );
  await expect(github).toHaveAttribute("target", "_blank");

  const product = page.getByRole("button", { name: "product" });
  await product.focus();
  await page.keyboard.press("Enter");
  await expect(product).toHaveAttribute("aria-expanded", "true");

  const menu = page.locator("#marketing-product-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "provenance" }).hover();
  await expect(menu.getByText("Pin every graph")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(product).toHaveAttribute("aria-expanded", "false");

  const preview = page
    .getByLabel("Interactive AutoEval workflow")
    .locator("div[class*='previewWindow']");
  await expect(preview).toBeVisible();
  expect(
    await preview.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderRadius),
    ),
  ).toBeGreaterThanOrEqual(12);

  await page.getByRole("button", { name: "continue to save" }).click();
  await expect(
    page
      .getByRole("tablist", { name: "AutoEval workflow steps" })
      .getByRole("tab", { name: /Save/ }),
  ).toHaveAttribute("aria-selected", "true");
});

test("keeps the landing preview one size through every step", async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    const preview = page.getByLabel("Interactive AutoEval workflow");
    const tabs = page.getByRole("tablist", { name: "AutoEval workflow steps" });
    const sizes = new Set<string>();
    for (const name of ["Connect", "Trace", "Save", "Compare"]) {
      await tabs.getByRole("tab", { name, exact: true }).click();
      // Long enough for the crossfade and each scene's first beats.
      await page.waitForTimeout(1200);
      sizes.add(
        JSON.stringify(
          await preview.evaluate((element) => ({
            preview: Math.round(element.getBoundingClientRect().height),
            page: document.documentElement.scrollHeight,
          })),
        ),
      );
    }
    expect([...sizes]).toHaveLength(1);
  }
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
  await expect(graphDialog.getByText("Live data").first()).toBeVisible();
  await expect(graphDialog.getByText("Saved data").first()).toBeVisible();
  await expect(graphDialog.getByText("Optional").first()).toBeVisible();

  await graphDialog
    .getByText("Resolve or fetch external options observation")
    .click();
  const nodeDetails = graphDialog.getByLabel(
    "Resolve or fetch external options observation details",
  );
  await expect(nodeDetails.getByText("options_chain").first()).toBeVisible();
  await expect(nodeDetails.getByText("Fetches new data.")).toBeVisible();
  await expect(
    nodeDetails.getByText(
      "Reuses the copy pinned to each dataset example.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Snapshots/ }).click();
  await expect(
    page.getByRole("heading", { name: "Snapshots", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Nodes", { exact: true })).toBeVisible();
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
        .locator(".shell-sidebar")
        .evaluate((sidebar) => Math.round(sidebar.getBoundingClientRect().width)),
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

test("glides one highlight across table rows on hover", async ({ page }) => {
  await page.goto(`${incidentRoot}/results`);
  const rows = page.locator("main .data-row");
  await expect(rows.nth(1)).toBeVisible();
  const pill = page.locator("main .glide-pill").first();
  await expect(pill).toHaveAttribute("data-visible", "false");

  const firstRow = rows.first();
  const affordance = () =>
    firstRow.evaluate(
      (element) =>
        getComputedStyle(element.querySelector(".data-row-affordance")!)
          .transform,
    );
  const restingAffordance = await affordance();

  const pillTop = () =>
    pill.evaluate((element) => element.getBoundingClientRect().top);
  const rowTop = (index: number) =>
    rows
      .nth(index)
      .evaluate((element) => element.getBoundingClientRect().top);

  await firstRow.hover();
  await expect(pill).toHaveAttribute("data-visible", "true");
  await expect
    .poll(async () => Math.abs((await pillTop()) - (await rowTop(0))))
    .toBeLessThan(1);
  await expect.poll(affordance).not.toBe(restingAffordance);

  await rows.nth(1).hover();
  await expect
    .poll(async () => Math.abs((await pillTop()) - (await rowTop(1))))
    .toBeLessThan(1);

  // The rows do not also fade on their own.
  expect(
    await firstRow.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element, "::before").opacity),
    ),
  ).toBe(0);
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

test("trace details and dataset review reflow around long structured requests", async ({ page }) => {
  await page.goto(`${portfolioQueryRoot}/traces`);
  await page.locator(`a[href^='${portfolioQueryRoot}/traces/']`).first().click();
  const selector = page.getByLabel("Inspect node", { exact: true });
  await expect(selector).toBeVisible();
  await selector.selectOption("load_portfolio_market_data");
  const inspector = page.getByRole("region", { name: "Resolve or fetch external options observation details" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText("Data used in this execution")).toBeVisible();

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const graphBottom = await page.getByLabel("Trace execution graph").evaluate(element => element.getBoundingClientRect().bottom);
    const inspectorTop = await inspector.evaluate(element => element.getBoundingClientRect().top);
    expect(inspectorTop).toBeGreaterThanOrEqual(graphBottom);
  }
  await page.getByRole("button", { name: "Add to dataset" }).click();
  const dialog = page.getByRole("dialog", { name: "Review dataset example" });
  await expect(dialog.getByRole("textbox", { name: "JSON object", exact: true })).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => dialog.locator("form").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
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
  await page.getByText("Request and run details", { exact: true }).click();
  await expect(
    page.getByText(/Incident triage ground truth v\d+ \(draft\)/),
  ).toBeVisible();
});

test("runs Q&A against a server-resolved synthetic portfolio snapshot", async ({
  page,
}) => {
  await page.goto(`${portfolioQueryRoot}/run`);
  const resource = page.getByLabel("Saved input version");
  await expect(resource).toBeVisible();
  await resource.selectOption("current:synthetic-indexed-portfolio-v2");
  await expect(resource).toHaveValue("current:synthetic-indexed-portfolio-v2");
  await expect(
    page.getByText("Uses the newest saved version.").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: /Save live data for replay/,
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
  await page.getByRole("button", { name: "Expand", exact: true }).click();
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
  await page.getByRole("button", { name: "Run benchmark", exact: true }).click();
  await expect(page.getByText(/^Run [a-f0-9]{8}$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View results" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "View results" }).click();
  await expect(page.getByText("Model and graph comparison")).toBeVisible();
});

test("results render model metrics and scatter plot", async ({ page }) => {
  await page.goto(`${incidentRoot}/results`);
  await expect(page.getByRole("heading", { name: /results/i })).toBeVisible();
  await expect(page.getByText("Model and graph comparison")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Scatter chart of accuracy by total cost" }),
  ).toBeVisible();
});
