# AutoEval application feed (unpublished 0.1.0)

A Node ESM package for **importing after app-owned inference**, with an authenticated
local receipt service. No model gateway, subprocess runner, provider key, framework
instrumentation, app-specific schema, import-time network call or background exporter.

This is a local metadata feed, separate from the existing FastAPI workbench. It does
not add observations to the workbench UI or its finalized datasets. Hosted Postgres,
SSO, raw-content replay and Python packaging are not implemented. Node >=22.22.1 is
required; only Node 24.22.1 was tested in this change. The local server uses
`node:sqlite`, which is experimental on some supported Node releases.

## Build and consume without publishing

```sh
npm test
npm pack --pack-destination /tmp
# In a consumer, install the exact locally built artifact:
npm install /tmp/devalparikh-autoeval-0.1.0.tgz
```

`prepack` builds `dist` from dependency-free ESM and declaration files. The archive
contains only `dist`, this README and package metadata; no tests, database, tokens,
application source, fixture content or environment files. There are no consumer
install scripts. `private: true` prevents accidental registry publication; the
repository currently has no declared open-source license. An approved license,
namespace ownership and publication decision must precede public distribution.
The intended public name is `@devalparikh/autoeval`, subject to registry ownership.
Use an access-restricted registry if private distribution is approved instead.
Never overwrite a published version. Patch for compatible fixes, minor for additive
opt-in features, major for incompatible API changes; wire `schemaVersion` versions
independently and retain v1 readers. Pin exact artifacts and lockfile integrity.
A pip client is deferred until a real Python consumer needs it; the JSON contract
is language-neutral, but cross-language hash compatibility has not been tested.

## App capture

```js
import { createCapture } from "@devalparikh/autoeval";
const capture = createCapture(); // disabled, no credentials or network required
// After approval, pass enabled, endpoint, ingest token, registered experimentId,
// source and an exact { metrics: [...], checks: [...] } projection policy.
// await capture.capture({ consent, startedAt, endedAt, caseId, project: () => ({
//   metrics: { model_calls: 1 }, checks: { validated: true }
// }) });
```

Only the application's trusted server may use capture. Obtain current explicit
consent from the authenticated account outside model arguments, map it to a random
grant ID locally and check revocation before capture. An admin separately registers
the matching grant in the receiver. Synthetic grants are fixture authorization,
**not user consent**. Do not grant an application admin credentials.

The SDK evaluates `project()` only after enablement and consent checks. Projection
must return exactly numeric/null metrics and boolean/null checks with the approved
keys. Free text, user/request/session IDs, tool arguments/results, prompts, tokens,
account state and arbitrary labels are not allowed. Null means unknown, not zero
or pass. Redaction is structural omission, not a promise that a PII regex is enough.
App operators still must review metric semantics: a number can encode private data.
Do not hash identities or sensitive low-entropy text and call it anonymization.

One explicit awaited call, at most two seconds (500 ms default), no buffering or
retries. A dropped observation is reported as `dropped`; caller-owned counters may
record that status without raw errors. Delivery is best effort, not an outbox.
Serverless code must await completion inside its request; no flush-on-exit promises.
Do not retry the SDK call blindly (it generates a new ID). The HTTP contract accepts
exact-body duplicate IDs and rejects conflicting duplicates.

## Receiver and contract

```js
import { startFeed } from "@devalparikh/autoeval/server";
// await startFeed({ path: privateSqlitePath, projects, principals });
```

The receiver binds **127.0.0.1 only**, with a separate SQLite file in a caller-created
private directory. It is for low-volume local development or a supervised dedicated
host accessed locally. Do not deploy this SQLite service to Vercel or expose it via
a public proxy. The SDK accepts HTTPS for a future compatible hosted receiver.
Ingestion has no inference dependencies or access to the workbench database.

Each credential is bound to one project and exactly one role:

- Admin: `POST /v1/datasets`, `POST /v1/experiments`, `POST /v1/grants`,
  `DELETE /v1/grants/{id}`.
- Ingest: `POST /v1/traces` only.
- Read: `GET /v1/traces/{id}`, `GET /v1/comparisons/{left}/{right}` only.

Tokens are injected in process memory, never persisted; use independent random
32-byte base64url values. Authorization precedes body reads; requests with browser
Origin/Fetch metadata are denied. Exact shapes, 16 KiB streamed body limit, short
timeouts, 120 authenticated requests/minute/credential, 32 connections and 10,000
records/type/project bound this local service. They are not a public DDoS control.
Project policies persist and cannot silently widen on restart. Use a new project
for incompatible projection changes. Tokens rotate by restarting with new keys.

Datasets register immutable sorted case-ID hashes plus a rubric hash; returned
SHA-256 is over sorted-key canonical JSON. Actual fixtures/rubrics stay in the app's
versioned repository. This is a finalized manifest, not the FastAPI dataset model.
Experiments pin a full Git revision, prompt/config hashes, optional graph hash,
declared model, mode (`scripted`, `live`, `observed`) and finalized dataset hash.
Observed traffic must have null dataset/case IDs. New code, prompt, loop config,
model or graph means a new experiment ID; conflicting registration returns 409.
No server runs uploaded code, reconstructs a graph or invokes a model.

Traces contain schema/version IDs, grant, source, timestamps, terminal/partial
status and the projected metrics/checks. Model provenance is declared, not attested.
A dataset-bound trace must match a registered case and use synthetic source in v1.
Comparison requires the same finalized manifest and mode, exactly one observation
per case per experiment, and reports named checks including nulls and error/partial
status. Missing, expired or duplicate case evidence rejects comparison (409).
This is paired structural evidence, not a statistical or model-quality estimate.

## Lifecycle and limits

Default TTL is 24 hours, configurable to at most 30 days. Expiry is the earlier of
event start + TTL or grant expiry; duplicate imports never extend it. Purge runs at
startup, every minute and before reads. Withdrawals erase all observations for the
grant in one transaction and retain an opaque revocation tombstone; renewal needs
a new grant ID. Experiments and dataset manifests retain non-personal digests/IDs;
no trace content is copied into them. SQLite secure-delete removes deleted cell
content; backups, filesystem snapshots and storage remanence need an operator
policy. Do not promise physical erasure from unmanaged backups.

Production source is refused by default. `allowProduction` is an operator gate,
not consent or deployment approval. A real pilot additionally requires approved
source projection, authenticated opt-in, account-to-grant mapping and withdrawal,
retention/backups, protected durable hosting, access review and separate approval
for any live/judge calls. Lifty's first integration also blocks production capture
in its own code. This package contains no production records or credentials.
