# Existing-application evaluation: first working run and long-term architecture

**Status: design proposal, 2026-11-14.** No runtime, SDK, ingestion endpoint,
credential, deployment, or training change is implemented by this document.
The Fitlifty/Lifty pilot is a consumer of a generic contract; its business logic
belongs in `deval-blog`, not AutoEval core.

## Decision

**Get the existing Python-to-Node subprocess working first.** PR24 already makes
this a clean boundary: AutoEval runs and grades the application that exists,
without rebuilding its tool loop as a Python graph. The quick approach is also
the right initial architecture. Building a hosted collector, SDK release, or
queue first would not resolve the current credential blocker or improve the
first synthetic-state experiment.

The smallest useful next step is one frozen live smoke case, one explicitly
selected model, one repetition, and a separately capped evaluation key on a
trusted evaluation machine. It establishes live provider connectivity and a
structural result, **not production tracing or coaching quality**. Keep the
existing offline regressions alongside it. Do not flip the 12 scripted fault
injection cases to live and call that a model benchmark.

The eventual distribution should be **small public Python/TypeScript SDKs plus
an independently runnable open-source AutoEval server/UI**, with local file
export/import as a supported transport. Customers keep their application and
private adapters in their own repository. They should not need an AutoEval fork,
a Python runtime inside their TypeScript app, or a mandatory cloud account.
Managed hosting can be an optional later product. Package distribution and server
hosting are separate decisions; installing an npm package does not supply storage,
a reviewer UI, authentication, or a durable worker.

This proposal is based on `main`, not stacked on PR24: it changes no PR24 files or
contracts and remains useful before either integration merges. References below
pin the examined revisions so proposed behavior is not mistaken for mainline code.

## Evidence and current boundaries

| Evidence examined | Current behavior and implication |
| --- | --- |
| AutoEval main [`ddb702c`](https://github.com/devalparikh/auto-eval/tree/ddb702cd53ef3a9485020b7caa70fabd7c749d6f), [architecture](architecture.md), [extension guide](extension-guide.md), [house rules](../AGENTS.md) | FastAPI/Python execution and persistence, Next.js UI, local SQLite and in-process evaluations. Graph/prompt versions and snapshots are immutable; evaluation datasets must be finalized. Existing external-harness tasks/suites are a separate frozen benchmark path. |
| Main [trace routes](https://github.com/devalparikh/auto-eval/blob/ddb702cd53ef3a9485020b7caa70fabd7c749d6f/backend/src/autoeval_api/api/routes/traces.py) | `POST /api/traces/run` executes a registered graph. It is **not** an external trace ingest API. Do not send Lifty spans there or fabricate graph versions to fit them. |
| Open [PR24](https://github.com/devalparikh/auto-eval/pull/24), head `6b6d53491c5786919abb8f9a50d7ff8d244e2d3b`: [adapter guide](https://github.com/devalparikh/auto-eval/blob/6b6d53491c5786919abb8f9a50d7ff8d244e2d3b/docs/application-agents.md), [retro](https://github.com/devalparikh/auto-eval/blob/6b6d53491c5786919abb8f9a50d7ff8d244e2d3b/docs/lifty-onboarding-retro.md), [runner](https://github.com/devalparikh/auto-eval/blob/6b6d53491c5786919abb8f9a50d7ff8d244e2d3b/backend/src/autoeval_api/application_benchmark.py) | Trusted local JSON stdin/stdout command, separate fixture/candidate revisions, named checks, full case matrices, output hashes. Raw outputs/stderr are not retained in results. Commands inherit the environment; process cleanup is not an OS sandbox. `--config` hashes a non-secret file; it does not inject that file into the adapter request or configure credentials. |
| Open [deval-blog PR36](https://github.com/devalparikh/deval-blog/pull/36), head `979840e45753346805d034e4d4ed852a482f9897`: [integration and evidence](https://github.com/devalparikh/deval-blog/blob/979840e45753346805d034e4d4ed852a482f9897/docs/lifty-autoeval.md), [adapter](https://github.com/devalparikh/deval-blog/blob/979840e45753346805d034e4d4ed852a482f9897/scripts/autoeval-lifty.ts) | Calls the real trainer, provider parser and account-scoped reader using synthetic state. Recorded baseline 9/12 and candidate 12/12 are offline injected-response regressions, not live model results or an untouched holdout. Live mode rejects a missing key. No production Supabase connection is required. |
| [Issue22](https://github.com/devalparikh/auto-eval/issues/22) and [issue23](https://github.com/devalparikh/auto-eval/issues/23) | Open work: atomic inspect/commit onboarding and capability-driven application UI; bounded live admission, usage/model evidence, reviewed trajectories, holdouts and runtime provenance. These are not implemented guarantees of PR24. |

The default local app has no authentication and **must remain loopback-only**.
Main also contains a separate [guarded Vercel preview](vercel-deployment.md), with
Basic authentication, PostgreSQL, exact hosts/origins and synchronous evaluations.
That is a private single-user preview, not a multi-tenant ingestion service.
Do not expose development mode, disable loopback enforcement, or use a public
tunnel as a shortcut. Read [security controls](security-controls.md),
[current remediation status](security-remediation-status.md), and the preserved
[code](code-security-review.md) and [dependency](dependency-security-report.md)
reviews together: some older prose predates implemented redaction, retention and
admission controls. Those graph-evaluation controls do not automatically govern
the external Node adapter's provider requests.

## What the primary sources teach us

Sources were checked on 2026-11-14. These are architectural inputs, not templates
or claims that each vendor's complete server is open source. No vendor deployment
was benchmarked. Inferences and recommendations are in the final column.

| System | Verified mechanism and distribution | Useful lesson; what not to copy now |
| --- | --- | --- |
| W&B / Weave | W&B documents cloud, dedicated and self-managed server choices in its [official SDK repository](https://github.com/wandb/wandb). [Weave's repository](https://github.com/wandb/weave) describes tracing and evaluations, client instrumentation, an account/API-key quickstart, and a separately developed trace server. | Make instrumentation small and the server replaceable. An open client repository is not proof that every hosted component has the same license. Do not make AutoEval own the customer's agent runtime. |
| Langfuse | [Python/JS SDKs](https://langfuse.com/docs/observability/sdk/overview) support cloud or self-hosted endpoints and OpenTelemetry. Its [self-host architecture](https://langfuse.com/self-hosting) separates web/worker services with PostgreSQL, ClickHouse, Redis/Valkey and blob storage; [core is MIT with additional licensed features](https://langfuse.com/self-hosting/license-key). | A strong example of an independently hostable product with language-neutral capture. Start with a bounded importer; do not import its entire infrastructure for one user. Its [compatibility matrix](https://langfuse.com/docs/compatibility) makes SDK/server coupling explicit: preserve compatibility deliberately rather than assuming “OTel” makes upgrades free. |
| Braintrust | Official [TypeScript](https://github.com/braintrustdata/braintrust-sdk-javascript) and [Python](https://github.com/braintrustdata/braintrust-sdk-python) SDKs provide tracing/evals. TS `Eval` separates data, task and scorers. The official [AWS data-plane module](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane) supports customer infrastructure and documents production-sized resources and a Brainstore license secret. | Keep task execution and evaluation records distinct; customers can retain application execution. Customer-hosted infrastructure does not imply a free, fully open platform or a lightweight localhost install. Verify commercial/control-plane requirements before considering adoption. |
| LangSmith | [Evaluation types](https://docs.langchain.com/langsmith/evaluation-types) distinguish offline experiments from online trace evaluation and offer Python/TS client-side evaluation. [Self-hosting](https://docs.langchain.com/langsmith/self-hosted) is an Enterprise add-on with multiple services and storage dependencies. | Adopt the semantic distinction between scoring an observed run and invoking a candidate. Do not force applications into LangGraph just because AutoEval's built-in runner uses it. Hosted collaboration adds real operational and licensing scope. |
| Inspect | [Inspect](https://inspect.aisi.org.uk/) installs as `inspect-ai`; tasks compose dataset, solver and scorer. [Logs](https://inspect.aisi.org.uk/eval-logs.html) are inspectable artifacts; [rescoring](https://inspect.aisi.org.uk/scoring-workflow.html) can operate on saved outputs. [Sandboxing](https://inspect.aisi.org.uk/sandboxing.html) is an explicit execution facility. | Local execution plus portable evidence is a credible starting product. Rescoring need not rerun an agent. A subprocess is not automatically sandboxed. Inspect is an evaluation framework, not by itself a production trace service. |
| promptfoo | [Custom providers](https://www.promptfoo.dev/docs/providers/) and [Python integration](https://www.promptfoo.dev/docs/integrations/python/) bridge application languages. The [self-hosting guide](https://www.promptfoo.dev/docs/usage/self-hosting/) distinguishes local eval execution from sharing results and warns of SQLite, in-memory job and scaling limits. | A small command adapter can be the cleanest integration. Separate running from uploading. Do not promise production hosting merely because a UI can run in a container. |
| OpenTelemetry | [GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) include model/provider and usage semantics, with development-status attributes. [Version selection](https://opentelemetry.io/docs/specs/semconv/configuration/version-selection/) addresses convention evolution. | Reuse trace/span identifiers and offer an OTLP mapping later; pin semantic convention versions. OTel is transport/instrumentation, not a replay fixture, immutable dataset, grading policy or billing attestation. |

Research limitation: the W&B hosting/OTel documentation and Braintrust product
docs redirected to hosts the research tool could not fetch. The rows above use
accessible official repositories instead; they do not infer current enterprise
pricing, feature parity, or an entirely offline Braintrust control plane.

## Installation and hosting choices

| Choice | First pilot | Long-term fit and tradeoff |
| --- | --- | --- |
| Clone AutoEval and run locally | **Yes**, for the maintainer pilot at pinned revisions, using an authorized existing development environment. | Useful for contributors, but a poor required customer workflow: frontend/backend setup and core updates become their problem. Do not require forks or copying app code into core. |
| Local/self-hosted server release | Use current local setup; no new deployment needed. | Publish a versioned server/UI artifact after packaging is tested. Local single-user mode stays simple; shared hosting needs explicit authorization, durable jobs, operations and data policy. A customer chooses where it runs. |
| Public pip/npm package only | No new package needed for this pilot. `backend/pyproject.toml` defines an installable backend, not evidence of published standalone SDKs. | Publish thin client/exporter packages and a Python runner, not two language implementations of the whole workbench. Packages can export files with no server, but cannot alone provide the complete product. Names remain to be chosen and verified. |
| Private pip/npm package | Keep a private app adapter local to its repo; no registry is necessary. | Reasonable for a customer's private domain library, credentials integration or evaluators. A private generic core creates access/version friction and conflicts with the intended open distribution. |
| SDK + independently hosted server | Target architecture, **not a prerequisite**. | Public protocol and client packages, local/self-hosted server, optional managed service. Same application instrumentation can change export destination; invocation remains separately authorized. |
| Adopt a vendor instead | Possible if immediate production observability is more important than developing AutoEval. | Reduces capture infrastructure work but introduces a second system and possible export/licensing costs. Prefer an optional importer over making a vendor's schema or cloud account mandatory. |

The examined main tree has no top-level `LICENSE`, and the backend package metadata
has no license declaration. A public GitHub repository alone is not a complete
open-source distribution plan. Deval should choose an explicit core/SDK license
and release ownership before publication; this proposal does not silently select
or add one. W&B is a useful integration model, not a licensing template.

## The simplest run and where the key belongs

**Proposed first execution location: Deval's trusted developer machine**, running
both AutoEval on loopback and the Python CLI that launches the Node adapter. This
avoids provisioning a new service and the Boat management session's scheduled
shutdown. A later dedicated evaluation VM/CI worker can replace that machine.
Do not assume this management workspace has an authorized AutoEval checkout or
that the application is registered here; neither is required for this docs PR.

The current key/config names are source-verified, not proposed aliases:

| Consumer | Exact current configuration | Where it must be available |
| --- | --- | --- |
| AutoEval built-in Python OpenRouter provider | `OPENROUTER_API_KEY`, explicitly aliased to `Settings.openrouter_api_key`; settings read `.env` / `../.env`. `AUTOEVAL_OPENROUTER_API_KEY` is not the documented alias. [Source](https://github.com/devalparikh/auto-eval/blob/ddb702cd53ef3a9485020b7caa70fabd7c749d6f/backend/src/autoeval_api/config.py) | Backend process only, if that process makes provider calls. |
| PR36 standalone eval adapter | `process.env.OPENROUTER_API_KEY || process.env.openrouter_api_key`, uppercase first. The adapter uses the protocol's `model`, supplied by CLI `--model`; it does not use `OPENROUTER_MODEL`. [Source](https://github.com/devalparikh/deval-blog/blob/979840e45753346805d034e4d4ed852a482f9897/scripts/autoeval-lifty.ts) | Parent eval CLI process environment inherited by Node, on the evaluation machine. Loading a key into Python's settings object is not exporting it into Node's environment. The standalone script does not load Next.js `.env.local`. |
| Production Lifty inference factory | `openrouter_api_key || OPENROUTER_API_KEY`, lowercase first; `FITNESS_INFERENCE_PROVIDER` defaults to `openrouter`; `OPENROUTER_MODEL` defaults to `openai/gpt-6-luna` at the examined revision. [Source](https://github.com/devalparikh/deval-blog/blob/979840e45753346805d034e4d4ed852a482f9897/src/lib/fitness-app/inference/index.ts) | Existing Lifty server runtime only (deployment environment if hosted). This is a separate production key. The default is not a recommendation for the evaluation model. |

Set only the canonical uppercase variable in the evaluation process and ensure a
stale lowercase value cannot select a different key. Use the operator's secret
manager/process injection; do not put values in argv, manifests, JSON settings,
results, source control, browser storage or any `NEXT_PUBLIC_*` variable. A
read-only result receiver needs no OpenRouter key. Future model-judge workers
need their own restricted provider access; ingestion should not grant it.

**Recommended pilot allowance: a fresh evaluation-only OpenRouter key capped at
USD 5 total with no reset**, short expiry, one active runner, and revocation after
the pilot. This is a proposed ceiling for Deval to approve, not configured spend
or an estimate of necessary cost. Do not reuse production Lifty's key or install
a management key in the runner. OpenRouter documents `limit` in USD,
`limit_reset: null` for no reset, `expires_at`, and `include_byok_in_limit`; if BYOK
is used, include it in the limit and separately control the upstream account.
[Primary key API reference](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys).

PR24 does not enforce a live provider dollar/call budget or persist provider usage
from this adapter. AutoEval's `AUTOEVAL_EVALUATION_MAX_COST_USD` and daily limits
apply to its built-in evaluation path, not arbitrary child-process HTTP calls.
A timeout stops the local process but cannot undo an already billed request.
Therefore use the provider cap, a single supervised smoke case and no automatic
reruns now. Keep unknown usage/cost null; a key-level usage delta is operational
reconciliation, not proven per-case cost. Issue23 should add preflight readiness,
per-call/retry admission, output-token bounds, cancellation and provider identity/
usage capture before unattended or larger batches. Do not wait for an entire SDK
platform to implement those small runner protections.

Suggested sequence after the integration code is approved:

1. Use clean, pinned AutoEval and application revisions with installed Python/Node
   dependencies. Keep generated results outside the candidate tree. Record runtime
   versions and dependency lock/install hashes alongside the run.
2. Confirm the offline adapter still runs. Preserve its frozen suite and receipts.
3. Create a **new** one-case live manifest with synthetic state and relevant checks
   (for example no writes and unchanged state); inspect it, onboard it, and record
   the returned frozen suite ID. Choose the exact tool-capable provider model slug.
4. Inject the capped eval key into the CLI process; verify presence without printing
   it and verify the provider-side limit. No key has been checked or configured by
   this design work. Run with `--mode live`, that suite/model, and a short explicit
   timeout using the PR24 command pattern. The blocking prerequisite is the key;
   a suitable live fixture and operator model/budget choices are also required.
5. Inspect the saved result before repeating any paid work. Label it “live provider,
   synthetic state”; do not claim production auth/RLS, production latency or coaching
   quality. A separate rubric and reviewed holdout are the next quality experiment.

## Subprocess and hosted alternatives, concretely

| Route | What it actually tests | Constraints and decision |
| --- | --- | --- |
| Python launches Node importing the real trainer | Application orchestration with synthetic reads, live or injected inference. | **Use first.** Already implemented by the open PRs; no HTTP endpoint, new hosting or Python port of Lifty. The subprocess is trusted local execution with environment access and shared working directory. Use isolated execution later for mutating/untrusted apps. |
| A local subprocess calls the hosted Lifty HTTP app | Real request/auth/storage path and hosted runtime; a distinct integration test. | Feasible, but requires an app-owned HTTP adapter and an authorized synthetic test account/environment. Current trainer POST authenticates, enforces trusted requests and saves conversations; PATCH applies/dismisses proposals. Do not treat it as a read-only provider API or bypass its checks. Pin deployment ID/commit, use request IDs and classify client timeouts as uncertain rather than blindly retrying paid calls. |
| Run the subprocess *inside* the hosted app | Couples evaluation lifetime and credentials to a user-facing function. | Node can run suitable packaged code, but availability of Python, Git, Node dependencies and a clean candidate tree must be established; PR24 expects that tree. Edge is not a substitute runtime. Function termination is not durable job completion. This is more integration work than calling the existing trainer directly from an evaluation runner. Do not expose a remote command-launch endpoint. |
| Separate Vercel evaluation project | A pinned hosted synthetic app can test deployment-specific behavior without touching the production app. | Reasonable **second step if hosted fidelity is the question**. Reuse a private project with immutable deployments per candidate before creating a project per trial. Use a dedicated eval key, synthetic storage/test account or injected reader, protected fixed-purpose endpoint, and bounded synchronous cases. Project separation alone does not isolate shared Supabase data or keys. |
| Host AutoEval itself on Vercel | Hosted review and supported synchronous built-in evaluation. | Main's guarded preview already exists; it needs PostgreSQL, HTTPS/Basic auth and deployment protection. PR24's CLI intentionally accepts loopback API URLs, so remote submission needs a reviewed client/auth change; do not weaken the guard casually. Deploying AutoEval does not deploy the Lifty candidate or make a durable subprocess worker. |

The [actual Lifty route](https://github.com/devalparikh/deval-blog/blob/979840e45753346805d034e4d4ed852a482f9897/src/app/api/fitness-app/trainer/route.ts)
selects Node and `maxDuration = 120`. That remains its configured bound even if
the platform allows more. Vercel's [June 2026 announcement](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)
allows up to 30 minutes on Node/Python for Pro/Enterprise when configured; the
older [limits page](https://vercel.com/docs/functions/limitations) still shows
800-second entries. Verify the actual plan and project settings rather than
promising either limit. Functions are bounded requests; bundles, payloads and
runtime availability still constrain them. SQLite/local result files are not a
durable cross-invocation store. Keep the full multi-case runner on the developer
machine/worker and store durable receipts outside ephemeral functions.

A new Vercel project per experiment adds builds, credential duplication, cleanup
and configuration drift. It is justified for strong deployment/config isolation,
not necessary for evaluating a changed trainer. None of these routes requires
network exposure of AutoEval's local unauthenticated server.

## Observation is not invocation or replay

| Operation | App executes again? | Evidence and permitted inference |
| --- | --- | --- |
| Observe a live production request | No extra execution: app already ran. | Captures what happened, under that deployment/model/state. Sampling and missing spans limit coverage. |
| Score an observed trace | No, unless a separate judge calls a model. | Attach a versioned score to that exact trace. Judge spending and data disclosure are separate from capture. Cannot infer a counterfactual candidate's behavior. |
| Invoke a candidate on frozen inputs | Yes. | PR24's route. Synthetic state plus live model is live inference, not production replay. Label code, model, mode and fixture provenance. |
| Replay a reviewed production-derived case | Yes, with pinned dependencies. | Needs authorized/redacted inputs, state/tool observations, tool-call linkage, prompt/config/code revisions and frozen scoring expectations. Missing state means “not replayable,” not “use today's database.” |

PR24's output digest/check booleans cannot reconstruct a trajectory or train a
model. Production traces are not ground truth. Human review selects/redacts a
trace into a draft dataset or new application cases; finalization/freezing creates
a new immutable version. Preserve the source trace link, capture mode, redaction
policy, split assignment and content hashes. No automatic promotion into training,
no rewriting finalized records, and no calling a tuning suite a held-out benchmark.
Use deterministic protocol/safety invariants first, then a versioned human-reviewed
rubric for free-form output. An LLM judge needs calibration against human labels;
a stronger judge model alone does not establish correctness.

## Iteration path and generic boundaries

### Stage 1: supervised local execution (existing PRs plus a small live fixture)

Complete the smoke sequence above. Keep the JSON adapter in the application repo.
Nothing about fitness records, quantity rules, health policy, Supabase ownership,
or Lifty's prompt belongs in AutoEval's provider registry or generic runner. Generic
code owns version validation, typed checks, process limits, immutable suites and
receipts. Core selects UI by capabilities rather than by `system_key == "lifty"`.

### Stage 2: the smallest observation path (proposed, not implemented)

Add an opt-in **completed-trace file export and local importer first**, with a
versioned JSON contract. A manually reviewed, redacted export is enough to prove
TypeScript-to-Python interoperability. Import must not execute the app or accept
command strings as instructions. Do not build an OTLP collector, queue, dashboard
redesign and package publishing pipeline before one export/import works.

For local Lifty, emit from the server-side trainer/provider/reader boundaries.
For hosted Lifty, ephemeral disk is not a delivery mechanism: a small private
durable sink or existing supported telemetry destination plus operator export is
required. If such storage is not already available, postpone production capture
and validate the contract using synthetic runs. Never push from hosted Lifty to a
publicly exposed localhost workbench. Metadata-only capture is the default; raw
content is separately opted in, reviewed and redacted at the source. Hashes of
sensitive low-entropy values are not anonymization.

The first importer needs a distinct external-observation identity, not fabricated
LangGraph versions. Suggested contract requirements, **not current API fields**:

- Schema version; producer/application identity; deployment/code revision; runtime
  and adapter versions; source environment; capture mode; content-policy version.
- Stable trace/span/parent IDs, start/end timestamps, status, span kind, sequence or
  event ID, completion/partial state and sampling metadata. Retain tool-call IDs to
  join requests/results; redact arguments/results independently.
- Requested and provider-returned model IDs separately; provider request ID when
  returned; nullable token and cost values with units and source. Declared model
  identity is not a provider attestation; estimated cost never becomes billed cost.
- Optional bounded, approved input/output references and immutable fixture links;
  no credentials, executable code, arbitrary URL fetches or secret environment dump.

Validate bounded JSON, reject non-finite values/unknown major schema versions and
cross-system references, and define duplicate IDs: exact duplicate content is
idempotent, different content conflicts. An incomplete trace remains partial.
Accept retries without duplicating scores or dataset items. Specify canonical
hashing/JSON number limits with shared TS/Python test vectors rather than assuming
both languages serialize numbers identically. Persist only reviewed projections;
protect stored content from later accidental re-export. This is a small extension
of current services/schema/persistence, not a reason to invent a global framework.
Any new tables require both fresh schema and append-only migrations.

### Stage 3: package proven contracts (proposed)

After a second application demonstrates the same needs, publish public clients
that wrap the established file/HTTP contract: Python for runner/import workflows,
TypeScript for server-side instrumentation. Keep clients independent of FastAPI,
LangGraph and the UI; expose explicit flush, timeout and bounded-buffer behavior.
Use the same versioned envelopes for file import and authenticated HTTP ingestion.
Add an optional OTel mapping/exporter when an actual consumer needs it. OTel spans
map into external observations; replay dependencies and review stay AutoEval-owned.
Pin schema/semantic-convention versions, publish compatibility fixtures, and retain
v1 readers so historic evidence remains interpretable.

Private application code can supply domain redaction, fixture loaders and scorers
through documented contracts. Trusted local Python plugins can use the existing
registry/injection seams. Server ingestion never dynamically imports uploaded code;
custom execution/scoring belongs in an explicitly trusted local or isolated worker.
A generic OpenRouter adapter may normalize provider metadata, but the Lifty
adapter owns its actual model calls and cannot be silently budgeted by a Python
provider it never uses.

### Stage 4: authenticated shared service only when needed (proposed)

Split ingestion/read access from invocation permissions. Production app server →
bounded exporter → authenticated receiver → stored observations → separate review/
evaluation worker. Browser UI reads authorized results. Provider secrets exist
only where inference executes; an ingest credential cannot launch an evaluation
or read every trace. Add project-scoped identity/authorization, rate/body limits,
retention/deletion policy, TLS, durable admission/jobs, retries/recovery and isolated
execution before shared/unattended use. Acknowledgement must mean durable receipt;
observability outage must not fail the user's trainer request. Define bounded
retries/flush and dropped-event accounting for serverless shutdown explicitly.

Start with the current persistence model at measured single-user volume. Add
object storage or a different trace store when actual size/retention/query needs
justify it. Do not add a speculative `EvaluationDispatcher` or `ArtifactStore`
interface until there is a real second implementation, consistent with the
[architecture guidance](architecture.md).

## Migration from PR24 and acceptance gates

1. **Keep v1 valid.** Preserve existing tasks, frozen suite hashes, candidate receipts,
   offline/live labels and comparison restrictions. No rewriting old results or
   retroactively filling unknown usage with zero. PR24 `compare` is a paired-code
   comparison for the same model/mode/settings, not a model leaderboard.
2. **Live evidence is additive.** Introduce new live tasks/suites and operator-side
   run provenance. Keep protocol-v1's exact envelope valid; add a negotiated v2 or
   separately linked observation artifact for richer traces/usage. Do not add
   top-level fields to v1 and assume its strict parser will accept them.
3. **Observation gets its own path.** Test import with a synthetic TS export, duplicate
   retry, conflicting duplicate, malformed/oversized payload and partial trace.
   Confirm importing cannot invoke models/commands or edit final datasets. UI labels
   must distinguish observed production, offline fixtures and live synthetic runs.
4. **Onboarding can improve independently.** Issue22's inspect/commit transaction and
   stale-preview protection should make conflicts write nothing; the current series
   of idempotent calls can leave partial imports. Do not block the supervised pilot
   on this UX improvement.
5. **Before expansion**, issue23 tests must prove missing-key failure before paid
   work, no scripted fallback, bounded calls/retries/cancellation, provider-model
   mismatch visibility and honest unknown cost. Add human review and a separately
   held-out split before claiming quality improvement; isolate mutating execution.
6. **Before public releases/shared hosting**, verify license/package ownership,
   supported versions, upgrade/migration tests, authorization and retention of
   referenced artifacts. Run the repository's required checks for actual schema,
   API and UI changes (`make api-types`, `make check`, `make verify` as applicable).

## Decisions Deval needs to make

- Approve a developer machine (or existing dedicated eval VM) as runner owner;
  provide its key through that machine's secret workflow, not this design PR.
  Proposed allowance is USD 5 lifetime, no reset; choose a different explicit
  ceiling if needed. Decide the exact model slug and one live smoke fixture.
- Review/merge PR24 and PR36 separately when ready; choose pinned revisions for
  execution. This document neither merges them nor claims they are mainline.
- Choose the next question: synthetic live behavior, production observation, or
  hosted auth/storage integration. The latter two require distinct instrumentation
  or test-account/data setup, not just `--mode live`.
- Approve capture fields, consent/review owner, retention and deletion expectations
  before recording real conversations or health/account data. Referenced dataset
  artifacts outlive default trace TTL; decide how removal affects replay eligibility.
- Choose an open-source license, package ownership and supported runtime matrix
  before promising public installs. Decide whether a managed service is worth
  building only after another application's integration tests the generic seams.

Open uncertainties: actual deployed Lifty revision/model configuration; key balance
and provider cap behavior for the chosen route; installed runtime/dependency
versions; real trace volume and loss tolerance; hosted plan/timeouts; sufficient
redaction and reviewed holdout coverage; and customer need for multi-user hosting.
These were not verified by executing live inference or inspecting production
secrets. None is a reason to make the first synthetic run a platform rewrite.
