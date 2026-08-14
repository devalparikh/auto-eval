# Code readability & composability review

Reviewed 2026-08-14 against the goals: easy to understand, easy to modify, explicit
ownership, strong separation of responsibility, testable without excessive mocking,
appropriately abstracted, resilient around async state and failures — optimized for
the next engineer, not for abstraction, line count, or cleverness.

Scope: full backend (`backend/src/autoeval_api`) and frontend (`frontend/src`),
plus a pattern comparison with [pingdotgg/t3code](https://github.com/pingdotgg/t3code).
A separate styling/frontend-best-practices review is appended at the end.

---

## 1. What is already strong — keep it

These are the load-bearing decisions a new engineer benefits from; changes below
should not undermine them.

- **Single composition root.** `app.py:39` (`create_application`) wires every
  registry and service with injectable defaults. Tests can swap any dependency
  without monkeypatching. This is the right shape; keep resisting service
  locators and module-level singletons.
- **Thin routes, real services.** Route modules like `api/routes/traces.py` are
  ~85 lines of translation between HTTP and services. `api/dependencies.py`
  centralizes 404/400 resolution (`get_or_404`, `resolve_run_versions`). New
  engineers can read a route file top-to-bottom in one sitting.
- **Plugin seam for agent systems.** `agent_systems/<system>/plugin.py` +
  `graph/registry.py` with system-scoped handler names
  (`registry.py:46` falls back `(system, name)` → `(None, name)`) is an
  appropriately sized extension point — a registry, not a framework.
- **Immutability rules are enforced in code, not just docs.** Finalized dataset
  gating (`services/evaluations.py:67`), version content hashes, and the
  claimed-run UPDATE guard (`services/evaluations.py:115-122`) make the
  reproducibility contract real.
- **Race-safe frontend data hook.** `lib/use-api-resource.ts` handles stale
  responses with a request sequence counter and cleans up on unmount. This is
  the right amount of abstraction — a page of code, no library.
- **Frontend layering.** `app/` routes are thin shells; `features/` own screens
  and state; `components/` hold primitives; `lib/` holds the typed client.
  `features/catalog/catalog-options.ts` as a pure selector module is exactly the
  testable-without-mocking style to spread further.
- **Docs that match the code.** `docs/architecture.md` ownership tables and the
  README "Important boundaries" section are accurate and current. Rare and valuable.

---

## 2. Backend findings

### 2.1 (High) Graph definitions are stringly-typed everywhere

The graph definition — the central contract of the whole system — lives as
`dict[str, Any]` and is re-interpreted by hand at every consumer
(256 occurrences of `dict[str, Any]` across the backend):

- `graph/runner.py:165-176` (`node["kind"]`, `node["handler"]`, `edge["source"]`)
- `graph/runner.py:274-286` (`_runtime_input_modes` re-parses `runtime_input_policy`
  into a positional `tuple[str, str, int]`; consumers then index `configured[1]`,
  `configured[2]` — `graph/context.py:73`, `graph/context.py:166`)
- `graph/registry.py:62-66` (`validate_definition`)
- `services/evaluations.py:239-245` and `:277-282` (routes re-derive policy dicts
  with `isinstance` guards)
- every `agent_systems/*/handlers.py` (`state.get("normalized_query", {})`, …)

Consequences: no IDE navigation to the schema, silent `KeyError`s as failure
mode, `isinstance` defensiveness scattered through business logic, and each new
policy key (`resource_policy`, `snapshot_policy`, `runtime_input_policy`) grows
another parallel dict-walking helper.

**Recommendation — parse, don't validate.** Define one typed model
(Pydantic, since it's already a dependency) for `GraphDefinition` /
`NodeDefinition` / `RuntimeInputPolicy` / `ResourcePolicy` / `SnapshotPolicy` in
`graph/types.py`. Parse once where definitions enter the system (version
creation, and once per run in `AgentGraphRunner.run`), then pass typed objects
downstream. Replace the `tuple[str, str, int]` mode triple with a tiny frozen
dataclass (`RuntimeInputMode(source, mode, schema_version)`) so call sites read
`mode.schema_version` instead of `configured[2]`. This is the single highest
readability-per-effort change in the codebase: it deletes defensive code rather
than adding abstraction.

### 2.2 (High) `portfolio_query/handlers.py` is a 1,050-line module with three jobs

`agent_systems/portfolio_query/handlers.py` mixes:

1. pipeline node handlers (normalize → market data → validate → calculate →
   model context → safety → merge),
2. a covered-call analytics engine (`_covered_call_candidate` at :686 is ~100
   lines of options math), and
3. a private coercion stdlib (`_number`, `_dict_list`, `_integer`,
   `_optional_number`, `_round`, … at :1013-1055).

The coercion helpers are additionally copy-pasted in
`portfolio_analyst/handlers.py:301-315`, `portfolio_query/trace_policy.py:215`,
and `market_data/options.py:488` — four drifting copies of "what is a number".

**Recommendation.**
- Move the coercion helpers to one shared module (e.g. `autoeval_api/coerce.py`
  or `agent_systems/coerce.py`) and delete the copies. This is reuse of
  utilities, not a framework.
- Split the module along its existing seams, which the function list already
  reveals: `handlers.py` (thin node functions only), `market_observation.py`
  (locked/refreshed observation + freshness), `covered_call.py` (candidate math
  + safety), `model_context.py` (`_model_*` projections). Each becomes
  independently testable with plain dicts in/out — no mocking needed, matching
  how `tests/test_portfolio_query.py` already works.
- Long-term, the typed models from 2.1 shrink these files further: most of the
  `isinstance`/`.get(..., {})` noise exists only because inputs are untyped.

### 2.3 (High) Infrastructure knows about one specific agent system

`services/evaluations.py:249-265`: the generic evaluation service contains a
compatibility branch keyed to the literal node id `"load_portfolio_market_data"`
and source `"options_chain"` — a Portfolio Query implementation detail. The
same legacy shape appears inside the handler
(`portfolio_query/handlers.py:198-236`, "Compatibility only for finalized
dataset versions…").

This inverts the plugin boundary: `services/` should not name nodes owned by
`agent_systems/portfolio_query/`. The next engineer editing evaluations has to
learn portfolio internals to touch validation.

**Recommendation.** Give the plugin protocol an explicit hook, e.g.
`legacy_locked_input_exemption(graph_version, item) -> set[node_id]`
(or a declarative `legacy_inline_inputs` entry on the system's definition), and
have `_require_locked_runtime_inputs` consult it. The compatibility rule then
lives with the system that owns it, next to its twin in `handlers.py`, and dies
in one place when the last legacy dataset is gone. Both sites already carry
good "compatibility only" comments — the ownership, not the documentation, is
the problem.

### 2.4 (Medium) The runner interleaves orchestration and persistence

`graph/runner.py` owns graph compilation, node dispatch, *and* row-level trace
persistence. Inside `_traced_node`:

- the span is created and committed before execution (:218-219), re-synced and
  committed again in `finally` (:250-265), with the snapshot-binding fields
  copied field-by-field twice (:206-216 vs :250-261);
- `run()` also commits the trace three times across its body and `finally`
  block (:106, :156).

This works (the mid-run commits are what make partial traces visible), but the
duplication is a bug magnet — a new snapshot field must be added in two places —
and any unit test of node orchestration requires a real session.

**Recommendation, in order of increasing effort:**
1. Extract `_sync_span_snapshot_fields(span, runtime_context, node_id)` and call
   it from both sites — removes the duplicated block immediately.
2. Extract a small `TraceRecorder` (holds the session; methods
   `start_trace`, `start_span`, `finish_span`, `finish_trace`). The runner then
   expresses *when* things persist while the recorder owns *how*. Runner tests
   can pass an in-memory recorder; recorder tests hit SQLite once. This is a
   separation of responsibility, not speculative extensibility — the class has
   exactly one implementation and one reason to change.
3. Leave the commit points where they are; they encode the "partial trace is
   visible" behavior and are deliberate, per the comment at
   `services/evaluations.py:193`.

### 2.5 (Medium) Dual prompt-selection paths thread through every layer

The legacy single `prompt_version` and the keyed `prompt_versions` map coexist
in `RunSelection` (`graph/runner.py:40-45`), `TraceRecord`, `EvalRunRecord`,
`create_run` validation (`services/evaluations.py:80-96` duplicating
`_load_context` validation at :160-175), and the frontend
(`run-screen.tsx:172-174` synthesizes `legacyPromptVersionId` from the keyed
map). Every reader must learn both models and their precedence.

**Recommendation.** Pick the keyed map as the one true model. Make
`RunSelection.prompt_version` a derived accessor (or drop it) and translate
legacy rows at the read boundary. Also deduplicate the two prompt-version
validation loops in `EvaluationService` into one
`_validated_prompt_versions(session, system, graph_version, mapping)` helper —
they enforce the same invariant with different error types today
(`ValueError` at :96 vs `RuntimeError` at :172).

### 2.6 (Medium) `GraphRuntimeContext` keeps parallel state that must be kept in sync

`graph/context.py:41-46` holds both binding dicts and id dicts
(`runtime_input_snapshots` + `runtime_input_snapshot_ids`,
`node_snapshots` + `node_snapshot_ids`), synchronized by hand in
`bind_runtime_input_snapshot` / `bind_node_snapshot`. The runner then copies
the id dicts onto the trace (`runner.py:151-154`). Additionally,
`context.resources` (:36) is an untyped grab-bag used as a side channel between
nodes (`portfolio_query/handlers.py:52`, `:132` write;
`calculate_portfolio_answer` reads) — invisible coupling a newcomer can't
discover from signatures.

**Recommendation.** Store only the binding dicts and derive the id views
(`{k: b.id for ...}`) at the single point of use in the runner. For
`resources`, either give the two known keys typed accessors on the context
(`portfolio_snapshot_document`, `market_data_contracts`) or document the
contract next to the field — the constants exist
(`SNAPSHOT_RESOURCE_KEY`, `MARKET_DATA_RESOURCE_KEY`) but nothing explains the
producer/consumer relationship.

### 2.7 (Low) `migrations.py` — mechanical repetition and single-file growth

`migrations.py:24-50` repeats the `if N not in applied` block nine times, and
the file is 937 lines that will only grow.

**Recommendation.** Replace the ladder with a table:
`MIGRATIONS: list[tuple[int, Callable[[Connection], None]]]` and one loop. When
it next grows, promote to a `migrations/` package with `v001_ownership.py`,
`v002_portfolio_snapshots.py`, … so a migration's name says what it does. The
hand-rolled runner itself is appropriate for a local SQLite MVP — do not adopt
Alembic just for symmetry.

### 2.8 (Low) Error-string conventions are duplicated

`_safe_error` truncation logic appears in `graph/runner.py:467-470` and inline
in `services/evaluations.py:327`. One `format_error_for_storage(error)` helper
(next to `utc_now` in `models.py`, which is already the shared home for such
things) keeps the 2000-char policy in one place.

---

## 3. Frontend findings (structure & composability)

Styling-specific findings are in section 5.

### 3.1 (High) Hand-maintained API types duplicate the backend contract

`lib/types.ts` (482 lines) mirrors `backend/src/autoeval_api/schemas.py`
(531 lines) field-by-field, by hand. Nothing detects drift: if
`TraceResponse` gains a field, the frontend silently types it away.
This is the exact problem t3code's `packages/contracts` exists to solve
(one typed wire schema consumed by server and clients).

**Recommendation.** FastAPI already emits OpenAPI. Generate
`src/lib/api-types.gen.ts` with `openapi-typescript` in a `make`/npm script, and
either replace `types.ts` aliases with re-exports of generated types or add a CI
check that the generated file is current. This removes an entire class of
review burden ("did you update types.ts?") without a runtime dependency.
Keep hand-written types only for genuinely frontend-local shapes
(e.g. `DatasetVersionOption` in `catalog-options.ts:10`).

### 3.2 (Medium) Every screen re-implements the loading/error/empty ladder

The catalog fetch + three-branch render (loading → error → not-found) is
duplicated across at least five screens
(`run-screen.tsx:41-73`, `systems-screen.tsx`, `system-overview-screen.tsx`,
`system-browser-screen.tsx`, `evaluations-screen.tsx`), each with its own copy
of the `PageHeader` + `LoadingState`/`ErrorState` scaffolding, and
`useApiResource(api.catalog)` is called in 8 places with no shared cache
(navigating between screens refetches the same catalog).

**Recommendation.**
- Extract the pattern once, e.g. a `<ResourceGate resource={catalog} header={…}>`
  component or a `useCatalogScreen(systemKey)` hook returning
  `{ state: "loading" | "error" | "ready", … }`. The `RunScreen`/`RunWorkbench`
  split at `run-screen.tsx:37-83` (gate outer, pure inner keyed by `system.id`)
  is the right idea — promote it to the shared convention instead of re-deriving
  it per screen.
- For the refetching: a 20-line module-level cache inside `api.catalog` (or a
  `useCatalog` hook with a shared promise) fixes the common case. Adopt
  TanStack Query only if invalidation needs actually grow — today they don't;
  don't add the framework speculatively.

### 3.3 (Medium) `run-screen.tsx` mixes controlled state, FormData, and a 5-branch error ladder

`RunWorkbench` (571-line file) is doing form state three different ways at once:

- graph/model selects are controlled `useState` (:105-108),
- prompt selects are *uncontrolled* and read back via
  `new FormData(event.currentTarget)` + `String(form.get(...))` (:168-174) —
  a reader must notice this asymmetry to understand submission;
- error display is a five-branch chained ternary of near-identical `<p role="alert">`
  blocks (:393-440).

**Recommendation.** Pick one mechanism (controlled state, since half the form
already is) and derive the payload from state in `submit`. Collapse the error
ladder into `const blockingError = firstBlockingError({...})` (a pure, testable
function in `run-options.ts`, where `parseRunInput` already lives) rendered by a
single `<FormError id="run-error">`. Then `RunWorkbench` decomposes naturally
into `ExecutionPlanForm` / `RunResult` (already extracted) without inventing new
abstraction.

### 3.4 (Medium) Per-system behavior is keyed on hardcoded string literals

- `add-to-dataset-modal.tsx:67,154` and `edit-dataset-item-modal.tsx:40,98`
  branch on `systemKey === "incident-triage"`;
- `run-options.ts:3,41` and `run-screen.tsx:97` special-case
  `PORTFOLIO_QUERY_SYSTEM_KEY`.

The backend already sends per-system UX metadata in the catalog —
`AgentSystemSummary.dataset_editor` and `input_template` exist precisely for
this (`lib/types.ts:19`). The hardcoded keys mean adding a fourth agent system
requires hunting frontend conditionals, which contradicts the plugin
architecture the backend worked to establish.

**Recommendation.** Route every system-specific branch through catalog
metadata: `system.dataset_editor === "incident"` instead of
`systemKey === "incident-triage"`; extend the catalog payload
(one more field from the plugin's code-level UX metadata in
`agent_systems/registry.py`) for the portfolio-query input notice rather than
matching keys. Rule of thumb worth writing down: **the frontend may branch on
capabilities the catalog declares, never on system identity.**

### 3.5 (Low) `useApiResource` conditional-loader idiom is a footgun

`run-screen.tsx:113-119` passes a loader that returns
`Promise.reject(new Error("Select a graph version"))` when no id is selected —
the "no selection" state is modeled as an error. It works, but the hook then
reports `error` for a state that isn't one. Consider allowing `loader: null`
("not ready, stay idle") in `useApiResource` — a 3-line change that makes the
common dependent-fetch case honest.

---

## 4. Patterns from t3code — worth borrowing, and not

t3code (pingdotgg's agent-harness monorepo) is a different kind of project
(multi-surface product, Effect-based, pnpm monorepo), but several conventions
transfer:

**Borrow:**

1. **A contracts layer as the single wire-schema source.** Their
   `packages/contracts` holds typed schema definitions consumed by server and
   every client. AutoEval's equivalent is `schemas.py` + generated OpenAPI types
   (finding 3.1) — same benefit without a monorepo restructure.
2. **A root agent/contributor doc with concrete "do not do this" rules.** Their
   `AGENTS.md` lists specific environment-harming actions ("never `pkill -f`",
   "never open the live DB read-write") rather than generic advice. AutoEval's
   README "Important boundaries" section is close, but there is **no root
   `CLAUDE.md`/`AGENTS.md`** — only the auto-generated one in `frontend/`.
   Distill the boundaries (immutability rules, "code map reads only
   `AUTOEVAL_CODEBASE_ROOT`", "provider keys never in `NEXT_PUBLIC_*`",
   `make check` as the edit loop) into a short root file so agents and new
   engineers get them in-context without reading four docs.
3. **Layer ownership stated in one sentence each.** Their AGENTS.md describes
   each layer's single responsibility ("server: websocket orchestration,
   provider adapters…"). `docs/architecture.md` already does this well — keep
   it the enforced norm when adding directories.
4. **Targeted verification guidance.** They tell contributors which checks to
   run for which kind of change instead of "run everything". The Makefile has
   the right targets (`check` vs `verify`); a line in the root doc mapping
   change-type → target would finish the thought.

**Do not borrow:**

- **Effect-style FP abstraction.** Their `effect-*` packages buy composability
  at a steep onboarding cost; AutoEval's plain functions + small registries are
  more readable for this codebase's size, and adopting an effects system would
  violate the "no frameworks inside applications" rule.
- **Monorepo apps/packages split.** Two apps with one shared HTTP contract do
  not need workspace tooling; the `backend/` + `frontend/` split plus generated
  types achieves the same boundary.

---

## 5. Styling & frontend best-practices review

_(Produced by a dedicated review pass using the frontend-design skill.)_

<!-- STYLING_REVIEW -->

---

## 6. Suggested sequencing

Ordered by readability-gained per risk, so each step is independently shippable:

1. **Mechanical, zero-risk:** shared `coerce.py` (2.2), `_sync_span_snapshot_fields`
   (2.4.1), migration table loop (2.7), shared error formatter (2.8),
   `useApiResource` idle-loader (3.5).
2. **Contracts:** OpenAPI-generated frontend types + CI drift check (3.1);
   root `CLAUDE.md`/`AGENTS.md` (4.2).
3. **Typed graph definition** (2.1) — the big one; do it before adding the next
   policy kind, not after.
4. **Boundary repairs:** plugin hook for the legacy portfolio exemption (2.3);
   catalog-capability branching in the frontend (3.4).
5. **Decomposition:** split `portfolio_query/handlers.py` (2.2), extract
   `TraceRecorder` (2.4.2), collapse the dual prompt paths (2.5), screen
   gate/cache (3.2), run-form cleanup (3.3).
