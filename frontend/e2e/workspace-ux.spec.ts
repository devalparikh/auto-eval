import { expect, test } from "@playwright/test";
import type { AgentVersionDetail, Catalog } from "../src/lib/types";

const apiUrl = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}/api`;
const incidentRoot = "/systems/incident-triage";
const portfolioQueryRoot = "/systems/portfolio-query";

test("collapses the sidebar with its shortcut and remembers it", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(incidentRoot);
  const sidebar = page.locator(".shell-sidebar");
  const width = () =>
    sidebar.evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    );
  await expect.poll(width).toBe(232);
  await expect(page.getByLabel("Agent graph structure")).toBeVisible();
  // The seeded system has finished every step, so wait for its counts to load.
  await expect(page.getByText(/^\d+ traces?$/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("overview-dark.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(width).toBe(56);
  // Labels stay in the DOM, so every link keeps its accessible name.
  await expect(page.getByRole("link", { name: "Results", exact: true })).toHaveCount(1);

  await page.getByRole("link", { name: "Results", exact: true }).hover();
  await expect(page.locator(".shell-tooltip")).toHaveText("Results");
  await page.screenshot({
    path: testInfo.outputPath("sidebar-collapsed.png"),
    animations: "disabled",
  });

  await page.reload();
  await expect.poll(width).toBe(56);
  await page.getByRole("button", { name: "Expand sidebar" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(width).toBe(232);
});

test("opens the navigation as a drawer on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(incidentRoot);
  const results = page.getByRole("link", { name: "Results", exact: true });
  await expect(results).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(results).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(results).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await results.click();
  await expect(page).toHaveURL(new RegExp(`${incidentRoot}/results`));
  await expect(results).toBeHidden();
});

test("keeps the trace list beside the selected trace and can hide it", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${incidentRoot}/traces`);
  await expect(page.getByRole("heading", { name: "Select a trace" })).toBeVisible();

  const list = page.getByRole("complementary", { name: "Trace list" });
  const rows = list.locator(`a[href^='${incidentRoot}/traces/']`);
  await expect(rows.nth(1)).toBeVisible();

  // One highlight travels between rows of different heights.
  const pill = list.locator(".glide-pill");
  const distance = async (index: number) => {
    const glide = await pill.elementHandle();
    return rows.nth(index).evaluate((row, element) => {
      const rowBounds = row.getBoundingClientRect();
      const pillBounds = (element as Element).getBoundingClientRect();
      return (
        Math.abs(rowBounds.top - pillBounds.top) +
        Math.abs(rowBounds.height - pillBounds.height)
      );
    }, glide);
  };
  await rows.nth(0).hover();
  await expect(pill).toHaveAttribute("data-visible", "true");
  await expect.poll(() => distance(0)).toBeLessThan(1);
  await rows.nth(2).hover();
  await expect.poll(() => distance(2)).toBeLessThan(1);
  await page.screenshot({
    path: testInfo.outputPath("traces-hover.png"),
    animations: "disabled",
  });

  await rows.first().click();
  await expect(page.getByText("Execution graph")).toBeVisible();
  await expect(rows.first()).toHaveAttribute("aria-current", "page");
  await page.screenshot({
    path: testInfo.outputPath("traces-split.png"),
    animations: "disabled",
  });

  // A marker on the list element proves it stayed mounted across the change.
  await list.evaluate((element) => {
    element.dataset.kept = "yes";
  });
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Execution graph")).toBeVisible();
  await expect(list).toHaveAttribute("data-kept", "yes");

  const listWidth = () =>
    page
      .locator(".split-pane-side")
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));
  await page.getByRole("button", { name: "Hide trace list" }).click();
  await expect.poll(listWidth).toBe(0);
  await page.reload();
  await expect(page.getByText("Execution graph")).toBeVisible();
  await expect.poll(listWidth).toBe(0);
  await page.getByRole("button", { name: "Show trace list" }).click();
  await expect.poll(listWidth).toBe(304);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(list).toBeHidden();
  await expect(page.getByRole("link", { name: "All traces" })).toBeVisible();
});

test("the dropdown drives the native select and stays usable by keyboard", async ({
  page,
}, testInfo) => {
  await page.goto(`${portfolioQueryRoot}/artifacts`);
  await expect(page.getByLabel("Agent graph structure")).toBeVisible();
  await page.goto(`${incidentRoot}/run`);
  const native = page.locator("#run-model");
  await expect(native).toBeAttached();
  const trigger = page
    .locator(".select-control", { has: native })
    .locator(".select-trigger");

  await trigger.click();
  const listbox = page.locator(".dropdown-panel [role=listbox]");
  await expect(listbox).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("dropdown-open.png"),
    animations: "disabled",
  });

  const options = listbox.getByRole("option");
  const count = await options.count();
  await options.nth(count - 1).click();
  await expect(listbox).toBeHidden();
  const pickedValue = await native.inputValue();
  await expect(trigger).toContainText(
    (await native.locator("option:checked").textContent()) ?? "",
  );

  await native.focus();
  await page.keyboard.press("ArrowDown");
  await expect(listbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  expect(await native.inputValue()).toBe(pickedValue);
});

test("selecting a graph node does not pan or re-measure the canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${portfolioQueryRoot}/artifacts`);
  const graph = page.getByLabel("Agent graph structure");
  await expect(graph.locator(".react-flow__node")).toHaveCount(8);
  await expect(graph.locator(".react-flow__edge").first()).toBeAttached();
  const edgeCount = await graph.locator(".react-flow__edge").count();
  const viewport = graph.locator(".react-flow__viewport");
  const transform = () =>
    viewport.evaluate((element) => getComputedStyle(element).transform);
  // Wait for the initial fit to settle: under load it can still be easing a
  // fraction of a pixel after a fixed wait, which read as a pan.
  let before = await transform();
  await expect
    .poll(
      async () => {
        const now = await transform();
        const settled = now === before;
        before = now;
        return settled;
      },
      { intervals: [200] },
    )
    .toBe(true);

  // A real click drifts a few pixels between press and release.
  const node = graph.locator(".react-flow__node").nth(1);
  const box = await node.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 4, box!.y + box!.height / 2 + 2);
  await page.mouse.up();

  await expect(node.locator(".graph-node-card")).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(graph.locator(".graph-edge-active").first()).toBeAttached();
  await expect(graph.locator(".react-flow__edge")).toHaveCount(edgeCount);
  expect(await transform()).toBe(before);

  const third = graph.locator(".react-flow__node").nth(2);
  await third.focus();
  await page.keyboard.press("Enter");
  await expect(third.locator(".graph-node-card")).toHaveAttribute(
    "data-selected",
    "true",
  );
});

test("benchmarks two graph versions and compares them", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const catalog = (await (await request.get(`${apiUrl}/catalog`)).json()) as Catalog;
  const system = catalog.agent_systems.find(
    (item) => item.key === "incident-triage",
  )!;
  const latest = (await (
    await request.get(`${apiUrl}/agent-system-versions/${system.versions[0]!.id}`)
  ).json()) as AgentVersionDetail;
  const definition = structuredClone(latest.definition);
  const lastNode = definition.nodes.at(-1)!;
  lastNode.label = `${lastNode.label} (changed)`;
  const created = await request.post(
    `${apiUrl}/agent-systems/${system.id}/versions`,
    { data: { definition } },
  );
  expect(created.ok()).toBeTruthy();
  const newVersion = ((await created.json()) as AgentVersionDetail).version;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${incidentRoot}/evaluations`);
  await page.getByRole("combobox", { name: "Graph versions" }).click();
  await page
    .locator(".dropdown-panel")
    .getByRole("option", { name: `Version ${latest.version}`, exact: true })
    .click();
  await expect(page.getByText(/× 2 graphs ×/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("benchmark-graph-picker.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Run benchmark", exact: true }).click();
  await expect(page.getByRole("link", { name: "View results" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/^Run [a-f0-9]{8}$/)).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("benchmark-two-runs.png"),
    animations: "disabled",
  });

  await page.getByRole("link", { name: "View results" }).click();
  await expect(page.getByText("Model and graph comparison")).toBeVisible();
  await expect(page.getByText(`Graph v${newVersion}`).first()).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("results-by-graph.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("import keeps source and progress in a pane that can be hidden", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/import");
  await expect(
    page.getByRole("heading", { name: "Where does your agent live?" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("import-source.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Paste manifest" }).click();
  await expect(page.getByLabel("autoeval.json")).toBeVisible();

  // A collapsed pane clips its contents and makes them inert, so measure the
  // pane: Playwright still counts clipped children as visible.
  const paneWidth = () =>
    page
      .locator(".split-pane-side")
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));
  await page.getByRole("button", { name: "Hide import menu" }).click();
  await expect.poll(paneWidth).toBe(0);
  await expect(page.locator(".split-pane-side")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Show import menu" }).click();
  await expect.poll(paneWidth).toBe(304);

  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.getByText("New graph", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Paste manifest" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("import-review.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test("the command menu finds pages and traces and runs actions", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`${incidentRoot}/traces`);
  const input = page.getByRole("combobox", { name: "Search AutoEval" });
  await expect(input).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("command-menu.png"),
    animations: "disabled",
  });

  await input.fill("results");
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${incidentRoot}/results`));

  // Opening it from the sidebar works too, and Escape returns focus.
  const trigger = page.getByRole("button", { name: "Open command menu" });
  await trigger.click();
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  await page.keyboard.press("ControlOrMeta+k");
  await input.fill("theme");
  await page.keyboard.press("Enter");
  await expect(html).not.toHaveAttribute("data-theme", before ?? "");

  // It also opens on the landing page, without calling the API until then.
  // The shortcut is a client listener, so a press before hydration is lost;
  // the landing page makes no requests of its own once its code has loaded.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
});

test("the Models section follows agent systems at the same spacing", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(incidentRoot);
  const primary = page.getByRole("navigation", { name: "Primary" });
  const heading = (name: string) =>
    primary.locator(".shell-nav-heading", { hasText: name });
  const models = primary.getByRole("link", { name: "Custom models" });
  const switcher = page.getByRole("button", { name: /Switch agent system/ });
  const results = primary.getByRole("link", { name: "Results" });
  const run = primary.getByRole("link", { name: "Run" });

  // Every section opens the same distance below the rows before it.
  const gapAbove = async (
    section: ReturnType<typeof heading>,
    previousRow: typeof models,
  ) => {
    const sectionBox = await section.boundingBox();
    const rowBox = await previousRow.boundingBox();
    return sectionBox!.y - (rowBox!.y + rowBox!.height);
  };
  const graph = primary.getByRole("link", { name: /Graph & prompts/ });
  const modelsGap = await gapAbove(heading("Models"), results);
  expect(modelsGap).toBe(await gapAbove(heading("Test"), graph));
  expect((await switcher.boundingBox())!.y).toBeLessThan(
    (await run.boundingBox())!.y,
  );
  await page.screenshot({
    path: testInfo.outputPath("sidebar-system.png"),
    animations: "disabled",
  });

  await models.click();
  await expect(page).toHaveURL(/\/custom-models$/);
  await expect(models).toHaveAttribute("aria-current", "page");
  // The row moved out from under the pointer; its highlight must not stay behind.
  await expect(primary.locator(".glide-pill")).toHaveAttribute(
    "data-visible",
    "false",
  );

  // Outside a system, the list of systems still comes before Models.
  const lastSystem = heading("Agent systems")
    .locator("xpath=..")
    .getByRole("link")
    .last();
  await expect(lastSystem).toBeVisible();
  expect((await lastSystem.boundingBox())!.y).toBeLessThan(
    (await heading("Models").boundingBox())!.y,
  );
  await page.screenshot({
    path: testInfo.outputPath("sidebar-workspace.png"),
    animations: "disabled",
  });

  // Collapsed, the section stays reachable through its row and a divider.
  await page.keyboard.press("ControlOrMeta+b");
  await expect
    .poll(() =>
      page
        .locator(".shell-sidebar")
        .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
    )
    .toBe(56);
  await models.hover();
  await expect(page.locator(".shell-tooltip")).toHaveText("Custom models");
  await page.screenshot({
    path: testInfo.outputPath("sidebar-collapsed.png"),
    animations: "disabled",
  });

  // Nor may the tooltip stay beside a row that moved.
  await page.goto(incidentRoot);
  await models.hover();
  await expect(page.locator(".shell-tooltip")).toHaveAttribute(
    "data-visible",
    "true",
  );
  await models.click();
  await expect(page).toHaveURL(/\/custom-models$/);
  await expect(page.locator(".shell-tooltip")).toHaveAttribute(
    "data-visible",
    "false",
  );
});

test("the system switcher shows every name in full", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(incidentRoot);
  const trigger = page.getByRole("button", { name: /Switch agent system/ });
  const menu = page.getByRole("menu", { name: "Agent systems" });

  // Text wider than its box is exactly what reads as cut off.
  const clippedNames = () =>
    menu.evaluate((element) =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          ".shell-switcher-heading, .shell-switcher-item > span",
        ),
      )
        .filter((name) => name.scrollWidth > name.clientWidth)
        .map((name) => name.textContent),
    );

  await trigger.click();
  await expect(menu).toBeVisible();
  // The seeded portfolio flows are grouped under a long product name.
  await expect(menu.locator(".shell-switcher-heading").first()).toBeVisible();
  expect(await clippedNames()).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("switcher-open.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Collapsing the sidebar must not take the group headings with it.
  await page.keyboard.press("ControlOrMeta+b");
  await expect
    .poll(() =>
      page
        .locator(".shell-sidebar")
        .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
    )
    .toBe(56);
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.locator(".shell-switcher-heading").first()).toHaveCSS(
    "opacity",
    "1",
  );
  expect(await clippedNames()).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("switcher-collapsed.png"),
    animations: "disabled",
  });
});

test("the landing page leads with benchmarking and its shortcut works", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Test every model and graph change" }),
  ).toBeAttached();
  await page.screenshot({
    path: testInfo.outputPath("landing-hero.png"),
    animations: "disabled",
  });
  await page.keyboard.press("b");
  await expect(page).toHaveURL(/\/systems$/);
});
