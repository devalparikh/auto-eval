import { expect, test } from "@playwright/test";
import { starterManifest } from "../src/features/systems/import-starter";

test("imports a manifest, edits an immutable graph version, and imports a prompt revision", async ({
  page,
}, testInfo) => {
  const manifest = structuredClone(starterManifest);
  manifest.system.key = `support-summary-${Date.now()}`;
  await page.goto("/systems");
  await page.getByRole("link", { name: "Import system", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where does your agent live?" }),
  ).toBeVisible();
  await page
    .getByLabel("Manifest file")
    .setInputFiles({
      name: "autoeval.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest)),
    });
  await expect(page.getByLabel("Agent graph structure")).toBeVisible();
  await expect(page.getByText("New graph", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("import-review.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Import system", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Support summary is ready" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open graph editor" }).click();
  await page.getByRole("button", { name: "Edit graph", exact: true }).click();
  await expect(page.getByLabel("Editable agent graph")).toBeVisible();
  await page.getByLabel("Edit node", { exact: true }).selectOption("summarize");
  await page.getByLabel("Label", { exact: true }).fill("Summarize the request");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(
    page.getByLabel("graph version", { exact: true }).locator("option:checked"),
  ).toHaveText("Version 2");
  await page.getByRole("button", { name: "Edit graph", exact: true }).click();
  await page.getByLabel("Edit node", { exact: true }).selectOption("summarize");
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue(
    "Summarize the request",
  );
  await page.screenshot({
    path: testInfo.outputPath("graph-editor.png"),
    fullPage: true,
  });
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  }
  await page
    .getByLabel("graph version", { exact: true })
    .selectOption({ label: "Version 1" });
  await page.getByRole("button", { name: "Edit graph", exact: true }).click();
  await page.getByLabel("Edit node", { exact: true }).selectOption("summarize");
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue(
    "Summarize request",
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Import version", exact: true }).click();
  manifest.prompt.content += " Keep each field concise.";
  await page
    .getByLabel("Manifest file")
    .setInputFiles({
      name: "autoeval.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest)),
    });
  await expect(page.getByText("Reused graph", { exact: true })).toBeVisible();
  const committed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/system-imports/commit") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Import version", exact: true })
    .click();
  const imported = await (await committed).json();
  await expect(
    page.getByRole("heading", { name: "Support summary is ready" }),
  ).toBeVisible();
  const runHref = await page
    .getByRole("link", { name: "Run this agent" })
    .getAttribute("href");
  expect(runHref).toContain(`graphVersion=${imported.graph_version_id}`);
  expect(runHref).toContain(`promptVersion=${imported.prompt_version_id}`);
  await page.getByRole("link", { name: "Open graph editor" }).click();
  await expect(
    page.getByLabel("graph version", { exact: true }).locator("option:checked"),
  ).toHaveText("Version 1");
  await page.goto(runHref!);
  await expect(
    page.getByLabel("Graph version", { exact: true }).locator("option:checked"),
  ).toHaveText("Support summary v1");
  const executed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/traces/run") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run inference", exact: true })
    .click();
  const trace = await (await executed).json();
  expect(trace.agent_system_version_id).toBe(imported.graph_version_id);
  expect(trace.prompt_version_id).toBe(imported.prompt_version_id);
  await expect(
    page.getByRole("link", { name: "Inspect full trace" }),
  ).toBeVisible();
});

test("import guide works in both themes, on mobile, and with reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/guide");
  await page.getByRole("button", { name: /Map the behavior/ }).click();
  await expect(
    page.getByRole("region", { name: "Map the behavior" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("guide-dark.png"),
    fullPage: true,
  });
  const light = page.getByRole("button", { name: "Use light theme" });
  if (await light.count()) await light.click();
  await page.screenshot({
    path: testInfo.outputPath("guide-light.png"),
    fullPage: true,
  });
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: testInfo.outputPath("guide-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Review and import/ }).click();
  await expect(
    page.getByRole("region", { name: "Review and import" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download starter" }).click();
  expect((await download).suggestedFilename()).toBe("autoeval.json");
});
