import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createCapture } from "../src/index.js";
import { startFeed } from "../src/server.js";

const token = () => randomBytes(32).toString("base64url");
const policy = { metrics: ["calls"], checks: ["safe"] };
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "autoeval-test-"));
  const project = randomUUID(),
    other = randomUUID();
  const admin = token(),
    ingest = token(),
    reader = token(),
    otherReader = token();
  let now = Date.now();
  const config = {
    path: join(dir, "feed.db"),
    projects: [
      { id: project, policy },
      { id: other, policy },
    ],
    principals: [
      { token: admin, project, role: "admin" },
      { token: ingest, project, role: "ingest" },
      { token: reader, project, role: "read" },
      { token: otherReader, project: other, role: "read" },
    ],
    ttlMs: 60000,
    now: () => now,
    ...overrides,
  };
  const feed = await startFeed(config);
  t.after(async () => {
    await feed.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (method, route, credential, body) =>
    fetch(feed.endpoint + route, {
      method,
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const experiment = {
    id: randomUUID(),
    revision: "a".repeat(40),
    promptHash: "b".repeat(64),
    configHash: "c".repeat(64),
    graphHash: null,
    model: "scripted/example-v1",
    mode: "scripted",
    datasetHash: "d".repeat(64),
  };
  const grant = {
    id: randomUUID(),
    source: "synthetic",
    expiresAt: now + 120000,
    policy: "metadata-v1",
  };
  const dataset = {
    schemaVersion: 1,
    caseIds: ["e".repeat(64)],
    rubricHash: "f".repeat(64),
  };
  const registered = await call("POST", "/v1/datasets", admin, dataset);
  assert.equal(registered.status, 201);
  experiment.datasetHash = (await registered.json()).hash;
  assert.equal(
    (await call("POST", "/v1/experiments", admin, experiment)).status,
    201,
  );
  assert.equal((await call("POST", "/v1/grants", admin, grant)).status, 201);
  const trace = {
    schemaVersion: 1,
    id: randomUUID(),
    experimentId: experiment.id,
    grantId: grant.id,
    source: "synthetic",
    policy: "metadata-v1",
    caseId: "e".repeat(64),
    startedAt: now,
    endedAt: now,
    status: "ok",
    metrics: { calls: 2 },
    checks: { safe: true },
  };
  return {
    feed,
    call,
    experiment,
    grant,
    trace,
    admin,
    ingest,
    reader,
    otherReader,
    config,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("installed API defaults off and does not evaluate a raw-data closure without consent", async () => {
  let reads = 0;
  const input = {
    consent: null,
    project: () => {
      reads++;
      throw new Error("private");
    },
    startedAt: 0,
    endedAt: 0,
  };
  assert.deepEqual(await createCapture().capture(input), {
    status: "disabled",
  });
  const capture = createCapture({
    enabled: true,
    endpoint: "http://127.0.0.1:1/v1/traces",
    token: token(),
    experimentId: randomUUID(),
    policy,
    source: "synthetic",
  });
  assert.deepEqual(await capture.capture(input), { status: "no-consent" });
  assert.equal(reads, 0);
});

test("SDK imports, durably feeds a projection, and scopes read credentials by project", async (t) => {
  const f = await fixture(t);
  const capture = createCapture({
    enabled: true,
    endpoint: f.feed.endpoint + "/v1/traces",
    token: f.ingest,
    experimentId: f.experiment.id,
    policy,
    source: "synthetic",
  });
  const result = await capture.capture({
    consent: f.grant,
    caseId: f.trace.caseId,
    project: () => ({ metrics: { calls: 2 }, checks: { safe: true } }),
    startedAt: f.trace.startedAt,
    endedAt: f.trace.endedAt,
  });
  assert.equal(result.status, "accepted");
  const route = `/v1/traces/${result.id}`;
  assert.equal((await f.call("GET", route, f.ingest)).status, 403);
  assert.equal((await f.call("GET", route, f.admin)).status, 403);
  assert.equal((await f.call("GET", route, f.otherReader)).status, 404);
  assert.equal((await f.call("GET", route, token())).status, 401);
  assert.deepEqual(
    (await (await f.call("GET", route, f.reader)).json()).checks,
    { safe: true },
  );
  assert.equal((await stat(f.config.path)).mode & 0o077, 0);
});

test("immutable experiment registration and idempotent traces reject conflicts", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call("POST", "/v1/experiments", f.admin, f.experiment)).status,
    200,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/experiments", f.admin, {
        ...f.experiment,
        promptHash: "f".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.call("POST", "/v1/experiments", f.ingest, f.experiment)).status,
    403,
  );
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    201,
  );
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    200,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...f.trace,
        status: "error",
      })
    ).status,
    409,
  );
});

test("raw content, identity, extra fields, invalid values and missing approved metric keys cannot enter storage", async (t) => {
  const f = await fixture(t);
  for (const bad of [
    { ...f.trace, message: "secret@example.com" },
    { ...f.trace, metrics: { calls: "secret@example.com" } },
    { ...f.trace, metrics: { calls: 1, account_id: 42 } },
    { ...f.trace, checks: {} },
    { ...f.trace, schemaVersion: 2 },
    { ...f.trace, metrics: { calls: -1 } },
    { ...f.trace, metrics: { calls: 1e100 } },
    { ...f.trace, id: "secret@example.com" },
    { ...f.trace, startedAt: 0 },
  ])
    assert.equal(
      (await f.call("POST", "/v1/traces", f.ingest, bad)).status,
      400,
    );
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...f.trace,
        grantId: randomUUID(),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...f.trace,
        experimentId: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (await readFile(f.config.path)).includes(Buffer.from("secret@example.com")),
    false,
  );
});

test("production defaults blocked, revoked grants erase records and cannot be reactivated", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call("POST", "/v1/grants", f.admin, {
        ...f.grant,
        id: randomUUID(),
        source: "production",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...f.trace,
        source: "production",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    201,
  );
  assert.equal(
    (await f.call("DELETE", `/v1/grants/${f.grant.id}`, f.ingest)).status,
    403,
  );
  assert.equal(
    (await f.call("DELETE", `/v1/grants/${f.grant.id}`, f.admin)).status,
    200,
  );
  assert.equal(
    (await f.call("GET", `/v1/traces/${f.trace.id}`, f.reader)).status,
    404,
  );
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    403,
  );
  assert.equal(
    (await f.call("POST", "/v1/grants", f.admin, f.grant)).status,
    409,
  );
});

test("retention uses event time, purges before reads and cannot be extended by retry", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    201,
  );
  f.advance(30000);
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    200,
  );
  f.advance(30000);
  assert.equal(
    (await f.call("GET", `/v1/traces/${f.trace.id}`, f.reader)).status,
    404,
  );
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    410,
  );
});

test("schema/policies persist; a second server sees receipts; policy widening is refused", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    201,
  );
  const second = await startFeed(f.config);
  try {
    const read = await fetch(`${second.endpoint}/v1/traces/${f.trace.id}`, {
      headers: { authorization: `Bearer ${f.reader}` },
    });
    assert.equal(read.status, 200);
    await assert.rejects(
      startFeed({
        ...f.config,
        projects: f.config.projects.map((p) => ({
          ...p,
          policy: { metrics: ["private"], checks: [] },
        })),
      }),
    );
  } finally {
    await second.close();
  }
});

test("body limits cover chunked requests and browser-origin requests are refused", async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.feed.endpoint + "/v1/traces", {
    method: "POST",
    headers: { origin: "https://example.com" },
  });
  assert.equal(response.status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = request(
      f.feed.endpoint + "/v1/traces",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${f.ingest}`,
          "content-type": "application/json",
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.write(" ".repeat(9000));
    req.end(" ".repeat(9000));
  });
  assert.equal(status, 413);
});

test("SDK refuses insecure remote endpoints, caps timeout and contains projection/transport errors", async () => {
  const options = {
    enabled: true,
    endpoint: "http://example.com/v1/traces",
    token: token(),
    experimentId: randomUUID(),
    policy,
    source: "synthetic",
  };
  assert.throws(() => createCapture(options));
  options.endpoint = "http://127.0.0.1:1/v1/traces";
  assert.throws(() => createCapture({ ...options, timeoutMs: 100000 }));
  const grant = {
    id: randomUUID(),
    source: "synthetic",
    policy: "metadata-v1",
    expiresAt: Date.now() + 60000,
  };
  const result = await createCapture(options).capture({
    consent: grant,
    project: () => {
      throw new Error("do not log");
    },
    startedAt: 0,
    endedAt: 0,
  });
  assert.deepEqual(result, { status: "dropped" });
});

test("same-data comparison rejects missing, duplicate and different-mode evidence", async (t) => {
  const f = await fixture(t);
  const right = { ...f.experiment, id: randomUUID(), revision: "b".repeat(40) };
  assert.equal(
    (await f.call("POST", "/v1/experiments", f.admin, right)).status,
    201,
  );
  const route = `/v1/comparisons/${f.experiment.id}/${right.id}`;
  assert.equal((await f.call("GET", route, f.reader)).status, 409);
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, f.trace)).status,
    201,
  );
  const after = {
    ...f.trace,
    id: randomUUID(),
    experimentId: right.id,
    checks: { safe: null },
    status: "partial",
  };
  assert.equal(
    (await f.call("POST", "/v1/traces", f.ingest, after)).status,
    201,
  );
  const compared = await f.call("GET", route, f.reader);
  assert.equal(compared.status, 200);
  assert.deepEqual((await compared.json()).cases[0].checks, [
    { name: "safe", before: true, after: null },
  ]);
  assert.equal((await f.call("GET", route, f.otherReader)).status, 404);
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...after,
        id: randomUUID(),
      })
    ).status,
    201,
  );
  assert.equal((await f.call("GET", route, f.reader)).status, 409);
  const live = { ...f.experiment, id: randomUUID(), mode: "live" };
  assert.equal(
    (await f.call("POST", "/v1/experiments", f.admin, live)).status,
    201,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...f.trace,
        id: randomUUID(),
        experimentId: live.id,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await f.call(
        "GET",
        `/v1/comparisons/${f.experiment.id}/${live.id}`,
        f.reader,
      )
    ).status,
    409,
  );
});

test("dataset registration is content addressed and cannot invent missing frozen data", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call("POST", "/v1/experiments", f.admin, {
        ...f.experiment,
        id: randomUUID(),
        datasetHash: "0".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/datasets", f.admin, {
        schemaVersion: 1,
        caseIds: ["e".repeat(64), "e".repeat(64)],
        rubricHash: "f".repeat(64),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...f.trace,
        caseId: "0".repeat(64),
      })
    ).status,
    409,
  );
  const observed = {
    ...f.experiment,
    id: randomUUID(),
    mode: "observed",
    datasetHash: null,
  };
  assert.equal(
    (await f.call("POST", "/v1/experiments", f.admin, observed)).status,
    201,
  );
  assert.equal(
    (
      await f.call("POST", "/v1/traces", f.ingest, {
        ...f.trace,
        id: randomUUID(),
        experimentId: observed.id,
        caseId: null,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await f.call(
        "GET",
        `/v1/comparisons/${observed.id}/${observed.id}`,
        f.reader,
      )
    ).status,
    409,
  );
});
