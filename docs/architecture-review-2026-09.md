# Architecture review and refactor plan (September 2026)

Reviewed against `main` at `51af5c2`. This is a follow-up to
[code-readability-review.md](code-readability-review.md) (August 2026): it
records which of that review's findings have landed, what is still open, and
the concrete work packages chosen for this pass. The full evidence for the
original findings lives in the earlier document; this one is the plan.

## Verdict

The architecture is sound and the August recommendations that landed were the
right ones. Remaining problems are seams that leak in one direction each:

- **Infrastructure knows one product.** The generic evaluation service still
  names a Portfolio Query node id and source.
- **The runner owns persistence.** Orchestration and row-level trace writes are
  interleaved, with snapshot-binding fields copied by hand in two places.
- **The database is a module-level global.** `create_application` accepts a
  session factory but schema creation ignores it and always targets the engine
  built at import time.
- **The frontend branches on system identity.** Three features hard-code agent
  system keys instead of reading capabilities the catalog already declares.
- **Five screens re-implement the same catalog gate.** Every system-scoped
  screen copies the loading/error/not-found ladder and refetches the catalog.

None of these need a framework. Each is a small, local move that puts behavior
next to the code that owns it.

## What landed since August

| August finding | Status |
|---|---|
| Merge four private `_number()` copies | Done: `coerce.py` |
| Auto-generate frontend API types | Done: `make api-types`, `lib/api-schema.ts`, `lib/api-contract.ts` |
| Root house-rules file | Done: `AGENTS.md` + `CLAUDE.md` |
| Migration if-ladder to a loop | Done: `MIGRATIONS` list in `migrations.py` |
| Typed graph definition | Done: `graph/definition.py`, parsed once per version and per run |
| `dark:text-amber-*` theme leaks | Done: zero occurrences |

## Still open

| August finding | Evidence today |
|---|---|
| 2.2 Split `portfolio_query/handlers.py` | 1019 lines, 27 top-level functions across three concerns |
| 2.3 Evaluation service knows a portfolio node | `services/evaluations.py:249-257` names `load_portfolio_market_data` and `options_chain` |
| 2.4 Runner interleaves orchestration and persistence | `graph/runner.py:205-222` and `:257-268` copy the same six snapshot fields |
| 2.8 Duplicated error-truncation policy | `runner.py:448` and `evaluations.py:322` |
| 3.2 Catalog gate copied per screen | 5 screens, 8 separate `useApiResource(api.catalog)` calls, no shared cache |
| 3.4 Frontend branches on system identity | `add-to-dataset-modal.tsx:67,154`, `edit-dataset-item-modal.tsx:73`, `run-options.ts:3,41`, `run-screen.tsx:88` |
| 3.5 "Not ready" modeled as a rejected promise | `run-screen.tsx:113-119` |
| 5.x Typographic scale | 215 hard-coded `text-[Npx]` values |

## New finding: database wiring is not injectable

`db.py` builds `engine` and `SessionLocal` at import time from `get_settings()`.
`create_schema()` takes no arguments and always upgrades that global engine, so
`create_application(session_factory=..., initialize_database=True)` would
migrate the wrong database. Tests work around it by passing
`initialize_database=False` and running `Base.metadata.create_all` plus
`apply_migrations` themselves in `conftest.py`. `main.py` also builds a full
application at import, which the test suite imports just to reach
`create_application`.

This matters for the stated goal in `todo.md` of being able to plug in a
different database without a rewrite. The fix is not a repository layer or a
DI container. It is to make the engine an explicit argument.

## Work packages

Ordered so that each package touches a disjoint set of files from the one
running beside it. Backend packages run one at a time because they share one
pytest run; a frontend package may run alongside a backend one.

### WP1. Split `portfolio_query/handlers.py` along its existing seams

Pure move, no behavior change. Resulting modules in
`agent_systems/portfolio_query/`:

- `handlers.py`: `register_handlers` and the node functions only.
- `market_observation.py`: `_locked_market_observation`,
  `_bind_market_execution_observation`, `_market_data_error`,
  `_locked_greeks_provenance`, `_normalize_locked_contract`,
  `_market_data_reference`.
- `covered_call.py`: `_covered_call_candidate`, `_safety`, `_bucket_weights`,
  `_positions_by_symbol`, `_normalized_policy`.
- `model_context.py`: `_model_candidate`, `_model_portfolio_facts`,
  `_model_safety`, `_bounded_question`, `_portfolio_facts`,
  `_synthetic_position_fact`.

Moved functions drop the leading underscore where another module imports them.
`tests/test_portfolio_query.py` must pass unchanged.

### WP2. Move the legacy locked-input exemption into the plugin

Add one optional hook to `AgentSystemPlugin`:
`legacy_locked_input_exemption(definition, item_input) -> set[str]` returning
node ids that may skip the locked-snapshot requirement. The default returns an
empty set. Portfolio Query implements it in its package, next to the twin
compatibility branch in its market-observation code, and
`EvaluationService._require_locked_runtime_inputs` consults the plugin for the
item's system instead of naming the node. Add a test that a system without the
hook still fails closed.

### WP3. Extract trace persistence from the runner

- Extract `_sync_span_snapshot_fields(span, context, node_id)` and call it from
  both sites in `_traced_node`.
- Extract a `TraceRecorder` in `graph/trace_recorder.py` that owns the session
  and exposes `start_trace`, `start_span`, `finish_span`, `finish_trace`. The
  runner decides when to persist; the recorder decides how. Commit points stay
  exactly where they are because partial traces must remain visible mid-run.
- Add `format_error_for_storage(error)` to `models.py` next to `utc_now` and
  use it from the runner and from `EvaluationService._mark_failed`.
- Derive `runtime_input_snapshot_ids` and `node_snapshot_ids` on
  `GraphRuntimeContext` from the binding dicts instead of keeping parallel
  dicts in sync by hand.

### WP4. Make the engine injectable

- `build_engine(settings)` stays. `create_schema(engine)` takes the engine.
- `create_application` gains an optional `engine` parameter. When given and
  `session_factory` is not, the session factory is built from it. Lifespan
  calls `create_schema` on that engine. The module-level defaults in `db.py`
  remain for the plain `uvicorn autoeval_api.main:app` path.
- `conftest.py` builds the app from `autoeval_api.app` and passes its engine
  with `initialize_database=True`, deleting its hand-rolled schema setup.
- `docs/architecture.md` gains one sentence on where the engine is chosen.

### WP5. One catalog gate and one catalog fetch (frontend)

- `useApiResource` accepts `loader: null` meaning "not ready, stay idle" so
  dependent fetches stop modeling "no selection" as an error.
- `lib/use-catalog.ts` shares one in-flight promise and one cached catalog
  across screens, with `reload` to invalidate. Mutations that change the
  catalog (creating versions, finalizing datasets) call it.
- `components/catalog-gate.tsx` renders the loading, error, and not-found
  ladder once and calls a render prop with `{ catalog, system }`. The five
  screens that copy the ladder use it. Existing `RunScreen`/`RunWorkbench`
  split is the model: gate outside, pure workbench keyed by system id inside.

### WP6. Frontend branches on capabilities, never on system identity

- Backend: `AgentSystemSpec` gains `input_editor: str = "json"` and the catalog
  exposes it. Portfolio Query declares `"node-resource-query"`, named for what
  the editor does (strip pinned snapshot fields from the editable input), not
  for the system. Regenerate types with `make api-types`.
- Frontend: `system.dataset_editor` replaces
  `systemKey === "incident-triage"` in both dataset modals;
  `system.input_editor` replaces `PORTFOLIO_QUERY_SYSTEM_KEY` in
  `run-options.ts` and `run-screen.tsx`. Delete the constant.
- Add the rule to `AGENTS.md`: the frontend may branch on capabilities the
  catalog declares, never on system identity.

### Deferred

- **Typographic scale.** Real but visual; needs `make verify` with a human
  looking at the result. Define five named sizes in `globals.css` under
  `@theme`, then migrate `text-[Npx]` mechanically. Not in this pass.
- **Single prompt-selection model** (August 2.5). The keyed map should be the
  only model, with the legacy single `prompt_version` derived at the read
  boundary. Touches records, schemas, and the frontend at once; schedule as its
  own change with a migration.
- **Trace groups** (`todo.md`). A trace that is an ordered sequence of runs
  needs a `trace_groups` table and a `group_id`/`sequence` pair on traces,
  plus a migration. Design before implementing; it interacts with dataset
  membership and evaluation scoring.
- **Migrations package.** `migrations.py` is 936 lines. Promote to a
  `migrations/` package with one module per version when the next migration
  lands, not before.

## How to verify each package

| Package | Run |
|---|---|
| WP1, WP2, WP3 | `make check` (backend portion is what changes) |
| WP4 | `make check` |
| WP5 | `make check`, then `make build` |
| WP6 | `make api-types`, `make check`, `make build` |
