# Application capture and feed architecture

## Current implementation

Applications import the private `@devalparikh/autoeval` SDK from
`packages/trace-feed`, own every model/tool call, and explicitly submit completed,
approved metadata observations. AutoEval is not an inference gateway. The hosted
Vercel/Supabase path receives them in FastAPI at `/api/backend/v1/traces` and
exposes review and paired synthetic comparisons in `/applications`.

FastAPI owns PostgreSQL feed persistence, application/environment scoped keys,
consent grants and withdrawal, retention, immutable dataset-manifest and experiment
registration, and server-wide authorization. Dashboard operator sessions and
application ingest keys have separate authority. See the
[hosted client contract](hosted-client-contract.md) and [SETUP.md](SETUP.md) for
exact capture, environment, installation and admin registration contracts. This
page does not redefine them. Hosted support does not establish that an app has
authorized production capture or validated a quality improvement.

The SDK's optional `/server` entry point exports the Node `startFeed` receiver.
Keep it as the loopback-only local option and isolated package/consumer test
fixture, using its own SQLite store. It is not deployed as a second production
service or used as Vercel filesystem persistence. Both paths keep observations
separate from the workbench's graph/prompt versions, finalized datasets and
snapshots; ingestion executes no uploaded code and accepts no model credentials.

## Distribution and deployment ownership

The generic product owns SDK, backend, UI, schema and release tooling. A customer
instance owns configuration and operations, not a fork of those implementations.
The private SDK access path and pinned server-artifact path are distinct; see the
[customer deployment contract](customer-deployment-contract.md) and
[server release contract](server-release.md). The author's Vercel/Supabase instance
is not evidence of a public server release or a released self-host container.

Repository package metadata and historical contract documents retain prerelease
publication statements. This cleanup neither changes package bytes/version nor
publishes a package; use the pinned installation contract for consumer setup.

## Historical adoption record

The following records the original PR24/25 decisions and examined consumer heads,
not current hosted capability or current Lifty deployment state. The local-first
feed stage has since gained FastAPI persistence, scoped auth and dashboard review.
The original tarball-only distribution and unimplemented-hosting recommendations
are superseded by the current contracts linked above.

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

## Production capture and replay boundaries

Hosted availability is not permission to export application data. Source apps own
authenticated opt-in, policy projection and consent synchronization. Retention,
withdrawal/deletion, backup erasure and operator access need instance operations;
metadata-only observations cannot reconstruct conversations for replay. Production
capture remains off by default. Live inference, judge calls and reviewed
production-derived fixtures need their own authorization and evaluation design.

The original Lifty smoke used a disposable local receiver, scripted responses and
an app-owned count/check projection. That is historical plumbing evidence, not a
claim about current consumer commands, production consent or coaching quality.
The local benchmark adapter and PR24/25 history remain useful for independent
regression evidence. Package install/consumer tests and repository `make check`
remain required validation paths; the original checkout-access limitation is no
longer current guidance.
