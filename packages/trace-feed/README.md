# AutoEval SDK

Server-only capture for apps that own their model and tool calls. Requires a backend with app-directed capture for the new entry point. Candidate `0.3.0-private.1`, licensed under [MIT](LICENSE).
No dependency on an agent framework, background exporter or
provider. Node.js 22.22.1 or later.

Create an application in AutoEval by naming it and choosing a key lifespan. Keep
its key in the app's backend environment. The SDK registers immutable policies and
experiment fingerprints automatically; no console snippets or manual experiment
IDs. Production capture defaults on, retention defaults to **Keep**, and the first
policy establishes content permissions. Those are editable app settings. Later
content categories require enablement in instance settings. The client application decides which runs and fields to send.

```ts
import { artifactHash, createTraceClient, type Policy } from '@devalparikh/autoeval';

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

const capture = createTraceClient({
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

const run = capture.begin();
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
including registration and ingestion. Do not await it before sending the
reply or before closing SSE. Use Next.js `after` or the host's supported request
lifecycle extension; an untracked promise can be killed by serverless runtimes.
Invalid configuration returns an inert capture object; network failures return a
small status and never throw into the app. The SDK does not retry or queue traces.

## Grade a trace

The SDK and portal both call it a **grade**. Save the trace ID with the agent’s
reply. Once the trace has been accepted, Lifty can send a decision at any time:

```ts
await capture.grade({ traceId, value: false });
```

Omit the call to leave the trace Ungraded. For a summary-only trace,
`createTraceClient({ experiment })` needs no policy or metric definitions. Boolean is the default. For delayed
feedback, pass `occurredAt` in Unix milliseconds. For a retryable job, reuse its
UUID as `id`. A later decision appends a revision. The Grade column shows the
latest event by occurrence time. Open it to see history.

Other applications can set `grade` when calling `createTraceClient`:

```ts
grade: { kind: 'multi_select', choices: ['correct', 'concise'] }
```

Supported kinds are boolean, number, category, multi_select and json. JSON
uses `contentField` to reference an existing content declaration. An optional
`reason` is stored as diagnostic conversation content when permitted and
within retention. An admin can load diagnostic content in the trace inspector.
Change `version` when the business rule changes meaning, even if the type stays
the same. Changing the shape changes its definition ID automatically.

## Existing integrations

Deploy the updated backend before switching clients. Older instances reject grant-free traces.
New clients make no grant registration or withdrawal calls. The legacy
`createCaptureFromEnv` and `createCapture` entry points retain their grant checks.
Complete outstanding withdrawals and delayed outcomes for grant-bound records with
the original integration. Existing Lifty deployments can migrate independently.

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
// After a later apply/dismiss request succeeds, using the saved trace reference:
after(() => capture.outcome({
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

Connection results are cached per process for one minute, with bounded
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

Maintainers: see [SDK publishing](../../docs/sdk-publishing.md) for automatic
publication after an explicitly approved merge to `main`, version bumps, registry
access prerequisites, verification and the Actions manual fallback.

Capture limits: up to 128 steps and 96 KiB of serialized step data, with
`droppedSteps` reporting omissions; up to 128 KiB total optional content and
64 KiB per content field. Recursive content validation stops at 2,048 values or
128 KiB of strings per field before redaction/copying. These bounds keep the
summary inside the 256 KiB ingest limit. Lazy projection callbacks are app code:
keep them synchronous and bounded, and do not perform I/O or arbitrary deep
cloning inside them. The SDK's abort deadline cannot preempt a blocking app callback.
