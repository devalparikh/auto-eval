# Security remediation status

**Updated:** 2026-11-08
**Baseline:** [`code-security-review.md`](code-security-review.md)
**Scope:** Post-refactor status for the local, single-user MVP

The before-fix report remains unchanged so its original findings and evidence are preserved. This document maps those findings to the current code after the maintainability and security refactor.

## Status by finding

| Finding | Status | Current evidence | Result |
| --- | --- | --- | --- |
| SEC-001: unauthenticated API if exposed | Mitigated for the supported local mode | `backend/src/autoeval_api/config.py:18-27`; `backend/src/autoeval_api/api/middleware.py:69-81` | Loopback clients are enforced by default in addition to trusted hosts and CORS. Authentication is still required before any supported network or multi-user deployment. |
| SEC-002: CLI provider trust boundary | Partially mitigated | `backend/src/autoeval_api/inference/cli.py` | CLI providers remain disabled by default. Codex uses read-only, ephemeral, user-config-free execution; commands are shell-free; the timeout applies, and the output limit is now enforced while stdout is read, killing the process when it is exceeded; stderr is drained and discarded, never buffered, returned, or stored. A separately authorized worker boundary is still required before shared use. |
| SEC-003: request-size bypass | Fixed | `backend/src/autoeval_api/api/middleware.py:27-67`, `90-102` | Invalid lengths return 400, declared oversize bodies return 413, and actual ASGI body bytes are counted even without `Content-Length` or across chunks. |
| SEC-004: sensitive trace retention | Partially mitigated | `backend/src/autoeval_api/graph/trace_policy.py`; `backend/src/autoeval_api/graph/runner.py` | Portfolio Analyst removes identity-like fields and raw dollar values from persisted requests and span snapshots. Incident traces still retain full local payloads, and configurable capture, retention, and deletion policies are not implemented. |
| SEC-005: evaluation admission and spend | Open | `backend/src/autoeval_api/api/routes/evaluations.py:39-64`; `backend/src/autoeval_api/services/evaluations.py:74-90`, `121-138` | Runs execute in-process and model items are deliberately serialized, but there is no durable queue, process-wide admission cap, projected-cost limit, or duplicate-run suppression. |
| SEC-006: nonce CSP on static pages | Fixed | `frontend/src/app/layout.tsx:12-16`; `frontend/src/proxy.ts:4-18` | The root layout is request-rendered and reads request headers, allowing Next.js to attach the per-request nonce. Production E2E verifies the CSP and nonce-bearing script response. |
| SEC-007: cross-site bodyless mutation | Fixed for browser requests | `backend/src/autoeval_api/api/middleware.py:83-88` | Disallowed origins are rejected and unsafe cross-site browser requests are blocked with `Sec-Fetch-Site`. Originless trusted local CLI requests remain supported. |
| SEC-009: frontend proxy bypassed loopback enforcement | Fixed for the local profile | `frontend/package.json` (`dev`, `start`); `frontend/src/proxy.ts`; `frontend/src/lib/loopback-host.ts` | The `/api/backend` rewrite made Next.js the API's only client, so the API's loopback check always passed, and Next.js listened on every interface. Both frontend commands now bind to 127.0.0.1, and the proxy refuses `/api/backend` requests whose Host is not this machine, which also stops DNS-rebinding reads (the rewrite replaces Host, so the API's trusted-host check cannot). Vercel routes `/api/backend` to the API before Next.js and relies on its HTTP Basic authentication. |
| SEC-010: vulnerable runtime dependencies | Fixed | `frontend/package.json`; `frontend/package-lock.json`; [`dependency-security-report.md`](dependency-security-report.md#re-audit-2026-11-08) | `next` 16.4.5 and `sharp` 0.35.5 clear the critical image-optimization RCE advisories; the production audit is clean. Development-only vitest and typescript-eslint findings remain. |
| SEC-011: size limits applied after buffering | Fixed | `backend/src/autoeval_api/inference/cli.py`; `backend/src/autoeval_api/market_data/options.py` | CLI output and Tradier responses are measured as they stream in, so the configured limits bound memory instead of being checked after a full download. Tradier also rejects an oversize `Content-Length` before reading, and checks the status before reading any body. |
| SEC-008: development docs default | Accepted local-only limitation | `backend/src/autoeval_api/app.py:62-68`; `backend/src/autoeval_api/config.py:16`, `36-38` | Docs are disabled in the explicit production profile. Development remains the default because this is a local workbench; a future deployment profile should fail closed when auth and production settings are absent. |

## Verification

- `backend/tests/test_middleware.py` covers loopback enforcement, allowed and denied origins, invalid length handling, declared oversize bodies, and streamed/no-length oversize bodies.
- `backend/tests/test_cli_provider.py` covers the fixed CLI command boundary, disabled-by-default behavior, safe failures, output limits, and JSON output validation.
- `backend/tests/test_cli_provider.py` also runs real child processes: a 256 KiB flood on both streams against a 32-byte limit ends the run immediately instead of at the timeout, and stderr far larger than a pipe buffer cannot stall a successful run.
- `backend/tests/test_options_market_data.py` covers a streamed oversize Tradier body that stops at the limit and a declared oversize `Content-Length`.
- `frontend/tests/loopback-host.test.ts` covers the Host check, including names that merely resolve to loopback.
- `frontend/tests/content-security-policy.test.ts` covers policy construction.
- `frontend/e2e/workbench.spec.ts` verifies the production CSP nonce plus the local seeded trace, dataset, evaluation, and results workflows.

No critical remotely exploitable issue was identified under the enforced loopback-only threat model. The remaining medium risks are incomplete trace-data retention controls and unbounded evaluation admission; both become release blockers before shared or hosted deployment.
