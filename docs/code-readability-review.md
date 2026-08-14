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

### 5.1 Summary

This is an unusually well-crafted frontend for an internal tool: a distinctive
warm, editorial dark aesthetic driven by a genuine design-token system, zero
inline `style={{}}` objects anywhere in `src/`, flash-free server-rendered
theming, and consistently strong motion/reduced-motion and focus hygiene. The
main structural weaknesses are (1) a **split-brain styling architecture** — the
codebase/landing/datasets/json-viewer features live in a 2,200-line
`globals.css` while everything else uses Tailwind v4 arbitrary values that
reference the same CSS variables by hand, (2) **no typographic or radius
scale** — 200+ hard-coded pixel font sizes (many at 7–9px, below legibility
floor) and five competing corner radii, and (3) a **repeatedly re-implemented
"table card" pattern** whose grid templates must be kept in sync in two places
per screen. Two spots break the token system outright (`dark:text-amber-*`),
and the token bridge into Tailwind's `@theme` was never built, which is the
root cause of most of the duplication below.

### 5.2 What's good (keep these)

- **Design tokens with full dual-theme coverage.** `src/app/globals.css:4-57`
  defines ~50 semantic tokens (surfaces, inks, `--accent-ink`,
  `--focus-shadow`, JSON syntax colors) and `globals.css:831-873` overrides
  every one of them for `[data-theme="light"]`, including `color-scheme`. The
  palette is characterful (warm charcoal + terracotta accent), not generic AI
  purple-on-white.
- **Flash-free theming, no `useEffect` theme work.** The theme cookie is read
  server-side and stamped on `<html>` in `src/app/layout.tsx:22-26`; the toggle
  in `src/components/app-shell.tsx:48-54` mutates
  `documentElement.dataset.theme` + cookie synchronously. No hydration
  mismatch, no FOUC, no theme-sync effect.
- **Zero inline styles.** `grep style={{` returns nothing across all `.tsx`
  files — everything routes through classes and tokens (even the `DottedText`
  component passes config as typed CSS custom properties,
  `src/components/dotted-text.tsx:39-44`).
- **Accessibility fundamentals are real, not decorative.** Global
  `:focus-visible` outlines (`globals.css:915-922`), a working skip link
  (`globals.css:952`, `app-shell.tsx:69-71`), `aria-current="page"` nav with
  animated underline, `aria-pressed` toggles, `aria-live` summaries
  (`src/features/codebase/codebase-screen.tsx:110`), and rich generated
  `ariaLabel`s on graph nodes (`src/features/systems/agent-graph.tsx:52-80`).
- **Motion discipline.** A global `prefers-reduced-motion` kill switch
  (`globals.css:1997-2006`) plus per-component `useReducedMotion` — including
  disabling Recharts animation
  (`src/features/results/cost-accuracy-chart.tsx:25,88`) and the canvas
  enhancement (`dotted-text.tsx:51`). Hover-only affordances are gated behind
  `@media (hover: hover)` (`globals.css:1708-1718`).
- **Modal is a proper dialog.** `src/components/modal.tsx:26-69`: focus trap,
  initial-focus targeting, focus restoration, Escape, body scroll lock,
  `aria-modal/labelledby/describedby`, overlay-click close that ignores inner
  clicks.
- **Clean server/client split.** Every `app/**/page.tsx` is a thin server
  component exporting `Metadata` and rendering a `"use client"` feature screen
  (e.g. `src/app/systems/[systemKey]/traces/page.tsx`). Route-level
  `loading.tsx` exists.
- **Third-party surfaces are themed through tokens**, not forked colors: React
  Flow via `--xy-*` variables (`globals.css:1652-1660`), Recharts via
  `var(--border)`/`var(--text-muted)` props (`cost-accuracy-chart.tsx:54-83`),
  canvas dots via `color="var(--border-strong)"`
  (`src/components/graph-canvas.tsx:133`).
- **`DottedText` progressive enhancement**
  (`src/components/dotted-text.module.css`): CSS `background-clip: text`
  fallback, canvas upgrade, `::selection` handling, and a `forced-colors` block
  (lines 57-68) — rare care.
- **`next/image` with `fill` + `sizes`** for the hero
  (`src/app/page.tsx:98-105`), inside an aspect-reserving container — no layout
  shift from the artwork.

### 5.3 High-priority findings

**H1. The "table card" pattern is re-implemented per screen, with grid
templates duplicated in two places each.**
The card shell string `overflow-hidden rounded-[var(--radius)] border
border-[var(--border)] bg-[var(--surface)]` appears verbatim 9 times:
`src/features/traces/traces-screen.tsx:40`,
`src/features/datasets/datasets-screen.tsx:166`,
`src/features/results/results-table.tsx:31`,
`src/features/results/cost-accuracy-chart.tsx:34`,
`src/features/evaluations/evaluations-screen.tsx:110`,
`src/features/evaluations/run-status-panel.tsx:27`,
`src/features/systems/version-editor.tsx:80`,
`src/features/systems/snapshot-artifact.tsx:34`,
`src/features/systems/runtime-input-snapshot-artifact.tsx:39`. Worse, each
list repeats its column template in both the header row and every data row,
including the responsive variant — e.g.
`grid-cols-[minmax(0,1fr)_110px_90px_96px_36px] ...
max-md:grid-cols-[minmax(0,1fr)_74px_28px]` at `traces-screen.tsx:41` **and**
`:62`; same at `datasets-screen.tsx:167`/`190` and
`results-table.tsx:45`/`68`. A column change requires editing 2–4 strings that
must stay byte-identical.
*Fix:* extract `<Card>`, `<CardHeader>` and a `<DataList columns={...}>`
primitive in `src/components/` that renders the header row and rows from one
column definition (template string defined once, applied to both), and swallow
the loading/error/empty branching that is also copy-pasted at
`traces-screen.tsx:48-57`, `datasets-screen.tsx:173-182`,
`results-table.tsx:55-62`.

**H2. No typographic scale; sub-9px text is endemic.**
Arbitrary pixel sizes in TSX: `text-[10px]` ×76, `text-[11px]` ×47,
`text-[9px]` ×40, `text-[8px]` ×21, `text-[12px]` ×20, `text-[13px]` ×9 — plus
62 `font-size` declarations in `globals.css` including `font-size: 7px`
(`globals.css:454-458`, `468-471`) and 14 instances of `8px`. Real content is
set at these sizes: snapshot facts at 8-9px
(`src/features/traces/trace-inspector.tsx:151,226`), interactive mode-switch
buttons at 9px (`globals.css:142`), node metadata at 7-8px. 7–8px text is
below any practical legibility floor, px units ignore users' browser font-size
preference, and there is no single place to tune the scale.
*Fix:* define a font-size scale as Tailwind v4 `@theme` tokens in `globals.css`
(e.g. `--text-2xs: 0.625rem` … `--text-md`), sweep `text-[Npx]` →
`text-2xs`/`text-xs`/etc., and raise the floor to ~10px (0.625rem); reserve
anything smaller for purely decorative glyph runs like `landing-art-meta`.

**H3. `dark:text-amber-*` breaks the theme system twice.**
`src/features/evaluations/model-picker.tsx:61` and
`src/features/run/run-screen.tsx:290` use `text-amber-700
dark:text-amber-300`. (a) It bypasses the `--warning` token that exists for
exactly this (`globals.css:21`, light override `:848`). (b) There is no
`@custom-variant dark` in `globals.css`, so Tailwind's `dark:` follows
`prefers-color-scheme` — but the app's theme is the `data-theme` attribute,
defaulting to **dark**. A user with a light OS gets `amber-700` on the dark
`--surface-raised` card: a contrast failure in the app's default state.
*Fix:* replace both with `text-[var(--warning)]` (or a `text-warning` utility
once tokens are bridged into `@theme`). If `dark:` is ever needed, register
`@custom-variant dark ([data-theme="dark"] &)`.

**H4. Keyboard focus is invisible on ModelPicker cards.**
`src/features/evaluations/model-picker.tsx:38-43` visually hides the checkbox
with `sr-only`; the visible `<label>` card (lines 30-36) has no focus styling,
and the global `:focus-visible` outline lands on the clipped 1px input — so
tabbing through the model list shows nothing. This is the primary multi-select
on the evaluation screen.
*Fix:* add `has-[:focus-visible]:outline
has-[:focus-visible]:outline-[var(--focus)]
has-[:focus-visible]:outline-offset-2` (or the CSS equivalent) to the label.

### 5.4 Medium-priority findings

**M1. Two parallel styling systems, and `globals.css` is a 2,237-line monolith
of feature CSS.**
The codebase feature is styled entirely with global classes
(`globals.css:59-829`, ~770 lines), as are the landing page (`:1752-1988`),
datasets overview (`:1598-1644`), and version-editor/json-viewer
(`:1412-1596`) — while traces/results/evaluations/run use Tailwind utilities.
Concrete casualties: `.codebase-page-header` (`globals.css:65-89`) duplicates
`.page-header` (`:1175-1209`) nearly rule-for-rule, and
`src/features/codebase/codebase-screen.tsx:74-94` hand-rolls the header markup
instead of using `PageHeader` (`src/components/page-header.tsx`). Global class
names also leak coupling: `.codebase-inspector-list .data-row`
(`globals.css:676-719`) restyles a utility class owned by other screens.
*Fix:* pick one lane per layer — tokens/reset/app-shell in `globals.css`;
feature styles either co-located CSS modules (the `dotted-text.module.css`
pattern already proves this works here) or Tailwind utilities. Merge
`.codebase-page-header` into `PageHeader` (it already accepts `action`).

**M2. Graph node cards are forked implementations.**
`TraceNode` (`src/features/traces/trace-graph.tsx:52-156`) and `AgentNode`
(`src/features/systems/agent-graph.tsx:147-244`) duplicate: the icon-selection
ternary chain (`trace-graph.tsx:56-62` = `agent-graph.tsx:151-157`), the card
shell classes (`trace-graph.tsx:65` ≈ `agent-graph.tsx:159`), the handle
styling (`!size-1.5 !border-0 !bg-[var(--border-strong)]`, 4 occurrences), and
the tag chip — a `NodeTag` component exists in `agent-graph.tsx:246-252` but
`trace-graph.tsx:101-134` re-inlines `bg-[var(--accent-soft)] px-1.5 py-1
text-[8px]` five times.
*Fix:* extract `GraphNodeShell`, `GraphNodeIcon`, and export `NodeTag` from a
shared module under `src/components/` or `src/features/graph/`.

**M3. Radius values are ad hoc despite a `--radius` token.**
`--radius: 4px` (`globals.css:46`) coexists with `rounded-[2px]` ×13,
`rounded-[var(--radius)]` ×13, plus one-off `rounded-[9px]`
(`model-picker.tsx:32`), `rounded-[8px]` ×2, `rounded-[7px]`
(`results-table.tsx:88`), `rounded-[5px]` (`model-picker.tsx:45`); and the
run-screen form card has no radius at all
(`src/features/run/run-screen.tsx:206`), unlike its siblings.
*Fix:* two tokens (`--radius-sm: 2px`, `--radius: 4px`), delete the rest, and
align the run-screen card with the shared Card primitive from H1.

**M4. Hardcoded dark-tuned shadows/overlays don't adapt to light theme.**
`modal.tsx:75` (`bg-black/65`), `modal.tsx:89`
(`shadow-[0_28px_90px_rgba(0,0,0,0.45)]`), `trace-graph.tsx:65` /
`agent-graph.tsx:159` (`shadow-[0_14px_40px_rgba(0,0,0,0.24)]`),
`globals.css:318`. These read as heavy smudges on the light `#f3f0ea`
background. The codebase already tokenizes shadows selectively
(`--focus-shadow`, `--accent-shadow`).
*Fix:* add `--overlay` and `--shadow-md/--shadow-lg` tokens with lighter
values in the `[data-theme="light"]` block.

**M5. First-visit theme ignores OS preference.**
`src/lib/theme.ts:5-7` defaults every cookie-less visitor to dark; nothing
consults `prefers-color-scheme`. Combined with H3's `dark:` confusion this
shows the system-preference story was never decided.
*Fix:* either honor system preference on first visit (a tiny inline script
before paint that sets `data-theme` when no cookie exists, or `light-dark()`
for the token layer), or explicitly document "dark by default" and forbid
`dark:` variants via lint.

**M6. Skeletons don't match the rows they replace → layout shift.**
`LoadingState` renders `h-11` (44px) bars (`src/components/states.tsx:7`), but
real rows are `min-h-[58px]` (`traces-screen.tsx:62`), `min-h-[62px]`
(`datasets-screen.tsx:190`), inside containers whose header rows the skeleton
also ignores. When data lands, the card grows ~100px and everything below
jumps.
*Fix:* give `LoadingState` a `rowHeight` prop (or render row-shaped skeletons
inside the `DataList` primitive from H1) so skeleton height ≈ final height.

**M7. Every screen fetches client-side, so the first paint is always a
skeleton.**
Pages are already `force-dynamic` server components (`layout.tsx:13`), yet all
data flows through the client hook `useApiResource`
(`src/lib/use-api-resource.ts`) — e.g. the catalog is fetched client-side on
every screen (`traces-screen.tsx:21`, `datasets-screen.tsx:18`,
`evaluations-screen.tsx:28`). Server-fetching the catalog in the page wrappers
and passing it down would eliminate the universal skeleton flash and the M6
shift for the most common data.

**M8. Brand typography exists only on Apple devices.**
`--font-body: "Avenir Next", …, Helvetica, Arial` and `--font-display:
"Iowan Old Style", …, Georgia` (`globals.css:48-54`), with no `next/font`
usage anywhere. On Windows/Linux the carefully-set serif hero
(`.landing-title`, `globals.css:1783-1792`) renders in Palatino/Georgia and
body text in Arial — a materially different (and more generic) design for most
non-Mac users.
*Fix:* self-host equivalents via `next/font/local` (zero-CLS, no external
requests) or deliberately re-tune the stack around fonts that exist
cross-platform.

### 5.5 Low-priority findings

- **L1.** `aria-label="Loading"` on a plain `div` (`states.tsx:5`) is not
  announced; use `role="status"` (+ visually hidden text) so screen readers
  hear the loading state.
- **L2.** `src/app/systems/[systemKey]/loading.tsx:1` marks a hook-free
  component `"use client"` unnecessarily.
- **L3.** `!important` used as a cross-cutting override in app CSS:
  `globals.css:479-486` (`.codebase-change-count span:first-child { color:
  var(--success) !important }`) and `:488-493`; structural selectors like
  `.codebase-page-header > div > p:last-child` (`:83`) are brittle against
  markup edits. (The `!` overrides scoped to React Flow internals, e.g.
  `graph-canvas.tsx:139`, are legitimate.)
- **L4.** Two JSON renderers with different aesthetics: the tree `JsonViewer`
  (`src/components/json-viewer.tsx`) vs the `pre`-based `JsonBlock`
  (`trace-inspector.tsx:273-279`). Intentional (tree for browsing, block for
  spans) but the block variant should live in `components/` — it's currently
  private to the trace inspector while visually establishing a pattern.
- **L5.** Table header type sizes drift: `text-[10px]` in
  `results-table.tsx:45` vs `text-[11px]` in
  `traces-screen.tsx:41`/`datasets-screen.tsx:167`. Falls out automatically if
  H1+H2 land.
- **L6.** `Image` uses a `preload` prop (`src/app/page.tsx:104`). The repo's
  `AGENTS.md` warns this Next 16 build diverges from trained knowledge, so
  confirm `preload` is the current prop (vs `priority`) against
  `node_modules/next/dist/docs/` — an unknown prop would silently drop the
  hero's fetch priority. Also consider a `placeholder="blur"` via static
  import for the 56vw hero.
- **L7.** Scrollbar theming is WebKit-first (`globals.css:929-941`);
  `scrollbar-color` is set for textarea/json-tree but not for the root
  scroller, so Firefox gets default chrome scrollbars against the themed page.

### 5.6 Suggested styling architecture

The single highest-leverage move is to **bridge the existing token system into
Tailwind v4's `@theme`** in `globals.css`: register the colors
(`--color-surface: var(--surface)`, `--color-text-muted`, `--color-warning`,
…), a font-size scale (`--text-2xs`…), the two radii, and shadow/overlay
tokens. That turns today's noisy arbitrary values (`text-[11px]
text-[var(--text-muted)] border-[var(--border)]`) into first-class utilities
(`text-xs text-muted border-default`), makes the scale enforceable (a grep for
`text-[` becomes a lint error), and removes the temptation that produced the
`amber` escape hatch. On top of that, grow `src/components/` by exactly the
primitives the screens keep re-deriving: `Card`/`CardHeader`, a column-driven
`DataList` (header + rows + loading/error/empty branching from one
definition), `NodeTag`/`GraphNodeShell` for the two React Flow node renderers,
and fold the codebase header into `PageHeader`.

For the CSS layer itself: shrink `globals.css` to tokens + `@theme` bridge +
reset + app-shell/scrollbar/skeleton/status utilities (~400 lines), and
relocate feature CSS (codebase map, landing, dataset overview, json-viewer,
version editor) into co-located CSS modules next to their components — the
`dotted-text.module.css` file already demonstrates the house pattern,
including its exemplary `forced-colors` and `@supports` handling. Keep the
current cookie-based SSR theming exactly as is (it's the correct App Router
pattern), but resolve the system-preference question once (M5) and add the
light-theme shadow/overlay tokens so the elevation language survives the theme
toggle.

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
6. **Styling system:** fix the two `dark:text-amber-*` breaks and the
   ModelPicker focus gap first (5.3 H3/H4 — small, user-visible); then the
   `@theme` token bridge + type/radius scale (5.3 H2, 5.4 M3), and the
   `Card`/`DataList` primitives (5.3 H1) — which also deliver 3.2's shared
   loading/error/empty handling.
