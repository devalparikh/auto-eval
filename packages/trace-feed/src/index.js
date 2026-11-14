import { randomUUID } from "node:crypto";
import {
  MAX_BYTES,
  POLICY,
  canonical,
  requireValue,
  validateGrant,
  validatePolicy,
  validateTrace,
  uuid,
  source,
} from "./contract.js";

/** No global instrumentation, environment reads, model calls, queues or import-time I/O. */
export function createCapture(options = {}) {
  try {
    return initializeCapture(options);
  } catch {
    // Never attach the input or cause: URL/clone/getter errors may contain secrets.
    throw new Error("Invalid feed contract");
  }
}

function initializeCapture(options) {
  if (options.enabled !== true)
    return { capture: async () => ({ status: "disabled" }) };
  const {
    endpoint,
    token,
    experimentId,
    policy,
    source: origin,
    timeoutMs = 500,
  } = options;
  const url = new URL(endpoint);
  requireValue(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ["/v1/traces", "/api/backend/v1/traces"].includes(url.pathname),
  );
  requireValue(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        origin === "synthetic" &&
        ["127.0.0.1", "[::1]"].includes(url.hostname)),
  );
  requireValue(
    typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token),
  );
  requireValue(
    Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 2000,
  );
  uuid(experimentId);
  source(origin);
  validatePolicy(policy);
  // Snapshot caller-owned configuration so a later mutation cannot widen capture.
  const projectionPolicy = structuredClone(policy);
  return {
    async capture({
      consent,
      project,
      caseId = null,
      startedAt,
      endedAt,
      status = "ok",
    }) {
      try {
        validateGrant(consent);
        if (consent.expiresAt <= Date.now() || consent.source !== origin)
          return { status: "no-consent" };
      } catch {
        return { status: "no-consent" };
      }
      try {
        // Projection runs only after opt-in. No raw data enters the SDK until this callback returns.
        const projected = project();
        const trace = {
          schemaVersion: 1,
          id: randomUUID(),
          experimentId,
          grantId: consent.id,
          source: origin,
          policy: POLICY,
          caseId,
          startedAt,
          endedAt,
          status,
          ...projected,
        };
        // Reject attempts to override provenance through the projection.
        requireValue(
          Object.keys(projected).length === 2 &&
            Object.hasOwn(projected, "metrics") &&
            Object.hasOwn(projected, "checks"),
        );
        validateTrace(trace, projectionPolicy);
        const body = canonical(trace);
        requireValue(Buffer.byteLength(body) <= MAX_BYTES);
        const response = await fetch(url, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body,
        });
        // Never reflect response bodies or credentials into application logs.
        await response.body?.cancel();
        return response.status === 201 || response.status === 200
          ? { status: "accepted", id: trace.id }
          : { status: "rejected" };
      } catch {
        return { status: "dropped" };
      }
    },
  };
}

/** Explicit server-only initialization. Importing this module reads no environment. */
export function createCaptureFromEnv({ policy, env = process.env } = {}) {
  if (env.AUTOEVAL_ENABLED !== "true") return createCapture();
  return createCapture({
    enabled: true,
    endpoint: env.AUTOEVAL_ENDPOINT,
    token: env.AUTOEVAL_INGEST_KEY,
    experimentId: env.AUTOEVAL_EXPERIMENT_ID,
    source: env.AUTOEVAL_SOURCE,
    policy,
    timeoutMs:
      env.AUTOEVAL_REQUEST_TIMEOUT_MS === undefined
        ? 500
        : Number(env.AUTOEVAL_REQUEST_TIMEOUT_MS),
  });
}
