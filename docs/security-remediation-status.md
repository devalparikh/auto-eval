# Security remediation status

**Updated:** 2026-08-07
**Baseline:** [`code-security-review.md`](code-security-review.md)
**Scope:** Post-refactor status for the local, single-user MVP

The before-fix report remains unchanged so its original findings and evidence are preserved. This document maps those findings to the current code after the maintainability and security refactor.

## Status by finding

| Finding | Status | Current evidence | Result |
| --- | --- | --- | --- |
| SEC-001: unauthenticated API if exposed | Mitigated for the supported local mode | `backend/src/autoeval_api/config.py:18-27`; `backend/src/autoeval_api/api/middleware.py:69-81` | Loopback clients are enforced by default in addition to trusted hosts and CORS. Authentication is still required before any supported network or multi-user deployment. |
| SEC-002: CLI provider trust boundary | Partially mitigated | `backend/src/autoeval_api/inference/cli.py:12-21`, `66-103` | CLI providers remain disabled by default. Codex uses read-only, ephemeral, user-config-free execution; commands are shell-free; timeout and output limits remain; raw stderr is no longer returned or stored. A separately authorized worker boundary is still required before shared use. |
| SEC-003: request-size bypass | Fixed | `backend/src/autoeval_api/api/middleware.py:27-67`, `90-102` | Invalid lengths return 400, declared oversize bodies return 413, and actual ASGI body bytes are counted even without `Content-Length` or across chunks. |
| SEC-004: sensitive trace retention | Open | `backend/src/autoeval_api/graph/runner.py:50-78`, `108-143` | Raw inputs, prompts, intermediate state, outputs, and sanitized errors are still stored. Redaction, configurable capture, retention, and deletion policies are not implemented. |
| SEC-005: evaluation admission and spend | Open | `backend/src/autoeval_api/api/routes/evaluations.py:39-64`; `backend/src/autoeval_api/services/evaluations.py:74-90`, `121-138` | Runs execute in-process and model items are deliberately serialized, but there is no durable queue, process-wide admission cap, projected-cost limit, or duplicate-run suppression. |
| SEC-006: nonce CSP on static pages | Fixed | `frontend/src/app/layout.tsx:12-16`; `frontend/src/proxy.ts:4-18` | The root layout is request-rendered and reads request headers, allowing Next.js to attach the per-request nonce. Production E2E verifies the CSP and nonce-bearing script response. |
| SEC-007: cross-site bodyless mutation | Fixed for browser requests | `backend/src/autoeval_api/api/middleware.py:83-88` | Disallowed origins are rejected and unsafe cross-site browser requests are blocked with `Sec-Fetch-Site`. Originless trusted local CLI requests remain supported. |
| SEC-008: development docs default | Accepted local-only limitation | `backend/src/autoeval_api/app.py:62-68`; `backend/src/autoeval_api/config.py:16`, `36-38` | Docs are disabled in the explicit production profile. Development remains the default because this is a local workbench; a future deployment profile should fail closed when auth and production settings are absent. |

## Verification

- `backend/tests/test_middleware.py` covers loopback enforcement, allowed and denied origins, invalid length handling, declared oversize bodies, and streamed/no-length oversize bodies.
- `backend/tests/test_cli_provider.py` covers the fixed CLI command boundary, disabled-by-default behavior, safe failures, output limits, and JSON output validation.
- `frontend/tests/content-security-policy.test.ts` covers policy construction.
- `frontend/e2e/workbench.spec.ts` verifies the production CSP nonce plus the local seeded trace, dataset, evaluation, and results workflows.

No critical remotely exploitable issue was identified under the enforced loopback-only threat model. The remaining medium risks are trace-data retention and unbounded evaluation admission; both become release blockers before shared or hosted deployment.
