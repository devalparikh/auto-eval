import { expect, test } from "@playwright/test";

const api = `http://localhost:${process.env.AUTOEVAL_E2E_API_PORT ?? "8011"}/api`;

test("connects a harness, reviews native conversations, and compares complete task runs", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  const key = `coding-${Date.now()}`;
  await page.goto("/import");
  await page.getByRole("link", { name: "Connect a coding harness" }).click();
  await page.getByLabel("Harness", { exact: true }).selectOption("pi");
  await page.getByLabel("System name").fill("My coding agent");
  await page.getByLabel("System key").fill(key);
  await page
    .getByRole("button", { name: "Connect harness", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My coding agent" }),
  ).toBeVisible();
  await expect(
    page.getByText('"openai-completions"', { exact: false }),
  ).toBeVisible();
  for (const [task, partition] of [
    ["training", "train"],
    ["validation", "validation"],
    ["holdout", "benchmark"],
  ]) {
    await page.getByLabel("Task key").fill(task);
    await page.getByLabel("Use for").selectOption(partition);
    await page.getByLabel("Task prompt").fill(`Fix ${task}`);
    if (partition === "benchmark")
      await page.getByLabel("Repository commit").fill("a".repeat(40));
    await page.getByRole("button", { name: "Save task" }).click();
    await expect(page.getByRole("status")).toContainText("Task saved");
    if (partition !== "benchmark") {
      const response = await request.post(`${api}/harnesses/${key}/captures`, {
        data: {
          request_id: task,
          session_id: task,
          task_key: task,
          harness_revision: "pi@fixture",
          configuration_hash: "b".repeat(64),
          model: "fixture-model",
          protocol: "chat",
          latency_ms: 42,
          request: { messages: [{ role: "user", content: `Fix ${task}` }] },
          response: {
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: "Fixed and tested." },
              },
            ],
          },
        },
      });
      expect(response.status()).toBe(201);
    }
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Sessions & training", exact: true })
    .click();
  for (const task of ["training", "validation"]) {
    await page.getByRole("button", { name: task, exact: true }).click();
    await page.getByRole("button", { name: "Approve for training" }).click();
    await expect(page.getByRole("status")).toContainText("Capture approved");
  }
  await page.getByRole("button", { name: "Create training dataset" }).click();
  await expect(
    page.getByText("1 training examples · 1 validation examples"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create custom model" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Benchmark", exact: true }).click();
  await page
    .getByRole("button", { name: "Freeze all benchmark tasks" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Compare candidates" }),
  ).toBeVisible();
  const workspace = await (await request.get(`${api}/harnesses/${key}`)).json();
  for (const [label, exit] of [
    ["Baseline", 1],
    ["Candidate", 0],
  ] as const) {
    const result = await request.post(`${api}/harnesses/${key}/runs`, {
      data: {
        request_id: label,
        suite_id: workspace.suites[0].id,
        label,
        model: label,
        harness_revision: "pi@fixture",
        configuration_hash: "b".repeat(64),
        results: [
          {
            task_key: "holdout",
            repetition: 1,
            status: "completed",
            test_exit_code: exit,
            test_output_hash: "c".repeat(64),
            latency_ms: 100,
          },
        ],
      },
    });
    expect(result.status()).toBe(201);
  }
  await page.getByRole("button", { name: "Refresh results" }).click();
  await expect(page.getByText("100.0 pp", { exact: true })).toBeVisible();
  for (const width of [1280, 390]) {
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
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("harness-benchmark.png"),
    fullPage: true,
  });
});
