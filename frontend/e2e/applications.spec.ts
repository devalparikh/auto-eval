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
      policy: {
        schemaVersion: 2,
        metrics: {
          latency_ms: {
            semanticId: "run.latency",
            definitionVersion: 1,
            unit: "ms",
          },
        },
        checks: {
          passed: {
            semanticId: "reply.valid",
            definitionVersion: 1,
            expected: true,
          },
        },
        steps: { read_records: { attributes: { rows: { type: "integer" } } } },
        outcomes: {
          proposal_decision: {
            attributes: {
              decision: { type: "string", enum: ["applied", "dismissed"] },
            },
          },
        },
        content: {
          conversation: {
            category: "conversation",
            valueSchema: { type: "string" },
          },
        },
      },
      experiment: {
        revision: { kind: "git-sha1", value: "a".repeat(40) },
        promptHash: "b".repeat(64),
        configHash: "c".repeat(64),
        graphHash: null,
        models: [
          { role: "trainer", provider: "mock", model: "synthetic/mock" },
        ],
        mode: "observed",
      },
    },
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
          categories: ["conversation"],
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
          steps: [
            {
              id: "read_1",
              kind: "tool",
              name: "read_records",
              status: "ok",
              attributes: { rows: 3 },
            },
          ],
          content: { conversation: "Synthetic trainer evidence" },
          redactorVersion: "d".repeat(64),
        },
      })
    ).status(),
  ).toBe(201);
  const event = await request.post(`${api}/v2/outcomes`, {
    headers: { authorization: `Bearer ${ingest}` },
    data: {
      schemaVersion: 2,
      id: randomUUID(),
      traceId: id,
      policyVersion,
      occurredAt: now + 1,
      name: "proposal_decision",
      attributes: { decision: "applied" },
    },
  });
  expect(event.status()).toBe(201);
  const grade = await request.post(`${api}/v2/traces/${id}/grades`, {
    headers: { authorization: `Bearer ${ingest}` },
    data: { value: false },
  });
  expect(grade.status()).toBe(201);
  await page.goto("/applications");
  await page
    .getByRole("combobox", { name: "Application", exact: true })
    .selectOption(app);
  await expect(page.getByRole("cell", { name: id, exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "synthetic", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fail", exact: true }).click();
  await expect(page.getByText("Grade history (1)")).toBeVisible();
  await expect(page.getByText("read_records", { exact: true })).toBeVisible();
  await expect(
    page.getByText("proposal_decision", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load diagnostic content", exact: true })
    .click();
  await expect(page.getByText(/Synthetic trainer evidence/)).toBeVisible();
  await page
    .getByRole("button", { name: "Save assessment", exact: true })
    .click();
  await expect(
    page.getByText("Assessment saved as an immutable review."),
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

test("creation asks only for name and key lifespan; settings are edited afterward", async ({
  page,
  request,
}) => {
  await page.goto("/applications");
  await page.getByText("Register application", { exact: true }).first().click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Portal synthetic " + randomUUID());
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("Custom key lifespan in days").fill("14");
  await expect(page.getByLabel("Allow production capture")).toHaveCount(0);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  // The key replaces the registration form rather than appearing beside it.
  await expect(page.getByText("New key, shown once")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Register application" })).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide key", exact: true }).click();
  await page.getByRole("link", { name: "App settings", exact: true }).click();
  await expect(page.getByLabel("Allow production capture")).toBeChecked();
  await expect(page.getByLabel("All evidence retention")).toHaveValue("keep");
  await expect(page.getByText("None declared yet.")).toBeVisible();
  await page.getByLabel("Allow production capture").uncheck();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByText("Settings saved.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Allow production capture")).not.toBeChecked();
  const id = new URL(page.url()).pathname.split("/")[2];
  const apps = await request.get(`${api}/api/applications`);
  expect(
    (await apps.json()).find((item: { id: string }) => item.id === id).settings
      .retention_days,
  ).toBeNull();
});
