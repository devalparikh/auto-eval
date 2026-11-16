# Lifty trainer integration

This is the handoff for the deval-blog owner. It replaces the unmerged PR 41
stopgap, examined at `b9a67753cade8f5291802467beec43b7322df4dd`, with trainer context
from main `b2f9864`. No deval-blog files or instance settings are changed by this PR.
Use the approved SDK candidate only after its separate publication and the instance's
separate rollout. A new SDK against an old instance safely drops capture; it does
not provide a compatibility path.

## What Deval sets

1. In AutoEval `/applications`, enter **Lifty** and choose the key lifespan. Copy
   the one-time key to Lifty's backend. No manifest, policy entry or console snippet.
2. App defaults are production **on**, retention **Keep**, and first-policy content
   categories accepted automatically. `/applications/{id}/settings` changes these
   later. New categories after that first policy stay off until enabled and consented.
3. In Lifty's Vercel environment, set:

| Variable | Value |
| --- | --- |
| `AUTOEVAL_ENABLED` | `true`; missing/anything else disables capture |
| `AUTOEVAL_ENDPOINT` | `https://INSTANCE/api/backend/v2/traces` |
| `AUTOEVAL_INGEST_KEY` | The one app-scoped key, server-only |
| `AUTOEVAL_SOURCE` | `production` for real users; separate synthetic test deployments use `synthetic` |
| `AUTOEVAL_REQUEST_TIMEOUT_MS` | Optional; default/max `2000` total, no retries |
| `AUTOEVAL_NPM_TOKEN` | Build-only GitHub Packages read token |

Keep all secrets out of `NEXT_PUBLIC_*`, browser code, logs and screenshots.
`AUTOEVAL_INGEST_KEY` retains its name. Remove `AUTOEVAL_EXPERIMENT_ID`,
`AUTOEVAL_GRANTS_KEY` and `AUTOEVAL_CONSENTED_USER_IDS`. The instance removes
`AUTOEVAL_FEED_ALLOW_PRODUCTION`; app settings replace it. There are no new
instance env variables for capture. Existing backend database/auth/runtime-role
settings remain as documented in [the hosted contract](hosted-client-contract.md).

4. Pin `@devalparikh/autoeval@0.2.0-private.2` after approval/publication, commit the
   lockfile, and install with `npm ci`. Keep the checked-in `.npmrc` token-free:

```ini
@devalparikh:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${AUTOEVAL_NPM_TOKEN}
```

This MIT-licensed SDK release preserves the capture-v2 API. The instance consumes
its own pinned server bundle, not this npm package; no instance pin or migration
change is needed for this SDK license update.

5. In Lifty's new per-user privacy setting, Deval explicitly opts in to redacted
   conversation, selected workout evidence and body scans. Every user starts off.
   A private instance or an app key alone is never consent.

## Consent and correlation: Lifty-owned changes

Add a server-owned per-user consent setting and a grant-generation ledger: enabled (default false), a random UUID
for this grant generation, allowed category names, optional expiry, and an audit of
the user's choice. Resolve it only after `requireUser`; never accept consent from
trainer request bodies or model arguments. The UUID is not the user ID, an email,
or a hash of either. Keep the mapping and every still-active grant generation in Lifty; AutoEval sees
only opaque grants. Widening can retain older generations so their historical
traces remain available.

```ts
const consent = preference.enabled ? {
  granted: true,
  id: preference.grantId,
  categories: preference.categories,
  expiresAt: preference.expiresAt, // null means no scheduled expiry
} : undefined;
const run = capture.begin({ consent }); // local only; no consent => no reference
```

Persist `run.reference` in `fitness_messages.metadata.autoeval` with the saved reply
(and with request state for failures where no reply exists). It contains opaque
`traceId`, `policyVersion`, `experimentId` and `grantId`, generated locally before
sending. Do not send Lifty's request, session, question, message or user IDs. Use the
local mapping for confirmation and clarification links. A reference means an
attempt was prepared, not that AutoEval accepted it; best-effort drops are expected.

Withdraw/narrow consent by saving the disabled/narrowed choice first, stopping new
capture, and durably recording pending deletion of **every still-active grant generation**
for that user. Narrowing conservatively erases all previous generations too; it is
not a promise of selective removal of only newly excluded fields. Call
`capture.withdraw({grantId})` after the response and reconcile until it returns
`{status:'revoked'}`. A timeout/outage must not lose that pending deletion. This is
privacy-request reconciliation, not a trace retry/exporter. Revoked IDs stay revoked.
New category consent uses a new grant UUID; ordinary policy changes within existing
categories reuse the grant. Full withdrawal must visit the entire generation ledger,
including grants retained after earlier widening. Before sending a long-running request's trace, re-read
current consent with a bounded app DB lookup; missing/unavailable/revoked means skip.
Previously captured or in-flight evidence is deleted when withdrawal reaches the
instance; do not claim an offline instance has already erased it.

## Declare the trainer in code

Initialize once per server process/module. Missing/invalid env disables the SDK
without throwing. Use the actual build commit, static system prompt, configured
model and a stable serialization of budgets/read policy/retry/rewrite configuration.
Do not hash per-user seeds, workout rows or provider keys into experiment identity.
A redactor digest identifies the reviewed projection code, not an assertion that
regexes provide anonymity.

```ts
import { artifactHash, createCaptureFromEnv, type Policy } from '@devalparikh/autoeval';

const number = { type: 'number' } as const;
const integer = { type: 'integer' } as const;
const boolean = { type: 'boolean' } as const;
const enumOf = (...values: string[]) => ({ type: 'string' as const, enum: values });
const metric = (semanticId: string, unit = 'count') =>
  ({ semanticId, definitionVersion: 1, unit, min: 0 });
const check = (semanticId: string, expected: boolean | null) =>
  ({ semanticId, definitionVersion: 1, expected });
const modelStep = { attributes: {
  round: integer, input_tokens: integer, output_tokens: integer, cost_usd: number,
} };

export const trainerPolicy = {
  schemaVersion: 2,
  metrics: {
    latency_ms: metric('trainer.latency', 'ms'),
    model_requests: metric('trainer.model_requests'),
    record_reads: metric('trainer.record_reads'),
    proposed_changes: metric('trainer.proposed_changes'),
    reported_exercises: metric('trainer.reported_exercises'),
    provider_attempts: metric('trainer.provider_attempts'),
    settle_rejections: metric('trainer.settle_rejections'),
    cost_usd: metric('trainer.cost', 'usd'),
  },
  checks: {
    reply_validated: check('trainer.reply_validated', true),
    timed_out: check('trainer.timed_out', false),
    asked_clarification: check('trainer.asked_clarification', null),
    workout_review: check('trainer.workout_review', null),
    read_budget_exhausted: check('trainer.read_budget_exhausted', false),
    persistence_ok: check('trainer.persistence_ok', true),
    quantity_preserved: check('trainer.quantity_preserved', true),
  },
  steps: {
    retrieval_model: modelStep,
    final_model: modelStep,
    reply_submission: modelStep,
    recovery_model: modelStep,
    tighten_model: modelStep,
    provider_attempt: { attributes: {
      phase: enumOf('retrieval', 'final', 'settle', 'recovery', 'tighten'),
      attempt: integer,
      failure_kind: enumOf('none', 'timeout', 'rate_limited', 'transport', 'invalid_reply', 'other'),
    } },
    read_records: { attributes: {
      resource: enumOf('profile', 'gyms', 'exercises', 'routines', 'routine_exercises',
        'sessions', 'sets', 'session_exercises', 'session_items', 'body_weights', 'body_scans', 'messages'),
      rows: integer, bytes: integer, has_more: boolean,
    } },
    read_fitness_options: { attributes: { bytes: integer } },
    validate_actions: { attributes: { accepted: boolean, rejected_count: integer } },
    tighten_decision: { attributes: { kept: boolean, quantity_preserved: boolean } },
    save_reply: { attributes: { proposed_changes: integer, reported_exercises: integer } },
  },
  outcomes: {
    proposal_decision: { attributes: { decision: enumOf('applied', 'dismissed', 'stale') } },
    clarification_answered: { attributes: { answered: boolean } },
    reported_activity_saved: { attributes: { count: integer } },
  },
  content: {
    conversation: { category: 'conversation', valueSchema: {
      type: 'array', maxItems: 10, items: { type: 'object', properties: {
        role: enumOf('user', 'assistant'), text: { type: 'string', maxLength: 8000 },
      } },
    } },
    workout_evidence: { category: 'workout_records', valueSchema: {
      type: 'array', maxItems: 32, items: { type: 'object', properties: {
        exercise: { type: 'string', maxLength: 80 }, reps: integer, load: number,
        unit: enumOf('kg', 'lb'), age_days: integer,
      } },
    } },
    body_scan: { category: 'body_scans', valueSchema: {
      type: 'object', properties: {
        weight_kg: number, lean_mass_kg: number, body_fat_percent: number, age_days: integer,
      },
    } },
  },
} satisfies Policy;

export const capture = createCaptureFromEnv({
  policy: trainerPolicy,
  experiment: {
    revision: { kind: 'git-sha1', value: buildCommit },
    promptHash: artifactHash(trainerSystemPrompt),
    configHash: artifactHash(stableTrainerConfigJson),
    graphHash: null, // this agent is a loop, not an invented DAG
    models: [{ role: 'trainer', provider: 'openrouter', model: configuredModel }],
  },
  redactorVersion: artifactHash(reviewedProjectionSource),
});
```

All defined operational attributes must be present, using `null` when not measured.
Provider attempts can be root steps with a phase attribute; do not refer to a model
parent that has not yet been recorded. Tool steps may refer to the preceding completed
retrieval step.
Do not use zero to represent unknown tokens/cost. `asked_clarification` and
`workout_review` are descriptive checks (`expected:null`), not success criteria.
Raw rejection text and provider errors are never step attributes. Add a declared
reason enum later if useful; keep its mapping versioned. Instrument actual provider
attempts separately from logical model requests, and include settle/recovery/tighten
calls in totals. A configured model alias does not prove the provider's underlying
weights; record exact returned model identity when available and mark uncertainty.

## Where to instrument

| Trainer boundary | What to record |
| --- | --- |
| `runTrainerRequest` claim | Start only for `claimed`; completed replays produce no new inference trace. Record admission/rate-limit statistics separately from model-quality denominators. |
| `runTrainerAgent` retrieval loop | Parent/child local step IDs for model turns and tools; resource name, rows, byte counts, budget exhaustion. Never raw arguments/results. |
| `openrouter.ts` | Each actual attempt, duration and sanitized failure kind; preserve the existing transport retry behavior. AutoEval adds no retries. |
| forced final / `settleReply` / `recoverFinalReply` | Distinct step names, rejected submission counts, statuses and durations. |
| optional tighten / `acceptableRewrite` | Whether rewrite was kept and quantities preserved. Compute guards before redaction. |
| `finishRequest` | Persist reply and trace reference, then mark `save_reply`; inference success alone is not completed persistence. |
| final SSE/JSON response | Schedule `run.end` through the request lifecycle after response completion. |

A claimed inference failure (including provider timeout/error or failed persistence)
is `error`/`partial`, not a missing successful sample. A 499 cancellation is
`cancelled`, tracked separately from completed-answer quality. A replay is skipped.
413/429 and claim states such as busy/conflict/pending precede inference; do not
pretend they are model failures. Request IDs and the five recent session IDs from
the seed stay in Lifty. Keep exact seeds/history out of operational fields.

```ts
import { after } from 'next/server';

// During the claimed run; this call has no I/O:
run.step({ id: 'read_1', parentId: 'retrieval_1', kind: 'tool', name: 'read_records',
  status: 'ok', durationMs: 8,
  attributes: { resource: 'sets', rows: 4, bytes: 512, has_more: false },
}); // record retrieval_1 first; parent IDs must already exist

// In the route, use Next.js after(), after the saved reply and SSE/JSON completion.
// Do not await telemetry before returning JSON or closing the SSE stream.
after(async () => {
  if (!await stillConsentedWithinAppBudget(consent)) return;
  const result = await run.end({
    endedAt: requestFinishedAt,
    status: completedStatus,
    metrics: { latency_ms, model_requests, record_reads, proposed_changes,
      reported_exercises, provider_attempts, settle_rejections, cost_usd: measuredCost ?? null },
    checks: { reply_validated, timed_out, asked_clarification, workout_review,
      read_budget_exhausted, persistence_ok, quantity_preserved: measuredQuantityGuard ?? null },
    content: () => projectAndRedactSelectedEvidence(),
  });
  recordCaptureStatusOnly(result.status); // no payloads, keys or remote errors
});
```

Use [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after)
or the host-supported request-lifetime mechanism, not an untracked promise or a
background exporter. Register the callback inside the route. The route’s platform
max duration must leave room for bounded post-response work; `after` does not grant
an unlimited extension. The SDK's registration + grant + send share one deadline, at
most two seconds. App projection/consent lookup code must itself be bounded; the SDK
cannot preempt a blocking callback. Test both JSON and SSE, aborted clients, cold
starts, expired keys and an unavailable instance in the Lifty owner’s deployment.
No telemetry HTTP call belongs on the reply-critical path.

## Later outcomes

Load the saved reference from the authenticated user's message; never accept an
arbitrary trace reference from a PATCH body. Resolve the reference's **original**
grant through that user's generation ledger, require it to remain active, and check
that the user's current enabled choice still covers its categories. Pass that
original grant to `outcome`; passing a newer grant ID fails correlation. Keep a durable random event UUID in
Lifty for each decision so an application retry cannot create duplicate events.
Schedule capture after the application operation; telemetry failure never rolls
back or delays a confirmed workout edit.

```ts
after(() => capture.outcome({
  consent: originalGrantStillConsented,
  reference: message.metadata.autoeval,
  id: decisionEventId,
  occurredAt: decisionTime,
  name: 'proposal_decision',
  attributes: { decision: 'applied' },
}));
```

- Emit **applied** only after `fitness_apply_plan` succeeds. The decision covers the
  whole proposal group; editing before apply is not supported.
- Emit **dismissed** after persistence succeeds; record an event time in Lifty
  because the existing status has no dismissal timestamp. Do not invent a reason.
- Emit **stale** for the 409 confirmation result as an attempted outcome, with its
  durable event ID. It is not currently persisted by the trainer.
- Link **clarification_answered** to the original reply using Lifty's question/message
  mapping. The answer starts a new run; its text is separate consented conversation
  content, not an operational attribute.
- **reported_activity_saved** is known with the reply. Since it is automatic,
  distinguish it from user-confirmed proposals. A later event must be sent only
  after the root capture was accepted; otherwise retain the count in the root.

A pending proposal is **pending**, not ignored. No edited-before-apply event exists.
History corrections are later edit_session/edit_set proposals; they may correct
history rather than an agent mistake. Follow-up classification needs text and a
versioned evaluator; do not label every follow-up a correction. Chat retries have
no reliable causal link today; workout-review retries can be linked locally by
session, but that session ID is not exported. Delayed event kinds must match the
original policy. The SDK retrieves that declaration after a deploy; new event
semantics belong to new traces rather than rewriting older ones.

## Redaction and improving the agent

Project only selected evidence, before calling the SDK. Remove names, email/phone,
user/message/session/routine/gym IDs, addresses, gym locations, birth dates, URLs,
provider keys, device/scan serials, exact timestamps and any third-party identifiers.
Use relative age in days and normalized exercise labels; keep reps/load/units when
needed to assess coaching. Body scans mean selected numeric composition values,
not original scan documents/photos or headers. Exclude raw profile, exercise notes,
`source_notes` and raw messages embedded in tool results from workout objects.
If those notes become necessary, add a distinct category with its own projection,
settings permission and user consent; ordinary schema changes auto-version.

Free text can still reveal injury/medical details, names or distinctive life events.
The SDK's identifier pass and ingest backstop do not reliably anonymize it. Review
Deval's initial captures in the admin content view; disable a category, erase
content or withdraw consent if redaction is inadequate. Keep is the current retention
default, not a privacy guarantee; backups need separate handling. Record exact
quantity-guard results before redaction—edited evidence cannot prove exact fidelity.

Use traces to find tool over-reading, repeated rejected submissions, unnecessary
rewrites, slow provider retries and persistence failures. Combine these with actual
proposal decisions and the portal's versioned human rubric (grounding, request fit,
quantity preservation, safety). Missing evidence means unknown. Applied does not
prove correct; dismissed does not prove wrong. Assessments are append-only and tied
to a rubric hash; no provider is called by ingest or the human review UI.

For an improvement claim, turn consented findings into reviewed, minimized/synthetic
cases, finalize the dataset/rubric, and run both candidates on exactly those cases
in the same mode. Errors/partial runs count as failures and unknown cost stays
unknown. Added/removed/redefined fields are not pooled; only equal semantic IDs,
definitions and units compare. Production observations remain a different source.
Do not backfill `fitness_messages.metadata.retrieval` in this rollout: it lacks
historical consent/projection, some step kinds, exact agent identity and full outcome
coverage. A future backfill needs explicit provenance and cannot masquerade as v2
live instrumentation.

## Owner acceptance checklist

- Consent is off for new/existing users until explicitly granted; missing/false,
  expired, narrowed and withdrawn cases never collect or send unauthorized fields.
- First policy auto-registers; changed prompt/config/model/policy changes the correct
  hash; same declarations stay idempotent. New privacy category leaves summary capture
  running while content is omitted until both settings and consent allow it.
- Cold/warm JSON and SSE responses retain their latency with the instance down, key
  expired, config missing and registration delayed. Each SDK capture ends within its
  total budget; no telemetry retries or raw errors are logged.
- Confirm/replay/clarification/stale/failure paths preserve the mapping and cannot
  duplicate inference or mislabel a failed persistence as a successful reply.
- A synthetic canary reaches the updated instance, shows steps/outcomes/coverage,
  survives key rotation overlap, and disappears on confirmed withdrawal.
