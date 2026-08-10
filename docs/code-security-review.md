# Code security review

**Captured:** 2026-08-06
**Scope:** Local AutoEval FastAPI and Next.js MVP
**Status:** Before-fix findings. No security remediation was applied before this report was recorded.

## Threat model

The current application is intentionally local-first and single-user. The default FastAPI host allowlist contains only `localhost`, `127.0.0.1`, and the test host, and the development launch command does not opt into a public bind address. The findings below separate that current assumption from the risk created if the service is reverse-proxied, bound to a LAN address, or shared by multiple local users.

No critical remotely exploitable issue was found under the default loopback-only assumption.

## Prioritized findings

### SEC-001: The API is an unauthenticated control plane if exposed beyond loopback

**Severity:** High when non-loopback; accepted local-MVP risk on loopback
**Evidence:** `backend/src/autoeval_api/main.py:140-390`, `backend/src/autoeval_api/config.py:15-25`, `scripts/dev.sh:16-20`

All trace reads, prompt and graph mutations, dataset mutations, inference calls, and evaluation runs are available without an identity or authorization dependency. Trusted-host and CORS settings narrow browser behavior but are not authentication. A reverse proxy or public bind would let any reachable caller read recorded data, alter versioned inputs, and spend configured model or CLI capacity.

**Minimal remediation:** Keep loopback as an enforced default. Refuse non-loopback production startup unless an authentication provider is configured. Add a small authentication dependency at the API router boundary and enforce allowed origins on unsafe browser methods.

### SEC-002: Enabling CLI providers crosses a high-trust local execution boundary

**Severity:** High when enabled without caller authorization; disabled by default
**Evidence:** `backend/src/autoeval_api/config.py:22-24`, `backend/src/autoeval_api/inference/cli.py:24-93`, `backend/src/autoeval_api/main.py:228-243`

When enabled, an API caller can invoke locally authenticated Codex or Claude processes. The adapter safely uses a fixed command tuple and `asyncio.create_subprocess_exec`, so request data cannot inject shell syntax. However, invocation inherits the process environment, working directory, CLI authentication, and user configuration. There is no per-call authorization or budget, and up to 4,000 bytes of raw stderr can become a stored trace error.

**Minimal remediation:** Require separate authorization for CLI models; allow them only on loopback; run in an explicit isolated directory with ephemeral settings; apply request, time, output, and concurrency budgets; and return sanitized client errors while retaining operational detail only in protected logs.

### SEC-003: Request-size enforcement can be bypassed without `Content-Length`

**Severity:** Medium
**Evidence:** `backend/src/autoeval_api/main.py:118-129`, `backend/src/autoeval_api/config.py:23-25`

The middleware rejects only when a parseable `Content-Length` header exceeds the limit. Chunked bodies and requests without the header are read and parsed without byte counting. A malformed header can also raise while converting to `int`.

**Minimal remediation:** Add an ASGI receive wrapper that counts actual body bytes, stops at the configured limit, and treats an invalid length as a bad request.

### SEC-004: Trace observability retains sensitive payloads without redaction or retention controls

**Severity:** Medium
**Evidence:** `backend/src/autoeval_api/graph/runner.py:50-79`, `backend/src/autoeval_api/graph/runner.py:110-145`, `backend/src/autoeval_api/models.py:122-161`, `backend/src/autoeval_api/services/traces.py:7-36`

The product stores raw request input, full system prompts, intermediate node state, outputs, and errors in SQLite, then returns them through trace APIs. Adding a trace to a draft dataset creates another durable copy. Operational incidents can contain credentials, PII, or confidential customer context.

**Minimal remediation:** Put a pluggable redaction policy in front of persistence, offer configurable full-payload capture for explicitly trusted environments, sanitize provider errors, and add retention/deletion controls.

### SEC-005: Evaluation admission lacks global backpressure and spend limits

**Severity:** Medium
**Evidence:** `backend/src/autoeval_api/schemas.py:200-205`, `backend/src/autoeval_api/main.py:364-390`, `backend/src/autoeval_api/services/evaluations.py:62-99`

One request may select up to 12 models and evaluate every item in a final dataset. There is no global cap on queued background tasks, dataset item count, simultaneous evaluation runs, total provider calls, or projected cost. Repeated local requests can exhaust memory, provider quota, or API spend.

**Minimal remediation:** Add bounded run admission, a process-wide worker semaphore or durable queue, configurable item/model/cost budgets, and duplicate-run suppression.

### SEC-006: Nonce CSP is incompatible with the statically generated pages

**Severity:** Medium correctness and security-header defect
**Evidence:** `frontend/src/proxy.ts:3-24`; production build output under `.next/server/app/*.html`

The proxy sends `script-src` with a per-request nonce and `strict-dynamic`, but the build prerenders the primary routes. Inspection of the generated HTML confirms that framework, page, and inline scripts have no nonce. Modern browsers will block hydration under this policy.

**Minimal remediation:** Force request-time rendering for nonce-protected pages so Next can attach the request nonce, or adopt a build-compatible hash-based CSP. Do not remove CSP as a workaround.

### SEC-007: A bodyless mutation is cross-site requestable

**Severity:** Low
**Evidence:** `backend/src/autoeval_api/main.py:109-116`, `backend/src/autoeval_api/main.py:327-338`

CORS controls access to responses but does not prevent a cross-origin form or simple request from reaching the server. The dataset-finalize POST requires no JSON body, so a malicious site can trigger it against a local service. Trusted-host validation still accepts the legitimate `127.0.0.1` or `localhost` host used by that request.

**Minimal remediation:** Reject unsafe-method requests whose `Origin` is absent or outside the configured web origins, with an explicit exception for trusted non-browser clients if needed.

### SEC-008: Production documentation settings fail open to development defaults

**Severity:** Low
**Evidence:** `backend/src/autoeval_api/config.py:15`, `backend/src/autoeval_api/main.py:97-103`

OpenAPI, Swagger UI, and ReDoc are disabled only when `AUTOEVAL_ENV` equals `production`. A deployment that omits this variable uses the development default and exposes API documentation. This does not create access by itself, but it increases discovery impact alongside SEC-001.

**Minimal remediation:** Add an explicit production startup profile that fails closed when security-relevant settings are incomplete.

## Controls verified

- Pydantic request models forbid extra fields, bound string lengths where appropriate, and constrain graph node and edge counts.
- Graph definitions can reference only registered deterministic or LLM-output handlers.
- SQLAlchemy queries use ORM filters and primary-key lookups; no raw SQL or string-built statement is present.
- OpenRouter uses one fixed HTTPS URL, disables redirects, and keeps the bearer key in server-side settings.
- CLI commands use fixed argument arrays with no shell interpolation.
- Inference responses use standard JSON decoding and type checks; no pickle, YAML loader, dynamic import, or object hook is present.
- The backend has no request-controlled filesystem path operation.
- React renders text and JSON through normal escaped JSX; no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` usage is present.
- Both layers set clickjacking, MIME sniffing, referrer, and permissions headers; the backend also marks API responses `no-store`.

## Review limitations

This is a focused code review of the local MVP, not a penetration test. OpenRouter and optional CLI provider behavior was assessed at the adapter boundary without sending a paid provider request. Authentication, multi-tenant isolation, database encryption, and production deployment hardening remain outside the current local-only feature set.
