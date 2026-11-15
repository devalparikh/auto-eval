import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const api = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}`;
test("synthetic application feed reaches dashboard and consent withdrawal removes it", async ({
  page,
  request,
}) => {
  const app = randomUUID(),
    grant = randomUUID();
  const created = await request.post(`${api}/api/applications`, {
    data: {
      id: app,
      name: `Synthetic ${app}`,
    },
  });
  expect(created.status()).toBe(201);
  const issue = async () => {
    const response = await request.post(`${api}/api/applications/${app}/keys`, {
      data: { expiresAt: Date.now() + 86400000 },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).token as string;
  };
  const ingest = await issue();
  const consent = ingest;
  const connection = await request.post(`${api}/v2/connect`, {
    headers: { authorization: `Bearer ${ingest}` },
    data: {
      policy: { schemaVersion: 2,
        metrics: { latency_ms: { semanticId: "run.latency", definitionVersion: 1, unit: "ms" } },
        checks: { passed: { semanticId: "reply.valid", definitionVersion: 1, expected: true } } },
      experiment: { revision: { kind: "git-sha1", value: "a".repeat(40) },
        promptHash: "b".repeat(64), configHash: "c".repeat(64), graphHash: null,
        models: [{ role: "trainer", provider: "mock", model: "synthetic/mock" }], mode: "observed" }
    }
  });
  expect(connection.status()).toBe(200);
  const { experimentId, policyVersion } = await connection.json();
  const now = Date.now();
  expect(
    (
      await request.post(`${api}/v2/grants`, {
        headers: { authorization: `Bearer ${consent}` },
        data: {
          id: grant,
          source: "synthetic",
          expiresAt: now + 600000,
        },
      })
    ).status(),
  ).toBe(201);
  const id = randomUUID();
  expect(
    (
      await request.post(`${api}/v2/traces`, {
        headers: { authorization: `Bearer ${ingest}` },
        data: {
          schemaVersion: 2,
          id,
          experimentId,
          policyVersion,
          grantId: grant,
          source: "synthetic",
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
      await request.delete(`${api}/v2/grants/${grant}`, {
        headers: { authorization: `Bearer ${consent}` },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("cell", { name: id, exact: true })).toHaveCount(
    0,
  );
});
