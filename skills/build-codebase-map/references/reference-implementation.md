# AutoEval reference implementation

Use `/Users/devalparikh/Documents/Github/auto-eval` as the working reference. Reuse its boundaries and contracts, not its product branding.

## Backend

- `backend/src/autoeval_api/codebase/schemas.py`: transport-neutral graph and revision contracts
- `backend/src/autoeval_api/codebase/repository.py`: configured-root worktree, index, commit, and PR snapshots
- `backend/src/autoeval_api/codebase/parser.py`: language, symbol, and import extraction
- `backend/src/autoeval_api/codebase/graph.py`: hierarchy, internal import resolution, diff union, line counts, ghost nodes, and edge changes
- `backend/src/autoeval_api/codebase/logic.py`: validated `.codemap/logic.json` projection and logical relationship diffs
- `backend/src/autoeval_api/codebase/service.py`: small orchestration boundary
- `backend/src/autoeval_api/api/routes/codebase.py`: thin local API routes
- `backend/tests/test_codebase_graph.py`: real temporary-Git verification

The repository root comes from `AUTOEVAL_CODEBASE_ROOT`; the browser sends only `source` and an optional validated commit/PR selector.

## Frontend

- `frontend/src/app/codebase/page.tsx`: thin route
- `frontend/src/features/codebase/codebase-screen.tsx`: comparison state and data loading
- `frontend/src/features/codebase/codebase-controls.tsx`: structure/local/staged/commit/PR controls
- `frontend/src/features/codebase/codebase-layout.ts`: focused-branch semantic thresholds, anchored hierarchy positions, and visible-level edge aggregation
- `frontend/src/features/codebase/codebase-map.tsx`: React Flow canvas, minimap, pan/zoom, selection, and level indicator
- `frontend/src/features/codebase/codebase-node.tsx`: logical node rendering and diff rails
- `frontend/src/features/codebase/codebase-inspector.tsx`: containment and dependency context
- `frontend/tests/codebase-layout.test.ts`: zoom and aggregation tests

The host already depended on `@xyflow/react`, Phosphor icons, Next.js, React, and Tailwind. No package was added for the map.

## Behavior to retain

- Files and Logic modes share one transport-neutral graph contract.
- Zoom thresholds reveal four semantic levels while expanding only the branch under the focal point.
- Relayout keeps the focal node at the same screen coordinate and eases newly revealed children from blur to clarity.
- Working changes include untracked files; staged changes read the index rather than the worktree.
- Commit comparison uses the first parent; PR comparison uses the merge base.
- Removed content remains visible as red ghost structure.
- Modified nodes use a split green/red edge and display line counts.
- Import edges aggregate to areas/modules when those are the visible scope.
- A selected node exposes its parent, children, imports, and reverse imports.
- The map follows AutoEval's dark/light tokens and collapses the inspector below the canvas on narrow screens.

## Standalone extraction

Move the `codebase` backend package and its API contract first. Then move the frontend feature directory and replace only:

1. API client wiring
2. theme variables and shared controls
3. route/app shell
4. repository-root launcher configuration

Do not couple the extracted app to AutoEval's database, agent systems, traces, or evaluation services.

The agent-maintained logic model lives at `.codemap/logic.json`. Its maintenance workflow is packaged separately as `$maintain-codebase-logic`; the viewer remains deterministic and never invokes an agent itself.
