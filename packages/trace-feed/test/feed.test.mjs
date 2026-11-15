import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createCapture, artifactHash } from "../src/index.js";

const TOKEN = "ae_" + "synthetic".repeat(5);
const canon = (value) =>
  Array.isArray(value)
    ? "[" + value.map(canon).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canon(value[key]))
          .join(",") +
        "}"
      : JSON.stringify(value);
const fingerprint = (kind, value) =>
  createHash("sha256")
    .update("autoeval:v2:" + kind + ":" + canon(value))
    .digest("hex");
const policy = () => ({
  schemaVersion: 2,
  metrics: {
    latency_ms: {
      semanticId: "run.latency",
      definitionVersion: 1,
      unit: "ms",
      min: 0,
    },
    cost_usd: {
      semanticId: "run.cost",
      definitionVersion: 1,
      unit: "usd",
      min: 0,
    },
  },
  checks: {
    valid: { semanticId: "reply.valid", definitionVersion: 1, expected: true },
  },
  steps: { read_records: { attributes: { rows: { type: "integer" } } } },
  outcomes: {
    proposal_decision: {
      attributes: {
        decision: { type: "string", enum: ["applied", "dismissed", "stale"] },
      },
    },
  },
  content: {
    message: {
      category: "conversation",
      valueSchema: { type: "string", maxLength: 16000 },
    },
    scan: {
      category: "body_scans",
      valueSchema: { type: "object", properties: { mass: { type: "number" } } },
    },
  },
});
const experiment = () => ({
  revision: { kind: "git-sha1", value: "a".repeat(40) },
  promptHash: "b".repeat(64),
  configHash: "c".repeat(64),
  graphHash: null,
  models: [{ role: "trainer", provider: "mock", model: "synthetic/mock" }],
});
const options = () => ({
  enabled: true,
  endpoint: "https://example.invalid/api/backend/v2/traces",
  token: TOKEN,
  source: "production",
  policy: policy(),
  experiment: experiment(),
  redactorVersion: "d".repeat(64),
});
const consent = () => ({
  granted: true,
  id: randomUUID(),
  categories: ["conversation", "body_scans"],
});
function receiver(t, override) {
  const calls = [],
    policies = new Map();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ url, init, body });
    if (override) {
      const response = await override(url, init, body);
      if (response) return response;
    }
    const path = new URL(url).pathname.split("/v2/")[1];
    if (path === "connect") {
      const policyVersion = fingerprint("policy", body.policy);
      policies.set(policyVersion, body.policy);
      return Response.json({
        applicationId: "00000000-0000-4000-8000-000000000001",
        policyVersion,
        experimentId: fingerprint("experiment", {
          ...body.experiment,
          policyVersion,
          source: body.source,
        }),
        settings: {
          production_enabled: true,
          retention_days: null,
          content_retention_days: null,
          content_categories: ["conversation"],
        },
      });
    }
    if (path.startsWith("policies/"))
      return Response.json(policies.get(path.split("/")[1]));
    if (path === "grants")
      return Response.json({ id: body.id, scopeVersion: "f".repeat(64) });
    if (init.method === "DELETE") return Response.json({ revoked: true });
    return Response.json({ id: body.id, coverage: body.coverage ?? {} });
  });
  return { calls, policies };
}

test("begin and steps are local; cold end registers once with shared deadline and warm cache", async (t) => {
  const { calls } = receiver(t),
    sdk = createCapture(options()),
    grant = consent();
  assert.equal(sdk.enabled, true);
  const run = sdk.begin({ consent: grant });
  assert.ok(run.reference?.traceId);
  assert.equal(
    run.step({
      id: "read_1",
      kind: "tool",
      name: "read_records",
      status: "ok",
      attributes: { rows: 2 },
    }),
    true,
  );
  assert.equal(calls.length, 0);
  const response = await run.end({
    metrics: { latency_ms: 10, cost_usd: null },
    checks: { valid: true },
  });
  assert.equal(response.status, "accepted");
  assert.deepEqual(
    calls.map((call) => call.url.split("/").at(-1)),
    ["connect", "grants", "traces"],
  );
  assert.equal(new Set(calls.map((call) => call.init.signal)).size, 1);
  assert.equal(calls.at(-1).body.metrics.cost_usd, null);
  assert.equal(calls.at(-1).body.coverage["metrics.cost_usd"], "not_measured");
  assert.equal((await run.end()).reason, "already_ended");
  assert.equal((await sdk.begin({ consent: grant }).end()).status, "accepted");
  assert.equal(calls.length, 4);
});

test("no, false and expired consent collect nothing, run no projection and send no HTTP", async (t) => {
  const { calls } = receiver(t),
    sdk = createCapture(options());
  for (const grant of [
    undefined,
    null,
    { ...consent(), granted: false },
    { ...consent(), expiresAt: Date.now() - 1 },
    { granted: true, id: "raw-user-id" },
  ]) {
    const run = sdk.begin({ consent: grant });
    assert.equal(run.reference, null);
    assert.equal(
      run.step({
        id: "read_1",
        kind: "tool",
        name: "read_records",
        status: "ok",
        attributes: { rows: 2 },
      }),
      false,
    );
    assert.equal(
      (await run.end({ content: () => assert.fail("must not project") }))
        .reason,
      "no_consent",
    );
  }
  assert.equal(calls.length, 0);
});

test("withdrawal stops in-flight local capture and future captures even when remote deletion fails", async (t) => {
  const { calls } = receiver(t, async (url, init) =>
    init.method === "DELETE" ? new Response("", { status: 503 }) : null,
  );
  const sdk = createCapture(options()),
    grant = consent(),
    run = sdk.begin({ consent: grant });
  assert.equal((await sdk.withdraw({ grantId: grant.id })).status, "skipped");
  assert.equal(
    (await run.end({ content: () => assert.fail("must not project") })).reason,
    "no_consent",
  );
  assert.equal(sdk.begin({ consent: grant }).reference, null);
  assert.equal(calls.length, 1);
});

test("content needs policy, admin permission, consent and app redactor version; identifiers stripped before fetch", async (t) => {
  const { calls } = receiver(t),
    sdk = createCapture(options());
  const response = await sdk.begin({ consent: consent() }).end({
    content: {
      message:
        "Synthetic person@example.invalid; 00000000-0000-4000-8000-000000000002",
      scan: { mass: 70 },
    },
  });
  assert.equal(response.status, "accepted");
  assert.equal(
    calls.at(-1).body.content.message,
    "Synthetic [redacted]; [redacted]",
  );
  assert.equal(calls.at(-1).body.content.scan, undefined);
  assert.equal(calls.at(-1).body.coverage["content.scan"], "not_authorized");
  const noCategories = { ...consent(), categories: [] };
  await sdk
    .begin({ consent: noCategories })
    .end({ content: { message: "Synthetic content" } });
  assert.deepEqual(calls.at(-1).body.content, {});
  await createCapture({ ...options(), redactorVersion: null })
    .begin({ consent: consent() })
    .end({ content: { message: "Synthetic content" } });
  assert.equal(
    calls.at(-1).body.coverage["content.message"],
    "redaction_failed",
  );
});

test("invalid optional values remain unknown and invalid content does not swallow valid checks", async (t) => {
  const { calls } = receiver(t),
    sdk = createCapture(options());
  const response = await sdk.begin({ consent: consent() }).end({
    metrics: { latency_ms: NaN },
    checks: { valid: true },
    content: { message: "\ud800" },
  });
  assert.equal(response.status, "accepted");
  const body = calls.at(-1).body;
  assert.equal(body.metrics.latency_ms, null);
  assert.equal(body.checks.valid, true);
  assert.equal(body.coverage["metrics.latency_ms"], "invalid_value");
  assert.equal(body.coverage["content.message"], "invalid_value");
});

test("slow or abort-ignoring transports settle within a single capture budget and never retry", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise(() => {});
  });
  const sdk = createCapture({ ...options(), timeoutMs: 40 });
  const start = performance.now();
  assert.equal(
    (await sdk.begin({ consent: consent() }).end()).reason,
    "timeout",
  );
  assert.ok(performance.now() - start < 300);
  assert.equal(calls, 1);
});

test("expired/revoked credentials are not retried; new instance/key starts cleanly", async (t) => {
  const { calls } = receiver(t, async () => new Response("", { status: 401 }));
  const sdk = createCapture(options());
  assert.equal(
    (await sdk.begin({ consent: consent() }).end()).reason,
    "unauthorized",
  );
  assert.equal(sdk.begin({ consent: consent() }).reference, null);
  assert.equal(calls.length, 1);
  assert.ok(createCapture(options()).begin({ consent: consent() }).reference);
});

test("policy and prompt evolution change IDs; old outcomes resolve their original declaration", async (t) => {
  const { calls } = receiver(t),
    grant = consent(),
    v1 = createCapture(options()),
    first = v1.begin({ consent: grant });
  await first.end();
  const settings = options();
  settings.experiment.promptHash = "e".repeat(64);
  settings.policy.outcomes = { next_event: { attributes: {} } };
  const v2 = createCapture(settings),
    second = v2.begin({ consent: grant });
  assert.notEqual(
    second.reference.policyVersion,
    first.reference.policyVersion,
  );
  assert.notEqual(second.reference.experimentId, first.reference.experimentId);
  const outcome = await v2.outcome({
    consent: grant,
    reference: first.reference,
    name: "proposal_decision",
    attributes: { decision: "applied" },
  });
  assert.equal(outcome.status, "accepted");
  assert.ok(calls.at(-2).url.includes("/policies/"));
  assert.equal(calls.at(-1).body.policyVersion, first.reference.policyVersion);
  assert.equal(calls.at(-1).body.traceId, first.reference.traceId);
});

test("prototype/getter, arbitrary operational text, oversized steps and source mistakes fail closed", async (t) => {
  const { calls } = receiver(t),
    invalid = options();
  invalid.policy.steps.read_records.attributes.secret = { type: "string" };
  assert.equal(createCapture(invalid).enabled, false);
  const sdk = createCapture(options()),
    run = sdk.begin({ consent: consent() });
  assert.equal(
    run.step({
      id: "read_1",
      kind: "tool",
      name: "read_records",
      status: "ok",
      attributes: { rows: 2, raw: "secret" },
    }),
    false,
  );
  assert.equal(
    run.step({
      id: "read_2",
      parentId: "missing",
      kind: "tool",
      name: "read_records",
      status: "ok",
      attributes: { rows: 2 },
    }),
    false,
  );
  const result = await run.end({
    metrics: {
      get latency_ms() {
        throw new Error("private");
      },
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(calls.length, 0);
  assert.equal(
    createCapture({
      ...options(),
      endpoint: "http://example.invalid/v2/traces",
    }).enabled,
    false,
  );
  assert.equal(
    createCapture({
      ...options(),
      source: "synthetic",
      endpoint: "http://127.0.0.1:8011/v2/traces",
    }).enabled,
    true,
  );
  assert.equal(
    artifactHash("synthetic"),
    createHash("sha256").update("synthetic").digest("hex"),
  );
});

test("response errors, redirect bodies and thrown exceptions never escape or expose credentials", async (t) => {
  const { calls } = receiver(
    t,
    async () => new Response("server private detail", { status: 500 }),
  );
  const response = await createCapture(options())
    .begin({ consent: consent() })
    .end();
  assert.deepEqual(response, { status: "skipped", reason: "rejected" });
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.headers.authorization, "Bearer " + TOKEN);
  assert.ok(!JSON.stringify(response).includes(TOKEN));
});

test("explosive shared arrays are bounded before copying or redacting content", async (t) => {
  const { calls } = receiver(t),
    settings = options();
  let schema = { type: "number" },
    value = 1;
  for (let i = 0; i < 4; i++) {
    schema = { type: "array", maxItems: 128, items: schema };
    value = Array(128).fill(value);
  }
  settings.policy.content.message.valueSchema = schema;
  const start = performance.now();
  const response = await createCapture(settings)
    .begin({ consent: consent() })
    .end({ content: { message: value }, checks: { valid: true } });
  assert.ok(performance.now() - start < 500);
  assert.equal(response.status, "accepted");
  assert.equal(calls.at(-1).body.coverage["content.message"], "invalid_value");
  assert.equal(calls.at(-1).body.checks.valid, true);
});
test("invalid withdrawal inputs are nonthrowing and unconsented categories run no projector", async (t) => {
  const { calls } = receiver(t),
    sdk = createCapture(options());
  assert.deepEqual(await sdk.withdraw(null), {
    status: "skipped",
    reason: "invalid_input",
  });
  assert.deepEqual(
    await sdk.withdraw({
      get grantId() {
        throw new Error("private detail");
      },
    }),
    { status: "skipped", reason: "invalid_input" },
  );
  await sdk
    .begin({ consent: { ...consent(), categories: [] } })
    .end({ content: () => assert.fail("no permitted category") });
  assert.deepEqual(calls.at(-1).body.content, {});
});

test("large valid step sets preserve the summary and explicitly count omitted steps", async (t) => {
  const { calls } = receiver(t),
    settings = options();
  const names = Array.from(
    { length: 16 },
    (_, i) => "attr_" + String(i).padStart(2, "0") + "a".repeat(40),
  );
  settings.policy.steps.read_records.attributes = Object.fromEntries(
    names.map((name) => [name, { type: "string", enum: ["a".repeat(48)] }]),
  );
  settings.policy.content.message.valueSchema = {
    type: "array",
    maxItems: 4,
    items: { type: "string", maxLength: 16000 },
  };
  const run = createCapture(settings).begin({ consent: consent() });
  let omitted = 0;
  for (let i = 0; i < 128; i++)
    if (
      !run.step({
        id: "read_" + i,
        kind: "tool",
        name: "read_records",
        status: "ok",
        attributes: Object.fromEntries(
          names.map((name) => [name, "a".repeat(48)]),
        ),
      })
    )
      omitted++;
  const result = await run.end({
    checks: { valid: true },
    content: { message: Array(4).fill("a".repeat(16000)) },
  });
  assert.equal(result.status, "accepted");
  assert.ok(omitted > 0);
  assert.equal(calls.at(-1).body.droppedSteps, omitted);
  assert.equal(calls.at(-1).body.checks.valid, true);
  assert.ok(Buffer.byteLength(calls.at(-1).init.body) <= 262144);
});

test("caller mutations cannot change the validated outcome or run metadata", async (t) => {
  const { calls } = receiver(t),
    sdk = createCapture(options()),
    grant = consent(),
    run = sdk.begin({ consent: grant });
  const result = { checks: { valid: true } };
  const end = run.end(result);
  result.checks.valid = false;
  assert.equal((await end).status, "accepted");
  assert.equal(calls.at(-1).body.checks.valid, true);
  const payload = {
    consent: grant,
    reference: { ...run.reference },
    name: "proposal_decision",
    attributes: { decision: "applied" },
  };
  const pending = sdk.outcome(payload);
  payload.reference.traceId = randomUUID();
  payload.reference.grantId = randomUUID();
  payload.attributes.decision = "dismissed";
  assert.equal((await pending).status, "accepted");
  assert.equal(calls.at(-1).body.traceId, run.reference.traceId);
  assert.equal(calls.at(-1).body.attributes.decision, "applied");
});
