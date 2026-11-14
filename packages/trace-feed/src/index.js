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
      url.pathname === "/v1/traces",
  );
  requireValue(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
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
