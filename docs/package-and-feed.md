# Imported clients and an application-owned feed

This replaces PR25's recommendation to begin Lifty adoption with a subprocess.
The application imports AutoEval, owns every model/tool call and explicitly feeds
completed observations. AutoEval never becomes an inference gateway. This change
adds a working generic npm artifact and local receiver; it does not claim a hosted
service or production-data evaluation.

## Implemented boundary

`packages/trace-feed` contains a dependency-free ESM client and an explicitly
imported `/server` entry point. Packaging, install/consumer tests, wire validation,
project-scoped role credentials, durable local SQLite receipts, consent grants and
withdrawal, retention, immutable experiment/dataset-manifest registration, and
paired named-check comparisons are implemented. See its README for the exact API,
limits, commands and release contract. No Lifty code or domain keys live there.

The receiver is separate from the existing FastAPI workbench, with a separate
SQLite file and schema. It cannot modify graph/prompt versions, finalized datasets,
snapshots, provider configuration or evaluations. It does not fake those objects
for an application whose control flow lives elsewhere. No uploaded executable code
runs at ingestion. Model credentials are neither required nor accepted.

The separation makes this first artifact independently buildable/testable through
source/API tooling while the AutoEval checkout is unavailable. It also keeps the
current unauthenticated/local workbench from accidentally becoming an ingestion
endpoint. This is a bounded delivery stage, not a replacement backend or a claim
that the two stores/UI are integrated. The next hosted receiver should implement
this contract in the FastAPI service with PostgreSQL and scoped auth; keep the
Node receiver as the zero-dependency local option. Do not add another production
Node service merely to preserve the prototype's storage implementation.

The first Lifty consumer installs the exact packed artifact in its lockfile and
imports the SDK after `finishRequest` succeeds. Default capture is inert. The
synthetic runner opts in explicitly, exercises the real trainer loop and provider
parser with injected responses, and verifies feed/read/revocation. Its app-owned
projection removes all conversation/account content and retains three counts plus
a persisted-reply check. A feed outage cannot undo a saved trainer reply. Production
and deployed-runtime capture are additionally blocked in application code.

## Prior PR decisions

- **PR24:** preserve the local adapter/runner and immutable frozen-suite receipts.
  It remains useful for trusted, offline candidate execution and regression testing.
  The new import/feed package is independent of it and is based on main, so it does
  not silently change protocol v1, execute its subprocess, or require PR24 to merge.
- **PR25:** supersede its temporary subprocess-first recommendation. Its distinction
  among observation, rescoring, invocation and replay still applies. Keep that PR's
  record intact; do not merge it as current implementation guidance unchanged.
- **deval-blog PR36:** retain its independently useful quantity-guard fix and the
  12-case scripted regression evidence. The new app integration is based on main,
  touches the persistence/capture boundary rather than the brevity guard, and does
  not claim that PR36 is merged. Its subprocess adapter remains optional. This
  package feed does not replace or improve the 9/12 versus 12/12 historical result.

Examined heads: PR24 `6b6d53491c5786919abb8f9a50d7ff8d244e2d3b`, PR25
`636cab3fc9a767311f90edcf3161224bdb20a767`, PR36
`979840e45753346805d034e4d4ed852a482f9897`. Existing retro and app integration docs
were read at those heads. New independent bases: AutoEval
`ddb702cd53ef3a9485020b7caa70fabd7c749d6f`, Lifty
`f1649a14326911c166e5f377acc6f79d0896218d`.

## Where hosted AutoEval should live

**Confirmed repository split:** `devalparikh/auto-eval` is the generic product,
including SDKs, server, UI, self-host image and docs as product deliverables. Deval's
own instance belongs to a **separate private customer deployment repository** and
must use the same public documented pinned package/image and configuration paths
as an outside customer. No special access, fork or copied product source. See the
[customer deployment contract](customer-deployment-contract.md) for ownership,
release gates, public-interface gaps and migration responsibilities.

The private repo would own its instance Vercel configuration, approved database
provisioning and migration orchestration, auth/allowlist configuration and secret-free
environment templates. Secrets remain in Vercel/Supabase. Its target can still be a
separate Vercel project with Next.js/FastAPI and durable PostgreSQL, but the product
must first provide a supported public artifact installation path for that target.
The existing source-linked upstream preview is not that customer install path.
A generic self-host image is a product deliverable, not an implemented artifact in
this PR, and must not be assumed runnable directly on Vercel.

Supabase Auth or OIDC and project-scoped authorization remain the recommended auth
boundary. Do not reuse Lifty's data tables or service-role credential. The instance's
allowlisted operators and project identifiers stay out of upstream configuration.
Lifty sends a backend ingest-only credential; browser/admin login is separate.
Missing setup capabilities must be fixed or tracked upstream, never privately
patched for the author's instance. No private repository creation is authorized.

Deval would sign in to AutoEval to review consenting observations, register/pin
experiments, select a reviewed dataset and compare results. The future hosted UI
must label observed production, scripted synthetic, and live synthetic separately.
The existing workbench UI does not yet show this new feed; today the local runner
checks receipts programmatically. Do not advertise the future review UI as built.

| Option                                                                                       | Benefit                                                                                           | Cost / decision                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/evals` inside Lifty, gated by verified Supabase identity and a server-side allowlist | Reuses login and a familiar entry point                                                           | Couples app releases and evaluator privileges, risks access to app secrets/data, and needs a backend facade rather than a hidden menu. A future link/BFF to the generic service is fine; do not fork AutoEval into Lifty. |
| Private instance repo + supported AutoEval release + scoped auth/PostgreSQL                  | Independent generic product, storage, permissions and release cycle; other apps can feed it       | Requires approved auth, hosting, database, schema migrations, backup/deletion and operations. Confirmed repo boundary; hosted installation remains unimplemented.                                                         |
| Dedicated VM/container with durable volume and private access                                | Current local receiver can run without serverless persistence problems; simplest supervised pilot | Operator owns patching, recovery and backups; current receiver binds loopback and has no public UI/SSO. Use local/private operator access only.                                                                           |
| Managed evaluation vendor                                                                    | Less operational work                                                                             | New processor, disclosure, retention, spend and export decisions. No vendor account or integration authorized.                                                                                                            |

An authenticated page in Lifty is not sufficient protection for the feed. Verify
identity and project membership at every read/mutation on the server; browser
navigation guards are not access control. Keep admin tokens and provider secrets
out of `NEXT_PUBLIC_*`, URLs, browser storage, logs and dataset content. Shared
hosting needs scoped authorization on the existing workbench APIs too, not merely
on this new ingest route. Existing hosted Basic auth is a single-user preview
boundary, not tenant isolation.

The confirmed end-to-end target is specified in the
[hosted client contract](hosted-client-contract.md): private Vercel deployment of a
pinned public release, Supabase database/auth environment configuration, instance-issued
per-app keys and endpoint, registry-installed SDK initialized from app environment,
and Supabase sign-in to the private dashboard. Its proposed environment/scopes are
not implemented by this PR; current capture stays synthetic and explicitly configured.

## Vercel/storage: code truth versus deployed reality

At the pinned main, root `vercel.json` declares one project with `frontend` Next.js
and `backend` FastAPI services and rewrites `/api/backend` to FastAPI. Local settings
default to SQLite. `config.py::validate_production_security` rejects SQLite in the
production profile, requires a long hosted password and rejects enabled CLI/LM
Studio providers. `db.py` builds its engine from settings, and the deployment guide
requires PostgreSQL for the guarded preview. Lifespan schema creation/migrations
are existing behavior; **no app or migration was run against a deployed backend**.

GitHub deployment records show Preview entries for the examined PR heads and
Production-named entries for main commits. They do not prove which Vercel settings,
database URL, migration history or deployed source/profile is active. The actual
Vercel project/environment settings and durable storage remain **unverified**.
No secret/settings inspection or change occurred. Do not infer “production uses
SQLite” from the local default, or “production uses PostgreSQL” from the guard.
Do not deploy this new local SQLite receiver to ephemeral Vercel filesystem.

## Registering an experiment and iterating agents

1. Keep fixtures and rubric in version control, with a review/finalization step.
   Register a finalized manifest (sorted SHA-256 case IDs + rubric hash). The server
   computes its immutable content hash; arbitrary unregistered hashes are rejected.
   This manifest is a separate feed contract, not a mutable FastAPI dataset.
2. Register a new experiment ID with full app revision, prompt hash, execution
   configuration hash, model declaration, mode and finalized manifest hash. Graph
   systems additionally pin a graph hash. Recursive Lifty needs no artificial DAG:
   pin the actual loop code, prompt, read/tool policy, budgets/retries and provider
   settings in the app's config manifest. The current smoke command hashes its
   fixture, trainer source, prompt and scripted settings and labels itself a smoke
   run, not a clean-candidate benchmark.
3. Execute candidates inside the app's authorized runner, preserving tool/retrieval
   behavior. Submit one observation per case/experiment. Inference stays there.
   Any changed prompt, graph, loop, tool policy, provider model or runtime setting
   creates a new experiment. Never edit prior versions or patch scores in place.
4. Compare the same finalized case set and mode. The implemented comparator rejects
   missing/expired/duplicate cases, compares named boolean checks including unknowns,
   and preserves error/partial statuses. Mode mismatch is not a paired comparison.
   It permits model/config/revision changes so those can be experimental variables;
   the operator must change one intended factor and label the experiment honestly.
5. A new scoring rubric creates a new manifest. Preserve a distinct held-out set
   after tuning. The feed can record checks computed in app-owned code; it does not
   independently attest that the app used the declared inputs/model or correct rubric.

Offline scripted execution proves orchestration, parsing and structural invariants.
Offline replay additionally needs frozen, approved tool/state responses; the current
metadata projection deliberately cannot reconstruct a conversation or account.
Live synthetic execution tests provider behavior with bounded, separately approved
spend. Observed production traffic has null dataset/case IDs and never auto-promotes
into a dataset or counterfactual result. A real replay needs separate approval,
reviewed minimization, immutable fixtures and app-owned execution. No judge call,
training export or production replay is implemented or performed here.

This is a general boundary for recursive loops, DAGs and simple model calls. It is
not universally optimal: metadata-only data cannot judge coaching semantics, Python
clients are absent, and a durable queue/outbox plus worker is needed for unattended
high-volume runs. Add those when a concrete consumer requires them; do not move
model traffic into AutoEval to solve an observation-delivery problem.

## Local workflow

Lifty adds `npm run eval:lifty` for a complete, disposable synthetic exercise.
It starts the installed receiver on an ephemeral loopback port, creates in-memory
credentials and synthetic authorization, runs the trainer, verifies the receipt and
withdrawal, and closes/deletes its temporary database. No environment keys required.

`npm run dev:autoeval` runs that smoke and keeps the local receiver alongside Next
dev until shutdown. Normal `npm run dev` stays unchanged. Interactive authenticated
Lifty account traffic is **not** captured by either command: the production/account
consent flow is not built/approved. There is no hosted fallback, hidden subprocess
model runner, Docker requirement or background telemetry. The local command starts
the feed, not the full FastAPI review UI. A future authorized interactive capture
flow must derive its grant from the account's current consent at the source.

## Distribution decision

The private instance is a customer of public releases, not a privileged consumer
of the development tarball. Public install gaps and migration tooling are tracked
in the [customer contract](customer-deployment-contract.md).

Prefer a public npm client under a verified namespace and an approved permissive
license, with private app-side policies/fixtures. SDK openness does not make traces
public. The repo lacks a declared license today, so the artifact remains
`private: true`, `UNLICENSED`, locally packed and lockfile-pinned. A private registry
is an alternative if Deval chooses restricted distribution. No registry credentials,
package publication or license grant has been created. The first Lifty PR carries
the small exact tarball to avoid requiring an unpublished registry install or a
sibling checkout; AutoEval owns the reviewable source. Replace it with the exact
published version only after approval. Test pack allowlisting and consumer import
on each release; never re-use an already distributed version for changed bytes.

## Exact real-data gates

None of the following is satisfied merely by credentials being present:

- Deval approves the pilot purpose, participants, field-level projection and whether
  any conversation/health/account content may leave Lifty. Current projection is
  metadata-only; expanding it needs a new schema/policy and source review.
- Participants explicitly opt in. Implement authenticated, versioned consent and
  account-to-random-grant mapping, withdrawal and deletion before enabling capture.
  Deval's infrastructure approval is not each user's consent. No blanket historical
  conversation export or retroactive consent.
- Deval explicitly approves creation/name/private visibility of the separate deployment
  repository; no repository is created in this task. Public product release and
  customer-only install prerequisites must be satisfied before populating a working
  deployment. Instance provisioning orchestrates upstream migrations; it never forks
  product schema.
- Deval approves the destination/account/region and any new hosting/database/auth
  setup, plus exact migration/configuration changes. Inspect actual Vercel/Supabase
  settings through authorized access before proposing deploy commands. Hosted
  receiver, durable store, resource auth and deployed isolation tests remain work.
- Approve retention (proposed pilot: at most 24 hours), backup erasure, operator
  access, credential issuance/rotation, quotas, deletion verification and failure
  handling. No production credentials are needed to validate this synthetic path.
- Review the implementation and separately authorize enabling production capture;
  remove the app's hard runtime/source gate only in that reviewed change. No merge
  or deployment is authorized by this PR.
- Separately approve any live invocation/judge model, exact data disclosure, task
  count, call/token/concurrency caps and monetary ceiling. Issue scoped eval-only
  credentials through the secret workflow. Ingestion needs no OpenRouter key.
- Select/redact production-derived fixtures, verify replay completeness, finalize
  new immutable dataset versions and agree a rubric/holdout before a real quality
  comparison. Do not label this task's synthetic smoke as production evidence.

## Verification and friction retro

The missing authorized AutoEval checkout prevented full `make check`/`make verify`
execution. No shell clone/worktree or project-setting change bypassed that boundary.
Standalone package build/pack/install, the same contract tests against installed
exports, and the Lifty synthetic E2E are runnable without that checkout. Full
AutoEval required checks remain a review gate in a proper authorized checkout.

Friction improvements built here: one-command synthetic onboarding replaces manual
multi-process setup; the package can be tested as installed rather than via relative
source imports; authenticated ingestion does not demand model keys; strict source
projection prevents accidental whole-account serialization; experiment registration
rejects invented dataset hashes; immutable policy registration catches silent
capture expansion; complete-case comparison refuses missing evidence.

Remaining friction: a separate feed store is not yet visible in the workbench;
production consent/auth and hosted storage need explicit implementation/approval;
source hashes cannot substitute for clean candidate provenance; one synthetic
case validates plumbing, not coaching. No UI changed, so no rendered UI result is
claimed. PR24's broader regression suite remains useful independent evidence.

Primary references: [Node SQLite API](https://nodejs.org/api/sqlite.html),
[npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json),
[existing deployment guide](vercel-deployment.md),
[architecture](architecture.md), [security controls](security-controls.md).
