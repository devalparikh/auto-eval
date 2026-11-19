import {
  createCaptureFromEnv,
  createTraceClient,
  type Policy,
  type Consent,
  type Reference,
  type Result,
} from "@devalparikh/autoeval";
const policy = {
  schemaVersion: 2,
  metrics: {
    latency_ms: { semanticId: "run.latency", definitionVersion: 1, unit: "ms" },
  },
  steps: { read: { attributes: { rows: { type: "integer" } } } },
  outcomes: { applied: { attributes: {} } },
} satisfies Policy;
const sdk = createCaptureFromEnv({ policy });
const consent: Consent = { granted: true, id: "synthetic", categories: [] };
const run = sdk.begin({ consent });
run.step({
  id: "read_1",
  kind: "tool",
  name: "read",
  status: "ok",
  attributes: { rows: 1 },
});
const result: Result = await run.end({
  metrics: { latency_ms: null },
  status: "partial",
});
if (run.reference) {
  const ref: Reference = run.reference;
  await sdk.outcome({ consent, reference: ref, name: "applied" });
}
if (result.status === "skipped") result.reason satisfies string;
run.step({
  id: "bad",
  kind: "tool",
  name: "read",
  status: "ok",
  // @ts-expect-error operational attributes cannot contain an arbitrary object
  attributes: { raw: {} },
});
// @ts-expect-error unknown check outcome stays null, not an arbitrary string
await run.end({ checks: { passed: "unknown" } });

const client = createTraceClient({ policy });
const appRun = client.begin();
if (appRun.reference) await client.outcome({ reference: appRun.reference, name: "applied" });
// @ts-expect-error this client does not take a user grant
client.begin({ consent });
