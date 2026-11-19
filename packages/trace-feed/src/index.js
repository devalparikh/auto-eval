import { randomUUID } from "node:crypto";
import {
  MAX_BYTES,
  assert,
  artifactHash,
  attributes,
  canonical,
  consent,
  fingerprint,
  isHash,
  isId,
  isLabel,
  normalizeExperiment,
  normalizePolicy,
  object,
  redactIdentifiers,
  source,
  status,
  timestamp,
  valueValid,
} from "./contract.js";
export { artifactHash };
const skipped = (reason) => ({ status: "skipped", reason });
const inactiveRun = (reason) =>
  Object.freeze({
    reference: null,
    step: () => false,
    end: async () => skipped(reason),
  });
const inactive = (reason) =>
  Object.freeze({
    enabled: false,
    reason,
    begin: () => inactiveRun(reason),
    outcome: async () => skipped(reason),
    grade: async () => skipped(reason),
    withdraw: async () => skipped(reason),
  });

function safeCoverage(value, policy) {
  const allowed = new Set([
    "not_measured",
    "not_authorized",
    "invalid_value",
    "redaction_failed",
    "size_limit",
    "retention_expired",
  ]);
  const coverage = {};
  for (const section of ["metrics", "checks", "content"])
    for (const name of Object.keys(policy[section])) {
      const key = section + "." + name;
      if (allowed.has(value?.[key])) coverage[key] = value[key];
    }
  return coverage;
}

function gradeDefinition(input, policy) {
  if (input === undefined) return undefined;
  object(input, ["kind", "version", "choices", "contentField"], ["kind"]);
  const { kind, version = 1, choices, contentField } = input;
  assert(["boolean", "number", "category", "multi_select", "json"].includes(kind));
  assert(Number.isInteger(version) && version >= 1 && version <= 1000000);
  if (kind === "category" || kind === "multi_select") {
    assert(Array.isArray(choices) && choices.length > 0 && choices.length <= 32);
    assert(choices.every(isLabel) && new Set(choices).size === choices.length);
  } else assert(choices === undefined);
  if (kind === "json") assert(isLabel(contentField) && Object.hasOwn(policy.content, contentField));
  else assert(contentField === undefined);
  return { kind, version, choices: choices?.slice(), contentField };
}

// Validate before stringifying so invalid numbers, undefined fields and cycles cannot
// silently change meaning or expand without bound.
function prepareGradeValue(value, budget = { nodes: 2048, bytes: 16384 }, depth = 0) {
  assert(--budget.nodes >= 0 && depth <= 12);
  if (typeof value === "string") {
    assert(value.length <= budget.bytes && value.isWellFormed());
    budget.bytes -= Buffer.byteLength(value);
    assert(budget.bytes >= 0);
    return redactIdentifiers(value);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    assert(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
    return value;
  }
  if (Array.isArray(value)) {
    assert(value.length <= 128);
    return Array.from(value, child => prepareGradeValue(child, budget, depth + 1));
  }
  const keys = Object.keys(value);
  assert(keys.length <= 32 && keys.every(isLabel));
  object(value, keys);
  return Object.fromEntries(keys.map(key => [key, prepareGradeValue(value[key], budget, depth + 1)]));
}

/** No import-time I/O, global instrumentation, exporter, retries, or background queue. */
export function createCapture(options = {}) {
  try {
    return initialize(options, true);
  } catch {
    return inactive("invalid_config");
  }
}
function initialize(options, legacyGrants) {
  if (options.enabled !== true) return inactive("disabled");
  object(options, [
    "enabled",
    "endpoint",
    "token",
    "source",
    "timeoutMs",
    "policy",
    "experiment",
    "redactorVersion",
    ...(legacyGrants ? [] : ["grade"]),
  ]);
  assert(typeof window === "undefined");
  const url = new URL(options.endpoint),
    origin = options.source;
  assert(
    source(origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
  );
  assert(["/v2/traces", "/api/backend/v2/traces"].includes(url.pathname));
  assert(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        origin === "synthetic" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)),
  );
  assert(
    typeof options.token === "string" &&
      /^ae_[A-Za-z0-9_-]{32,128}$/.test(options.token),
  );
  const token = options.token,
    timeoutMs = options.timeoutMs ?? 2000;
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 2000);
  const policy = normalizePolicy(options.policy),
    policyVersion = fingerprint("policy", policy);
  const experiment = normalizeExperiment(
      options.experiment,
      policyVersion,
      origin,
    ),
    experimentId = fingerprint("experiment", experiment);
  const definition = gradeDefinition(options.grade, policy);
  const redactorVersion = options.redactorVersion ?? null;
  assert(redactorVersion === null || isHash(redactorVersion));
  const declarations = {
    policy,
    experiment: Object.fromEntries(
      Object.entries(experiment).filter(
        ([name]) => !["source", "policyVersion"].includes(name),
      ),
    ),
    source: origin,
  };
  const base = url.href.slice(0, -"traces".length);
  let blocked = false,
    connection = null,
    connecting = null,
    active = 0;
  const grants = new Map(),
    schemas = new Map([[policyVersion, policy]]),
    withdrawn = new Set();
  function cache(map, key, value) {
    if (map.size >= 256) map.delete(map.keys().next().value);
    map.set(key, value);
  }
  function permitted(grant) {
    if (!legacyGrants) return true;
    return (
      grant &&
      !withdrawn.has(grant.id) &&
      (grant.expiresAt === null || grant.expiresAt > Date.now())
    );
  }
  async function bounded(work) {
    if (blocked) return skipped("unauthorized");
    if (active >= 8) return skipped("busy");
    active++;
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(skipped("timeout"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        deadline,
        Promise.resolve()
          .then(() => work(controller.signal))
          .catch(() =>
            skipped(controller.signal.aborted ? "timeout" : "unavailable"),
          ),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      active--;
    }
  }
  async function request(path, method, value, signal, eventId) {
    assert(!signal.aborted);
    const body = value === undefined ? undefined : JSON.stringify(value);
    assert(body === undefined || Buffer.byteLength(body) <= MAX_BYTES);
    const response = await fetch(base + path, {
      method,
      body,
      signal,
      redirect: "error",
      credentials: "omit",
      headers: {
        authorization: `Bearer ${token}`,
        ...(eventId ? { "Idempotency-Key": eventId } : {}),
        "content-type": "application/json",
      },
    });
    if (response.status === 401) blocked = true;
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    // Read bounded JSON; neither payloads nor remote errors enter result objects/logs.
    const reader = response.body?.getReader();
    assert(reader);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        assert(size <= MAX_BYTES);
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async function connect(signal) {
    if (connection && connection.until > Date.now()) return connection;
    if (!connecting)
      connecting = request("connect", "POST", declarations, signal)
        .then((result) => {
          if (!result) return null;
          assert(
            result.policyVersion === policyVersion &&
              result.experimentId === experimentId &&
              isId(result.applicationId),
          );
          object(result.settings, [
            "production_enabled",
            "retention_days",
            "content_retention_days",
            "content_categories",
          ]);
          assert(
            typeof result.settings.production_enabled === "boolean" &&
              Array.isArray(result.settings.content_categories) &&
              result.settings.content_categories.every(isLabel),
          );
          connection = { ...result.settings, until: Date.now() + 60000 };
          return connection;
        })
        .finally(() => {
          connecting = null;
        });
    return connecting;
  }
  async function register(grant, signal) {
    if (!permitted(grant)) return false;
    const digest = canonical(grant),
      cached = grants.get(grant.id);
    if (cached?.digest === digest && cached.until > Date.now()) return true;
    const response = await request("grants", "POST", grant, signal);
    if (!response || response.id !== grant.id || !permitted(grant))
      return false;
    cache(grants, grant.id, { digest, until: Date.now() + 60000 });
    return true;
  }
  function contentProjection(raw, declaration, grant, config) {
    const projected = {},
      coverage = {};
    if (raw === undefined) return { content: projected, coverage };
    const fields = Object.entries(declaration.content);
    if (
      !redactorVersion ||
      !fields.some(
        ([, field]) =>
          (!grant || grant.categories.includes(field.category)) &&
          (!config || config.content_categories.includes(field.category)),
      )
    ) {
      for (const [name] of fields)
        coverage["content." + name] = redactorVersion
          ? "not_authorized"
          : "redaction_failed";
      return { content: projected, coverage };
    }
    try {
      // The lazy app projection runs only in end/outcome, after checking enabled categories.
      raw = typeof raw === "function" ? raw() : raw;
      object(raw, Object.keys(declaration.content));
      let size = 0;
      for (const [name, value] of Object.entries(raw)) {
        const field = declaration.content[name];
        let reason;
        if (
          (grant && !grant.categories.includes(field.category)) ||
          (config && !config.content_categories.includes(field.category))
        )
          reason = "not_authorized";
        else if (!redactorVersion) reason = "redaction_failed";
        else if (!valueValid(value, field.valueSchema))
          reason = "invalid_value";
        else {
          const redacted = redactIdentifiers(value),
            bytes = Buffer.byteLength(JSON.stringify(redacted));
          if (bytes > 65536 || size + bytes > 131072) reason = "size_limit";
          else {
            projected[name] = redacted;
            size += bytes;
          }
        }
        if (reason) coverage["content." + name] = reason;
      }
    } catch {
      for (const name of Object.keys(projected)) delete projected[name];
      for (const name of Object.keys(declaration.content))
        coverage["content." + name] = "redaction_failed";
    }
    return { content: projected, coverage };
  }
  function begin(input = {}) {
    try {
      object(input, ["consent", "id", "startedAt", "caseId"]);
      if (!legacyGrants) assert(!Object.hasOwn(input, "consent"));
      const grant = legacyGrants ? consent(input.consent, origin) : null;
      if (!permitted(grant)) return inactiveRun("no_consent");
      if (blocked) return inactiveRun("unauthorized");
      const id = input.id ?? randomUUID(),
        startedAt = input.startedAt ?? Date.now(),
        caseId = input.caseId ?? null;
      assert(isId(id) && timestamp(startedAt));
      assert(experiment.mode === "observed" ? caseId === null : isHash(caseId));
      const reference = Object.freeze({
        traceId: id,
        policyVersion,
        experimentId,
        ...(grant ? { grantId: grant.id } : {}),
      });
      const steps = [],
        ids = new Set();
      let ended = false;
      let stepBytes = 0,
        droppedSteps = 0;
      return Object.freeze({
        reference,
        step(item) {
          try {
            if (ended || !permitted(grant)) return false;
            assert(steps.length < 128);
            object(
              item,
              [
                "id",
                "parentId",
                "kind",
                "name",
                "status",
                "durationMs",
                "attributes",
              ],
              ["id", "kind", "name", "status"],
            );
            assert(
              isLabel(item.id) &&
                !ids.has(item.id) &&
                (item.parentId == null || ids.has(item.parentId)),
            );
            assert(
              [
                "model",
                "tool",
                "validation",
                "persistence",
                "admission",
              ].includes(item.kind) &&
                status(item.status) &&
                Object.hasOwn(policy.steps, item.name),
            );
            assert(
              item.durationMs == null ||
                (timestamp(item.durationMs) && item.durationMs <= 86400000),
            );
            const value = {
              id: item.id,
              parentId: item.parentId ?? null,
              kind: item.kind,
              name: item.name,
              status: item.status,
              durationMs: item.durationMs ?? null,
              attributes: attributes(
                item.attributes ?? {},
                policy.steps[item.name],
              ),
            };
            const bytes = Buffer.byteLength(JSON.stringify(value));
            // Reserve space for the summary and optional content before copying more steps.
            assert(stepBytes + bytes <= 98304);
            stepBytes += bytes;
            steps.push(value);
            ids.add(item.id);
            return true;
          } catch {
            droppedSteps = Math.min(1000000, droppedSteps + 1);
            return false;
          }
        },
        async end(result = {}) {
          if (ended) return skipped("already_ended");
          ended = true;
          if (!permitted(grant)) {
            steps.length = 0;
            return skipped("no_consent");
          }
          try {
            object(result, [
              "endedAt",
              "status",
              "metrics",
              "checks",
              "content",
            ]);
            object(result.metrics ?? {}, Object.keys(policy.metrics));
            object(result.checks ?? {}, Object.keys(policy.checks));
            result = {
              ...result,
              endedAt: result.endedAt ?? Date.now(),
              metrics: { ...result.metrics },
              checks: { ...result.checks },
            };
          } catch {
            steps.length = 0;
            return skipped("invalid_input");
          }
          return bounded(async (signal) => {
            object(result, [
              "endedAt",
              "status",
              "metrics",
              "checks",
              "content",
            ]);
            const endedAt = result.endedAt ?? Date.now(),
              outcome = result.status ?? "ok";
            assert(
              timestamp(endedAt) &&
                endedAt >= startedAt &&
                endedAt - startedAt <= 86400000 &&
                status(outcome),
            );
            object(result.metrics ?? {}, Object.keys(policy.metrics));
            object(result.checks ?? {}, Object.keys(policy.checks));
            const metrics = {},
              checks = {},
              coverage = {};
            for (const section of ["metrics", "checks"])
              for (const [name, definition] of Object.entries(
                policy[section],
              )) {
                const value = result[section]?.[name] ?? null;
                const valid =
                  value === null ||
                  (section === "checks"
                    ? typeof value === "boolean"
                    : typeof value === "number" &&
                      Number.isFinite(value) &&
                      Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
                      (definition.min === null || value >= definition.min) &&
                      (definition.max === null || value <= definition.max) &&
                      (definition.unit !== "count" || Number.isInteger(value)));
                (section === "metrics" ? metrics : checks)[name] = valid
                  ? value
                  : null;
                if (!valid || value === null)
                  coverage[section + "." + name] = valid
                    ? "not_measured"
                    : "invalid_value";
              }
            const config = await connect(signal);
            if (!config) return skipped(blocked ? "unauthorized" : "rejected");
            if (origin === "production" && !config.production_enabled)
              return skipped("production_disabled");
            if (grant && !(await register(grant, signal))) return skipped("no_consent");
            if (!permitted(grant) || signal.aborted)
              return skipped("no_consent");
            const projection = contentProjection(
              result.content,
              policy,
              grant,
              config,
            );
            const response = await request(
              "traces",
              "POST",
              {
                schemaVersion: 2,
                id,
                experimentId,
                policyVersion,
                ...(grant ? { grantId: grant.id } : {}),
                ...(definition ? { gradeDefinition: definition } : {}),
                source: origin,
                caseId,
                startedAt,
                endedAt,
                status: outcome,
                metrics,
                checks,
                steps,
                droppedSteps,
                content: projection.content,
                redactorVersion,
                coverage: { ...coverage, ...projection.coverage },
              },
              signal,
            );
            return response?.id === id
              ? {
                  status: "accepted",
                  reference,
                  coverage: safeCoverage(response.coverage, policy),
                }
              : skipped(blocked ? "unauthorized" : "rejected");
          }).finally(() => {
            steps.length = 0;
          });
        },
      });
    } catch {
      return inactiveRun("invalid_input");
    }
  }
  async function grade(input) {
    try {
      object(input, ["traceId", "value", "reason", "occurredAt", "id"], ["traceId", "value"]);
      const { traceId, reason, occurredAt, id = randomUUID() } = input;
      assert(isId(traceId) && isId(id) && input.value !== null);
      assert(occurredAt === undefined || timestamp(occurredAt));
      assert(reason === undefined || (typeof reason === "string" && reason.length <= 500));
      const body = { value: prepareGradeValue(input.value), occurredAt,
        reason: reason === undefined ? undefined : redactIdentifiers(reason) };
      return bounded(async signal => {
        const result = await request("traces/" + traceId + "/grades", "POST", body, signal, id);
        return result?.id === id ? { status: "accepted", id, coverage: {} }
          : skipped(blocked ? "unauthorized" : "rejected");
      });
    } catch {
      return skipped("invalid_input");
    }
  }
  return Object.freeze({
    enabled: true,
    reason: null,
    begin,
    ...(!legacyGrants && { grade }),
    async outcome(input) {
      let grant;
      try {
        object(
          input,
          [
            "consent",
            "reference",
            "id",
            "occurredAt",
            "name",
            "attributes",
            "content",
          ],
          legacyGrants ? ["consent", "reference", "name"] : ["reference", "name"],
        );
        if (!legacyGrants) assert(!Object.hasOwn(input, "consent"));
        grant = legacyGrants ? consent(input.consent, origin) : null;
        if (!permitted(grant)) return skipped("no_consent");
        const ref = input.reference;
        object(
          ref,
          ["traceId", "policyVersion", "experimentId", "grantId"],
          ["traceId", "policyVersion"],
        );
        assert(
          isId(ref.traceId) &&
            isHash(ref.policyVersion) &&
            (grant ? ref.grantId === grant.id : !Object.hasOwn(ref, "grantId")),
        );
        const values = input.attributes ?? {};
        object(values, Object.keys(values));
        assert(
          Object.keys(values).length <= 16 &&
            Object.keys(values).every(isLabel),
        );
        assert(
          Object.values(values).every(
            (value) =>
              value === null ||
              ["number", "boolean", "string"].includes(typeof value),
          ),
        );
        input = {
          ...input,
          reference: { ...ref },
          attributes: { ...values },
          id: input.id ?? randomUUID(),
          occurredAt: input.occurredAt ?? Date.now(),
        };
      } catch {
        return skipped("invalid_input");
      }
      return bounded(async (signal) => {
        const ref = input.reference;
        let declaration = schemas.get(ref.policyVersion);
        if (!declaration) {
          const response = await request(
            "policies/" + ref.policyVersion,
            "GET",
            undefined,
            signal,
          );
          if (!response) return skipped("rejected");
          declaration = normalizePolicy(response);
          assert(fingerprint("policy", declaration) === ref.policyVersion);
          cache(schemas, ref.policyVersion, declaration);
        }
        assert(Object.hasOwn(declaration.outcomes, input.name));
        const id = input.id ?? randomUUID(),
          occurredAt = input.occurredAt ?? Date.now();
        assert(isId(id) && timestamp(occurredAt));
        const values = attributes(
          input.attributes ?? {},
          declaration.outcomes[input.name],
        );
        if (!permitted(grant)) return skipped("no_consent");
        const config = legacyGrants ? null : await connect(signal);
        if (!legacyGrants && !config) return skipped(blocked ? "unauthorized" : "rejected");
        if (origin === "production" && config && !config.production_enabled)
          return skipped("production_disabled");
        const projection = contentProjection(
          input.content,
          declaration,
          grant,
          config,
        );
        const response = await request(
          "outcomes",
          "POST",
          {
            schemaVersion: 2,
            id,
            traceId: ref.traceId,
            policyVersion: ref.policyVersion,
            occurredAt,
            name: input.name,
            attributes: values,
            content: projection.content,
            redactorVersion,
          },
          signal,
        );
        return response?.id === id
          ? {
              status: "accepted",
              id,
              coverage: {
                ...projection.coverage,
                ...safeCoverage(response.coverage, declaration),
              },
            }
          : skipped(blocked ? "unauthorized" : "rejected");
      });
    },
    async withdraw(input) {
      let grantId;
      try {
        object(input, ["grantId"], ["grantId"]);
        grantId = input.grantId;
        assert(isId(grantId));
      } catch {
        return skipped("invalid_input");
      }
      // Stop in-process capture immediately, even while the instance is unavailable.
      withdrawn.add(grantId);
      grants.delete(grantId);
      if (withdrawn.size > 4096) {
        blocked = true;
        return skipped("capacity");
      }
      return bounded(async (signal) => {
        const result = await request(
          "grants/" + grantId,
          "DELETE",
          undefined,
          signal,
        );
        return result?.revoked === true
          ? { status: "revoked" }
          : skipped(blocked ? "unauthorized" : "rejected");
      });
    },
  });
}
/** Explicit server-only initialization. Missing/invalid config disables without throwing. */
export function createCaptureFromEnv(options = {}) {
  return fromEnv(options, true);
}

/** The application decides which runs to send before calling begin(). */
export function createTraceClient(options = {}) {
  const { enabled, reason, begin, outcome, grade } = fromEnv(options, false);
  return Object.freeze({ enabled, reason, begin, outcome, grade });
}

function fromEnv(options, legacyGrants) {
  try {
    const env = options.env ?? process.env;
    if (env.AUTOEVAL_ENABLED !== "true") return inactive("disabled");
    return initialize({
      enabled: true,
      endpoint: env.AUTOEVAL_ENDPOINT,
      token: env.AUTOEVAL_INGEST_KEY,
      source: env.AUTOEVAL_SOURCE,
      timeoutMs:
        env.AUTOEVAL_REQUEST_TIMEOUT_MS === undefined
          ? 2000
          : Number(env.AUTOEVAL_REQUEST_TIMEOUT_MS),
      policy: options.policy ?? (legacyGrants ? undefined : { schemaVersion: 2 }),
      experiment: options.experiment,
      redactorVersion: options.redactorVersion,
      ...(legacyGrants ? {} : { grade: options.grade }),
    }, legacyGrants);
  } catch {
    return inactive("invalid_config");
  }
}
