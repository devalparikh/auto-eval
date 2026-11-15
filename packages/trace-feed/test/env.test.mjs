import test from "node:test";
import assert from "node:assert/strict";
import { createCapture, createCaptureFromEnv } from "../src/index.js";

test("invalid or absent configuration is inert and never throws, including getters", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("no network"));
  for (const initialize of [
    () => createCapture(),
    () => createCapture({ enabled: true }),
    () => createCaptureFromEnv({ env: {} }),
    () => createCaptureFromEnv({ env: { AUTOEVAL_ENABLED: "true" } }),
    () =>
      createCaptureFromEnv({
        get env() {
          throw new Error("secret");
        },
      }),
  ]) {
    const sdk = initialize();
    assert.equal(sdk.enabled, false);
    assert.equal((await sdk.begin().end()).status, "skipped");
    assert.ok(!JSON.stringify(sdk).includes("secret"));
  }
});
test("legacy env consent lists and grants/experiment IDs do not enable capture", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("no network"));
  const sdk = createCaptureFromEnv({
    env: {
      AUTOEVAL_CONSENTED_USER_IDS: "some-user",
      AUTOEVAL_GRANTS_KEY: "secret",
      AUTOEVAL_EXPERIMENT_ID: "legacy",
    },
  });
  assert.equal(sdk.enabled, false);
  assert.equal(sdk.begin().reference, null);
});
