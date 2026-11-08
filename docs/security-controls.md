# Security controls

These controls apply to the local workbench and authenticated single-user
preview. Authentication and the deployment requirements in
[vercel-deployment.md](vercel-deployment.md) still apply.

## Evaluation admission and usage

`POST /api/eval-runs` locks a singleton database row before checking capacity,
looking up retries, finalizing a dataset, or inserting a run. SQLite uses its
writer lock and PostgreSQL uses a row lock. Separate API processes therefore
share the admission limit. Refused work returns HTTP 429 with `Retry-After: 60`
and leaves draft datasets editable. Retrying an admitted request ID returns the
original run even when admission is full.

| Setting | Default | Meaning |
| --- | ---: | --- |
| `AUTOEVAL_EVALUATION_MAX_PENDING_RUNS` | 4 | Queued plus running evaluations across the database |
| `AUTOEVAL_EVALUATION_MAX_ITEMS` | 1000 | Dataset items per run |
| `AUTOEVAL_EVALUATION_MAX_PROVIDER_CALLS` | 200 | Items times unique models times LLM nodes, also enforced during execution |
| `AUTOEVAL_EVALUATION_MAX_TOKENS` | 1000000 | Reported input plus output tokens per run |
| `AUTOEVAL_EVALUATION_MAX_COST_USD` | 5 | Reported provider cost per run |
| `AUTOEVAL_EVALUATION_DAILY_COST_USD` | 25 | Evaluation allowance over the preceding 24 hours |

Each admitted run stores its limits. Execution uses the lower of those stored
limits and the current settings. Admission reserves each active run's entire
dollar allowance, then counts actual trace charges after the run ends. Failed
runs retain their reported charges. An evaluation stops making further provider
calls after reaching its token or dollar allowance.

Token and dollar totals arrive after a provider responds. The final in-flight
response can exceed an allowance. These controls rely on provider usage reports;
set a hard account spending limit at the provider for a billing guarantee.
One-off trace requests do not use the evaluation admission queue or its daily
allowance. They remain within the authenticated or loopback operator boundary.
There is still no durable worker queue or automatic recovery for interrupted
evaluations. A stale queued/running record continues to reserve capacity until
an operator resolves it, rather than silently permitting more spending.

## Trace redaction and retention

All trace and span persistence passes through a shared redactor after each
system's existing domain projection. It masks credential fields, configured
provider and hosted passwords, common token formats, credential-bearing URLs,
email addresses, and named personal-data fields. Provider error response bodies
are excluded. Scoring uses the original domain output in memory; stored
evaluation expected/actual copies use the same redaction as traces.

This is a set of concrete redaction rules, not a guarantee that arbitrary free
text contains no personal information. Review inputs and ground truth before
saving sensitive data. The redactor does not change provider-bound business
inputs or rewrite finalized datasets and immutable snapshots.

`AUTOEVAL_TRACE_RETENTION_DAYS` defaults to 30 and must be positive. Startup and
hourly maintenance remove expired completed/failed traces and their spans in
batches. Running traces, recent traces, and traces referenced by datasets,
evaluation results, or snapshots are retained. Those references preserve
reviewed examples and immutable provenance; their data needs a separate retention
decision. New redaction rules apply to new trace writes, not historical records.

Preview deletion counts without changing data:

```bash
.venv/bin/python -m autoeval_api.services.trace_retention
```

Apply the configured retention policy immediately:

```bash
.venv/bin/python -m autoeval_api.services.trace_retention --apply
```

## CLI cleanup and credentials

CLI providers remain disabled by default and unavailable in production. POSIX
CLI processes start in a separate process group. Output overflow, timeout, and
request cancellation stop the group and drain stdout/stderr without retaining
them. Cleanup has a separate five-second deadline, so an unread pipe cannot
hold the evaluation execution lock indefinitely.

Hosted Basic authentication compares UTF-8 bytes. Non-ASCII invalid credentials
receive HTTP 401; a valid Unicode password can authenticate.

## Development dependencies

Vitest 5 removes the vulnerable Tinypool and old mocker dependencies. A targeted
`@typescript-eslint/typescript-estree` override uses patched minimatch 11 until
the upstream package raises its dependency range. Lint, typechecking, and unit
tests exercise that override. The frontend declares Node 22.12, Node 24, or
Node 26 and newer to match Vitest's supported engines.

`make setup` upgrades pip to at least 26.2 and installs pytest 9.0.3 or newer with
pytest-asyncio 1.4 or newer. Refresh existing environments with `make setup`.
