import { expect, test, type Page } from "@playwright/test";

const unavailableRuntime = {
  executor: "local_mlx",
  available: false,
  reason: "Local training is not set up on this machine.",
  setup_command: ".venv/bin/python -m pip install -e 'backend[training]'",
  base_models: [
    {
      id: "mlx-community/Qwen2.5-0.5B-Instruct-4bit",
      label: "Qwen 0.5B",
      description: "Small base model for local fine-tuning.",
    },
  ],
};

/** The runtime is mocked as unavailable so no test can launch a training job. */
async function mockUnavailableRuntime(page: Page) {
  await page.route("**/api/custom-models/runtime", (route) =>
    route.fulfill({ json: unavailableRuntime }),
  );
}

test("creates, previews, renames, archives, and restores a custom model", async ({
  page,
}, testInfo) => {
  await mockUnavailableRuntime(page);
  const name = `triage-ft-${Date.now()}`;

  await page.goto("/systems");
  await page.getByRole("link", { name: "Custom models" }).click();
  await expect(
    page.getByRole("heading", { name: "Custom models" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New custom model" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Model name").fill(name);
  await dialog.getByRole("button", { name: "Review training data" }).click();
  await expect(dialog.getByRole("button", { name: "Create model" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Create model" }).scrollIntoViewIfNeeded();
  await dialog.screenshot({
    path: testInfo.outputPath("custom-models-preview.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Create model" }).click();
  await expect(dialog).not.toBeVisible();

  await expect(page.getByRole("button", { name: /Start fine-tuning/ })).toBeDisabled();

  const renamed = `${name}-renamed`;
  await page.getByLabel("Display name").fill(renamed);
  await page.getByRole("button", { name: "Rename" }).click();
  const rail = page.getByRole("navigation", { name: "Custom models" });
  await expect(rail.getByText(renamed)).toBeVisible();

  await page.getByRole("button", { name: "Archive model" }).click();
  await expect(rail.getByText(renamed)).not.toBeVisible();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(rail.getByText(renamed)).toBeVisible();

  await page.getByRole("button", { name: "Restore model" }).click();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await expect(rail.getByText(renamed)).toBeVisible();
  await page.reload();
  await expect(rail.getByText(renamed)).toBeVisible();
});

test("custom models read in both themes and on mobile", async ({
  page,
}, testInfo) => {
  await mockUnavailableRuntime(page);
  await page.goto("/custom-models");
  await expect(
    page.getByRole("heading", { name: "Custom models" }),
  ).toBeVisible();
  await expect(page.getByText("Set up local training")).toBeVisible();
  await page.getByRole("button", { name: "New custom model" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Model name").fill("Triage local model");
  await dialog.getByRole("button", { name: "Review training data" }).click();
  await dialog.getByRole("button", { name: "Create model" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("Triage local model");
  await page.evaluate(() => document.fonts.ready);

  await page.screenshot({
    path: testInfo.outputPath("custom-models-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  const light = page.getByRole("button", { name: "Use light theme" });
  if (await light.count()) await light.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: testInfo.outputPath("custom-models-light.png"),
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
  await expect(page.locator(".shell-scrim")).toHaveCSS("opacity", "0");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("custom-models-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("base model tags and guidance support keyboard, hover, and touch", async ({ page }, testInfo) => {
  await mockUnavailableRuntime(page);
  await page.goto("/custom-models");
  await page.getByRole("button", { name: "New custom model" }).click();
  const dialog = page.getByRole("dialog");
  const info = dialog.getByRole("button", { name: "Base model requirements" });
  const tooltip = dialog.getByRole("tooltip");
  await expect(dialog.getByLabel("Training runtime")).toHaveText("MLX · local");
  await expect(tooltip).toBeHidden();
  await info.focus();
  await expect(tooltip).toContainText("Weights download on first training");
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Base model", { exact: true })).toBeFocused();

  await info.hover();
  await expect(tooltip).toBeVisible();
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await dialog.getByLabel("Model name").hover();
  await expect(tooltip).toBeHidden();
  await dialog.getByLabel("Base model", { exact: true }).selectOption("custom");
  await expect(dialog.getByText("No model selected", { exact: true })).toBeVisible();
  await dialog.getByLabel("Hugging Face model ID").fill("organization/custom-model");
  await expect(dialog.getByText("Compatibility unchecked", { exact: true })).toBeVisible();

  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await info.click();
    await expect(tooltip).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath(`base-model-info-${theme}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
  }

  await page.setViewportSize({ width: 390, height: 900 });
  await info.click();
  await expect(tooltip).toBeVisible();
  const bounds = await tooltip.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog.screenshot({ path: testInfo.outputPath("base-model-info-mobile.png"), animations: "disabled" });
  // Dismiss from an uncovered field, as a user would on a narrow screen.
  await dialog.getByLabel("Model name").click();
  await expect(tooltip).toBeHidden();
  await dialog.getByLabel("Base model", { exact: true }).selectOption(unavailableRuntime.base_models[0].id);
  await expect(dialog.getByText("Compatibility unchecked", { exact: true })).toBeHidden();
});
