# Application capture architecture

The app owns inference, tools and authentication. AutoEval observes app-selected runs,
stores immutable versions and supports review and controlled evaluations. It is not
an inference proxy or a provider-credential gateway.

```text
App: application chooses a run → SDK begin / steps → save reply + reference
                                                   ↓ after response, ≤2 s
Instance: app key → policy + experiment → trace and optional content
                                                   ↑ later linked outcomes
Portal: name + key lifespan → key; settings and diagnostic review later
```

The SDK hashes normalized policy and experiment declarations locally, producing a
reference before network work. Its first send idempotently registers those versions, then sends the observation within one total deadline. There are no
capture retries, background exporter, manual experiment ID or console snippets.

An app key has one app and expiration/revocation state. App settings independently
control production (on initially), retention (Keep initially) and privacy categories
(first policy accepted; later additions require enablement). The application owns user choices. Schema evolution needs no admin reconfiguration when
the instance already enables the categories. Missing permission omits affected fields.

Observations contain finite numeric metrics, boolean checks, typed operational steps
and optional redacted content. Every field has an explicit meaning. Delayed outcomes
refer to the original policy and trace. Current SDKs can retrieve that policy without
reading stored evidence. Admin-only content is stored separately from ordinary
summaries and can be erased independently. Permanent non-content receipts prevent
resurrection after expiry or deletion. For grant-bound legacy traces, withdrawal still deletes the associated evidence.

Policy/experiment changes create new hashes. Compare shared semantic IDs only when
definitions and units match. Never treat added, removed or unknown measurements as
zero or pass. Production cohorts are diagnostic; controlled comparisons require the
same finalized synthetic cases and mode, with errors/partial runs counted as failures.
Redacted production traces are not automatically replayable or finalized datasets.

The supported local path is FastAPI/SQLite on loopback with synthetic fixtures.
Hosted persistence is PostgreSQL through Vercel/Supabase, with deliberate append-only
migrations and backend-only secrets. The legacy standalone Node receiver and v1 feed
were removed with this integration; the independent application benchmark/runner
workbench remains supported.

AutoEval owns product code and SDK releases. Customer instances, including
`auto-eval-instance`, consume pinned public server bundles. Their owners apply
migrations and rollouts; an SDK change does not upgrade an instance. See
[hosted contract](hosted-client-contract.md), [Lifty integration](lifty-integration.md),
[customer deployment](customer-deployment-contract.md) and [server release](server-release.md).
