# AutoEval SDK

Server-only capture for apps that own their model and tool calls. Requires the
capture-v2 backend. Candidate version `0.2.0-private.1`; publication is a separate
operator action. No dependency on an agent framework, background exporter or
provider. Node.js 22.22.1 or later.

Create an application in AutoEval by naming it and choosing a key lifespan. Keep
its key in the app's backend environment. The SDK registers immutable policies and
experiment fingerprints automatically; no console snippets or manual experiment
IDs. Production capture defaults on, retention defaults to **Keep**, and the first
policy establishes content permissions. Those are editable app settings. Later
content categories require app permission and explicit user consent.

```ts
import { artifactHash, createCaptureFromEnv, type Policy } from '@devalparikh/autoeval';

const policy = {
  schemaVersion: 2,
  metrics: { latency_ms: { semanticId: 'run.latency', definitionVersion: 1, unit: 'ms', min: 0 } },
  checks: { validated: { semanticId: 'reply.valid', definitionVersion: 1, expected: true } },
  steps: { read_records: { attributes: { rows: { type: 'integer' } } } },
  outcomes: { proposal_decision: { attributes: {
    decision: { type: 'string', enum: ['applied', 'dismissed', 'stale'] },
  } } },
  content: { conversation: { category: 'conversation', valueSchema: { type: 'string', maxLength: 8000 } } },
} satisfies Policy;

const capture = createCaptureFromEnv({
  policy,
  experiment: {
    revision: { kind: 'git-sha1', value: buildCommit },
    promptHash: artifactHash(systemPrompt),
    configHash: artifactHash(reviewedStaticConfig),
    graphHash: null,
    models: [{ role: 'trainer', provider: 'openrouter', model: configuredModel }],
  },
  redactorVersion: artifactHash(reviewedRedactorSource),
});

// Resolve from the authenticated user's saved choice; default is undefined/off.
// grantId is a random, durable UUID, never the user's ID or an ID hash.
const run = capture.begin({ consent: savedConsent });
run.step({ id: 'read_1', kind: 'tool', name: 'read_records', status: 'ok', attributes: { rows: 3 } });
// Persist run.reference with the app's saved reply for later outcomes.
// Schedule AFTER the complete SSE/JSON response using the host lifecycle hook.
after(() => run.end({
  status: 'ok', metrics: { latency_ms: 420 }, checks: { validated: true },
  content: () => ({ conversation: appRedactedConversation }),
}));
```

`begin` and `step` are local and synchronous. `end` is single-use and performs at
most one attempt per operation, within one total deadline (default/max 2 seconds),
including registration, grants and ingestion. Do not await it before sending the
reply or before closing SSE. Use Next.js `after` or the host's supported request
lifecycle extension; an untracked promise can be killed by serverless runtimes.
Invalid configuration returns an inert capture object; network failures return a
small status and never throw into the app. The SDK does not retry or queue traces.

## Consent

Consent is app-owned, per user and **off by default**. There is no SDK environment
allowlist or portal list of user identities. The app must load consent server-side
after authenticating the caller; never trust a boolean from a request body.

```ts
const savedConsent = {
  granted: true,
  id: opaqueGrantId,
  categories: ['conversation', 'workout_records', 'body_scans'],
  expiresAt: null,
};
```

Missing, false, expired or locally withdrawn consent produces no reference, steps,
content projection or network requests. The instance independently requires an
active grant. New consent categories require a new grant ID; immutable grants
cannot be widened in place. Revoke the previous grant if the user withdraws or
narrows consent. Revocation deletes its evidence and leaves a non-content
tombstone. Store the user's disabled setting first, call
`capture.withdraw({ grantId })`, and retain a durable pending-withdrawal record
until `status: 'revoked'` is confirmed. An outage must not silently discard a
privacy deletion. This reconciliation is app work, separate from trace retries.

## Content and outcomes

The app first removes names, user/session/message IDs, dates of birth, locations,
URLs, contact information and domain identifiers. Allowlist selected evidence;
never hand the SDK whole database rows, provider requests, errors or tool outputs.
Declare exact shapes and a digest of the reviewed app redactor. The SDK performs a
bounded second identifier pass before sending; ingest performs a final backstop.
Redacted workout or health information is still sensitive, not anonymous.

Content failures omit the affected fields and report coverage. Numeric unknowns
stay `null`, including unreported cost. Operational step/outcome attributes allow
only numbers, booleans, declared enum strings or null, not arbitrary text.

```ts
// After a later apply/dismiss request succeeds, using its freshly loaded consent:
after(() => capture.outcome({
  consent: savedConsent,
  reference: savedReply.captureReference,
  id: durableEventId,
  name: 'proposal_decision',
  attributes: { decision: 'applied' },
}));
```

The SDK resolves the original policy when a delayed event refers to an older
deployment. It can read its own immutable declarations, never stored trace
content. Outcome names and attributes must match that original declaration;
unsupported later event kinds are skipped, not reinterpreted. Preserve stable
outcome semantics when evolving the agent. Expired/withdrawn traces cannot accept
new events. Duplicate event IDs are idempotent; changed reuse is refused.

## Environment

| Variable | Value |
| --- | --- |
| `AUTOEVAL_ENABLED` | `true` to enable; absent means off |
| `AUTOEVAL_ENDPOINT` | `https://INSTANCE/api/backend/v2/traces` |
| `AUTOEVAL_INGEST_KEY` | The one app-scoped backend key |
| `AUTOEVAL_SOURCE` | `production` for real users, `synthetic` for controlled fixtures |
| `AUTOEVAL_REQUEST_TIMEOUT_MS` | Optional 10–2000; default 2000 for the entire capture |
| `AUTOEVAL_NPM_TOKEN` | Build-only GitHub Packages read token; never a browser/runtime secret |

Policy, experiment and redactor identities are declared in code, not new env vars.
Remove `AUTOEVAL_EXPERIMENT_ID`, `AUTOEVAL_GRANTS_KEY`,
`AUTOEVAL_CONSENTED_USER_IDS` and the instance's
`AUTOEVAL_FEED_ALLOW_PRODUCTION`. There is no compatibility with the old SDK,
`/v1` ingestion or the `@devalparikh/autoeval/server` receiver. Existing local
AutoEval development remains supported by the FastAPI backend.

Connection and grant results are cached per process for one minute, with bounded
maps and concurrent work. Ingest always enforces current settings and revocation.
401 disables further sending for that SDK instance; deploy the replacement key and
reinitialize. Explicit portal rotation can keep the old key valid until its chosen
retirement time. There is no grace period after expiration or revocation.

Pin the approved package version and commit the app lockfile. Use `npm ci`, with an
`.npmrc` that references `${AUTOEVAL_NPM_TOKEN}` instead of containing a token:

```ini
@devalparikh:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${AUTOEVAL_NPM_TOKEN}
```

Build/test locally with `npm run test:package`; this packs and offline-installs a
consumer to validate exports. Never publish or deploy as part of a test.

Capture limits: up to 128 steps and 96 KiB of serialized step data, with
`droppedSteps` reporting omissions; up to 128 KiB total optional content and
64 KiB per content field. Recursive content validation stops at 2,048 values or
128 KiB of strings per field before redaction/copying. These bounds keep the
summary inside the 256 KiB ingest limit. Lazy projection callbacks are app code:
keep them synchronous and bounded, and do not perform I/O or arbitrary deep
cloning inside them. The SDK's abort deadline cannot preempt a blocking app callback.

Consent generation ownership: the app retains a ledger of every active grant for
each user. Widening may keep older generations/history, but full withdrawal must
revoke all of them. Narrowing conservatively revokes all prior generations and
erases their evidence. A delayed outcome uses its reference's original grant,
resolved under the authenticated user's current enabled/scoped choice; a new grant
ID cannot be substituted for an older trace's grant.
