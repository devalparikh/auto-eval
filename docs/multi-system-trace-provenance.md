# Multi-system workspace and trace provenance

This document records the product and data decisions behind the first multi-system AutoEval milestone.

## Aggregate boundary

`AgentSystemRecord` is the workspace aggregate root. Graph versions already referenced it; prompts and datasets now carry the same owner. A trace derives its system from its pinned graph version, and an evaluation is admitted only when dataset, graph, and prompt resolve to one system.

The browser mirrors that ownership:

```text
/systems
/systems/{system-key}
  /run
  /traces
  /datasets
  /evaluations
  /results
  /versions
```

The three built-ins prove the boundary with different inputs, graphs, labels, scorers, and safety policies. Generic JSON editors remain the fallback; an agent can retain a focused editor such as the Incident Triage ground-truth fields.

Registration is code-level and system-scoped. Each selected graph is compiled independently for its run; there is no shared mega-graph. A duplicate handler name in another system resolves inside that system's namespace rather than colliding globally.

## Provenance model

Execution origin and dataset membership answer different questions and are stored separately.

- `TraceRecord.origin_type`, `evaluation_run_id`, and `evaluation_dataset_item_id` say why an execution occurred.
- `DatasetItemRecord.source_trace_id` says that a reviewed trace was promoted into one dataset version.
- `EvalItemResultRecord` remains the scored result; it is not the only record of evaluation origin.

An evaluation trace is therefore not automatically a member of the dataset that supplied its request. Promotion is always an explicit review action.

## Promotion contract

The authoritative write is:

```text
PUT /api/dataset-versions/{version_id}/trace-items/{trace_id}
Body: { "expected": { ... } }
```

The server copies the trace's canonical persisted input. The client cannot substitute another input or attach an arbitrary source trace through the manual-item endpoint.

Eligibility requires:

- a complete trace;
- a draft target version;
- matching agent-system ownership;
- no conflicting membership in that exact version.

The first write returns `201`. An identical retry returns the existing item with `200`. A retry with different expected values returns `409`. The same trace can still be promoted into another compatible draft.

Trace-derived inputs and source IDs are immutable. Draft review may update only expected output. A uniqueness constraint on `(dataset_version_id, source_trace_id)` is the final race-safe guard.

## Read projections

Trace lists return membership counts without loading spans. Trace detail includes full membership rows across draft and final versions. `GET /api/traces/{trace_id}/dataset-targets` returns server-authoritative compatible drafts, existing-item reasons, evaluation-origin warnings, and the original reviewed expected value for evaluation traces.

The UI keeps origin and membership visually separate, shows a low-noise list indicator, disables already-linked drafts, exposes loading/error/no-draft states, and retains a stable success state. Evaluation output is never silently proposed as ground truth.

## Migration behavior

Fresh databases receive the complete SQLAlchemy schema. Existing MVP databases are upgraded additively by `migrations.py`:

- legacy prompts and datasets are assigned to the original Incident Triage system;
- known evaluation traces are backfilled from item results;
- unlinked historical traces remain `legacy_unknown` rather than being guessed;
- duplicate membership or result tuples stop migration with an actionable error;
- foreign keys and uniqueness indexes are enabled.

The migration is idempotent and preserves existing identifiers, payloads, trace spans, dataset items, and evaluation results.

## Portfolio analyst proof system

Portfolio Analyst uses model calls for context extraction and explanation while deterministic handlers own profile completeness, weights, allocation, concentration HHI, effective holdings, bucket ranges, liquidity, and scenario arithmetic. A final deterministic node removes transaction prescriptions and adds the analytical-support boundary.

All committed examples are synthetic. Portfolio-specific trace projections remove identity-like fields, exact shares, and raw dollar values; weights, categories, confirmed policies, and calculated outputs remain inspectable. The same projection is applied before an LLM provider call. This does not replace a future configurable retention/deletion policy or authentication for shared deployment.

Portfolio Query is a second independently compiled graph that consumes indexed state through a server-owned node resource policy. Direct runs may resolve the current snapshot for a stable portfolio identity; traces and datasets retain the exact locked ID. Its manifest shares the Portfolio Analyst product identity while retaining a separate flow key and graph-version history. The full snapshot is resolved through request-scoped runtime context and only a typed allowlist is sent to inference. [The flow refactor plan](agent-flow-refactor-plan.md) normalizes both flows under one persistent Portfolio Analyst product without merging their nodes.
