export const MAX_BYTES = 16384;
export const POLICY = "metadata-v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const LABEL = /^[a-zA-Z][a-zA-Z0-9_.:/-]{0,95}$/;
export function requireValue(ok) {
  if (!ok) throw new Error("Invalid feed contract");
}
export function object(value, keys) {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  requireValue(
    Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
  );
}
export function uuid(value) {
  requireValue(typeof value === "string" && UUID.test(value));
}
export function timestamp(value) {
  requireValue(Number.isSafeInteger(value) && value >= 0);
}
export function source(value) {
  requireValue(value === "synthetic" || value === "production");
}
export function validatePolicy(policy) {
  object(policy, ["metrics", "checks"]);
  for (const keys of Object.values(policy)) {
    requireValue(
      Array.isArray(keys) &&
        keys.length <= 32 &&
        new Set(keys).size === keys.length,
    );
    for (const key of keys)
      requireValue(
        typeof key === "string" && /^[a-z][a-z0-9_]{0,47}$/.test(key),
      );
  }
}
export function validateGrant(grant) {
  object(grant, ["id", "source", "expiresAt", "policy"]);
  uuid(grant.id);
  source(grant.source);
  timestamp(grant.expiresAt);
  requireValue(grant.policy === POLICY);
}
export function validateExperiment(value) {
  object(value, [
    "id",
    "revision",
    "promptHash",
    "configHash",
    "graphHash",
    "model",
    "mode",
    "datasetHash",
  ]);
  uuid(value.id);
  requireValue(["scripted", "live", "observed"].includes(value.mode));
  requireValue((value.mode === "observed") === (value.datasetHash === null));
  requireValue(
    typeof value.revision === "string" && /^[0-9a-f]{40}$/.test(value.revision),
  );
  for (const key of ["promptHash", "configHash"])
    requireValue(typeof value[key] === "string" && HASH.test(value[key]));
  for (const key of ["graphHash", "datasetHash"])
    requireValue(
      value[key] === null ||
        (typeof value[key] === "string" && HASH.test(value[key])),
    );
  requireValue(typeof value.model === "string" && LABEL.test(value.model));
}
export function validateTrace(trace, policy) {
  object(trace, [
    "schemaVersion",
    "id",
    "experimentId",
    "grantId",
    "source",
    "policy",
    "caseId",
    "startedAt",
    "endedAt",
    "status",
    "metrics",
    "checks",
  ]);
  requireValue(trace.schemaVersion === 1 && trace.policy === POLICY);
  for (const key of ["id", "experimentId", "grantId"]) uuid(trace[key]);
  requireValue(
    trace.caseId === null ||
      (typeof trace.caseId === "string" && HASH.test(trace.caseId)),
  );
  source(trace.source);
  timestamp(trace.startedAt);
  timestamp(trace.endedAt);
  requireValue(
    trace.endedAt >= trace.startedAt &&
      trace.endedAt - trace.startedAt <= 86400000,
  );
  requireValue(["ok", "error", "partial"].includes(trace.status));
  object(trace.metrics, policy.metrics);
  object(trace.checks, policy.checks);
  for (const value of Object.values(trace.metrics))
    requireValue(
      value === null ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= Number.MAX_SAFE_INTEGER),
    );
  for (const value of Object.values(trace.checks))
    requireValue(value === null || typeof value === "boolean");
}
// Stable JSON for this restricted contract (no arbitrary nested text, unsafe numbers or undefined).
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

export function validateDataset(value) {
  object(value, ["schemaVersion", "caseIds", "rubricHash"]);
  requireValue(
    value.schemaVersion === 1 &&
      typeof value.rubricHash === "string" &&
      HASH.test(value.rubricHash),
  );
  requireValue(
    Array.isArray(value.caseIds) &&
      value.caseIds.length > 0 &&
      value.caseIds.length <= 100,
  );
  requireValue(new Set(value.caseIds).size === value.caseIds.length);
  for (const id of value.caseIds)
    requireValue(typeof id === "string" && HASH.test(id));
  requireValue(value.caseIds.join() === [...value.caseIds].sort().join());
}
