import { expect, test } from "@playwright/test";
import type { Catalog, DatasetVersionDetail } from "../src/lib/types";

const apiUrl = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}/api`;

test("review a draft, reject stale changes, then finalize and benchmark", async ({ page, request }, testInfo) => {
  const catalog = await (await request.get(`${apiUrl}/catalog`)).json() as Catalog;
  const system = catalog.agent_systems.find((system) => system.key === "incident-triage")!;
  const dataset = catalog.datasets.find((dataset) => dataset.agent_system_id === system.id)!;
  const source = dataset.versions.find((version) => version.status === "final")!;
  const created = await request.post(`${apiUrl}/datasets/${dataset.id}/versions`, {
    data: { clone_from_version_id: source.id },
  });
  expect(created.ok()).toBeTruthy();
  const draft = await created.json() as DatasetVersionDetail;

  await page.goto("/systems/incident-triage/evaluations");
  await page.getByLabel("Dataset version").selectOption(draft.id);
  const start = page.getByRole("button", { name: "Finalize & run benchmark" });
  await expect(start).toBeEnabled();
  await expect(page.getByText(`Starting this benchmark will permanently finalize v${draft.version}`, { exact: false })).toBeVisible();

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: testInfo.outputPath(`draft-${theme}.png`), fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(start).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("draft-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });

  const item = draft.items[0];
  const edit = await request.put(`${apiUrl}/dataset-items/${item.id}`, {
    data: { expected: { ...item.expected, severity: "low" } },
  });
  expect(edit.ok()).toBeTruthy();
  // Ensure the expected answer actually differs, regardless of seeded ordering.
  if (item.expected.severity === "low") {
    await request.put(`${apiUrl}/dataset-items/${item.id}`, {
      data: { expected: { ...item.expected, severity: "critical" } },
    });
  }
  await start.click();
  await expect(page.locator("form").getByRole("alert")).toContainText("changed since you loaded it");
  expect((await (await request.get(`${apiUrl}/dataset-versions/${draft.id}`)).json()).status).toBe("draft");
  expect(await (await request.get(`${apiUrl}/eval-runs?dataset_version_id=${draft.id}`)).json()).toHaveLength(0);

  await page.getByRole("button", { name: "Refresh dataset" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await page.getByText("Review dataset examples", { exact: true }).click();
  await start.click();
  await expect(page.getByRole("link", { name: "View results" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Run benchmark", exact: true })).toBeEnabled();
  expect((await (await request.get(`${apiUrl}/dataset-versions/${draft.id}`)).json()).status).toBe("final");
  const runs = await (await request.get(`${apiUrl}/eval-runs?dataset_version_id=${draft.id}`)).json();
  expect(runs).toHaveLength(1);
  expect(runs[0].dataset_version_id).toBe(draft.id);
});
