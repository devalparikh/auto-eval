import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const api = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}`;
test("synthetic application feed reaches dashboard and consent withdrawal removes it", async ({
  page,
  request,
}) => {
  const app = randomUUID(),
    experiment = randomUUID(),
    grant = randomUUID();
  const created = await request.post(`${api}/api/applications`, {
    data: {
      id: app,
      name: `Synthetic ${app}`,
      environment: "preview",
      policy: { metrics: ["latency_ms"], checks: ["passed"] },
      retention_days: 1,
    },
  });
  expect(created.status()).toBe(201);
  const issue = async (scope: string) => {
    const response = await request.post(`${api}/api/applications/${app}/keys`, {
      data: { scope },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).token as string;
  };
  const ingest = await issue("traces:write"),
    consent = await issue("grants:write");
  expect(
    (
      await request.post(`${api}/api/applications/${app}/experiments`, {
        data: {
          id: experiment,
          revision: "a".repeat(40),
          promptHash: "b".repeat(64),
          configHash: "c".repeat(64),
          graphHash: null,
          model: "synthetic/mock",
          mode: "observed",
          datasetHash: null,
        },
      })
    ).status(),
  ).toBe(201);
  const now = Date.now();
  expect(
    (
      await request.post(`${api}/v1/grants`, {
        headers: { authorization: `Bearer ${consent}` },
        data: {
          id: grant,
          source: "synthetic",
          policy: "metadata-v1",
          expiresAt: now + 600000,
        },
      })
    ).status(),
  ).toBe(201);
  const id = randomUUID();
  expect(
    (
      await request.post(`${api}/v1/traces`, {
        headers: { authorization: `Bearer ${ingest}` },
        data: {
          schemaVersion: 1,
          id,
          experimentId: experiment,
          grantId: grant,
          source: "synthetic",
          policy: "metadata-v1",
          caseId: null,
          startedAt: now,
          endedAt: now + 1,
          status: "ok",
          metrics: { latency_ms: 1 },
          checks: { passed: true },
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/applications");
  await page
    .getByRole("combobox", { name: "Application", exact: true })
    .selectOption(app);
  await expect(page.getByRole("cell", { name: id, exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "synthetic", exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.delete(`${api}/v1/grants/${grant}`, {
        headers: { authorization: `Bearer ${consent}` },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("cell", { name: id, exact: true })).toHaveCount(
    0,
  );
});
