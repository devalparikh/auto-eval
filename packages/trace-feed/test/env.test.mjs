import assert from "node:assert/strict";
import { test } from "node:test";
import { createCaptureFromEnv } from "../src/index.js";
const policy = { metrics: [], checks: [] };
test("env capture is explicitly enabled, validated, and has no import-time capture", async () => {
  assert.deepEqual(await createCaptureFromEnv({ env: {} }).capture({}), {
    status: "disabled",
  });
  assert.throws(() =>
    createCaptureFromEnv({ env: { AUTOEVAL_ENABLED: "true" }, policy }),
  );
  const env = {
    AUTOEVAL_ENABLED: "true",
    AUTOEVAL_ENDPOINT: "https://example.invalid/api/backend/v1/traces",
    AUTOEVAL_INGEST_KEY: "ae_" + "a".repeat(40),
    AUTOEVAL_EXPERIMENT_ID: "12345678-1234-4234-8234-123456789012",
    AUTOEVAL_SOURCE: "synthetic",
  };
  const capture = createCaptureFromEnv({ env, policy });
  assert.deepEqual(await capture.capture({ consent: null }), {
    status: "no-consent",
  });
  assert.throws(() =>
    createCaptureFromEnv({
      env: { ...env, AUTOEVAL_ENDPOINT: "http://example.invalid/v1/traces" },
      policy,
    }),
  );
  assert.throws(() =>
    createCaptureFromEnv({
      env: { ...env, AUTOEVAL_REQUEST_TIMEOUT_MS: "NaN" },
      policy,
    }),
  );
});

test("environment initialization sanitizes malformed endpoints and getters", () => {
  const marker = "synthetic-credential-must-not-leak";
  for (const options of [
    { policy, env: { AUTOEVAL_ENABLED: "true", AUTOEVAL_ENDPOINT: marker } },
    { get env() { throw new Error(marker); } },
    { env: { get AUTOEVAL_ENABLED() { throw new Error(marker); } } },
    null,
  ]) {
    assert.throws(() => createCaptureFromEnv(options), error => {
      assert.equal(error.message, "Invalid feed contract");
      assert.deepEqual(Object.keys(error), []);
      assert.equal(error.cause, undefined);
      assert.equal(error.input, undefined);
      assert.equal(String(error.stack).includes(marker), false);
      return true;
    });
  }
});
