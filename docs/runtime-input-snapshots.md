# Node-output snapshots

## One catalog, many node-owned snapshot types

Portfolio state and an options-chain observation are the same artifact category: immutable output
associated with a registered graph node. They differ in schema, capture semantics, reveal policy, and
how an execution binds them.

The generic `node_output_snapshots` catalog is the discovery and provenance layer. It supports an
open-ended number of snapshot-enabled deterministic nodes without adding a new UI section or API for
each domain. Existing `portfolio_snapshots` and `runtime_input_snapshots` tables remain compatibility
and domain extensions; new snapshot kinds register through the generic catalog contract.

Each catalog record stores shared artifact metadata:

- owning agent system, product flow, node, output key, and snapshot kind;
- schema version, immutable content hash, observed and captured timestamps;
- source, provider, capture mode, and synthetic/real classification;
- content, bounded provenance, node-specific metadata, reveal-policy key, and storage adapter.

Graph nodes opt in with `snapshot_policy`. The policy declares the stable output key, snapshot kind,
schema version, binding direction, reveal policy, and whether a binding is required. Pure calculations
do not become snapshots by default; a handler must deliberately persist and bind an output.

## Artifact content is not execution metadata

One immutable snapshot may be produced once and replayed by many later traces. Latency, status, token
usage, and cost therefore cannot be properties of the reusable artifact.

Every trace span records a separate snapshot usage:

- snapshot ID and node ID;
- role: `produced` or `consumed`;
- resolution mode: `live`, `replayed`, `resolved`, `computed`, or `seeded`;
- step status, latency, start/completion times, and safe error;
- shared execution metadata such as trace origin, model, cost, and token counts;
- node-specific execution metadata declared by the handler.

The Artifacts inspector joins immutable content with all recorded usages. The Trace inspector shows the
single usage for that execution, so it can state whether the step fetched live data, replayed a locked
snapshot, resolved indexed state, or captured a computed output.

## Execution lifecycle

### Direct external-data run

1. The graph resolves the node's `runtime_input_policy` to `refresh`.
2. The registered capability fetches and normalizes the external observation.
3. The span records bounded live provenance regardless of capture choice.
4. When `capture_node_outputs=true`, the normalized output is persisted in the generic catalog and
   its domain extension; the default false mode leaves no reusable artifact.
5. Full content remains request-local; only bounded provenance enters graph state.
6. A used live observation without a captured artifact cannot be promoted to a dataset. An explicit
   `not_required` observation remains replay-safe because no external data influenced the result.

### Evaluation replay

1. The dataset item pins external-input snapshot IDs by node, separately from business input.
2. The runner validates owner, node, source, schema, and content hash.
3. The payload is injected request-locally and the network capability is not called.
4. Downstream deterministic and LLM nodes run normally.
5. The span records `consumed/replayed`; evaluation latency remains a property of that span.

### Indexed domain state

1. The Portfolio Index flow normalizes and calculates portfolio state.
2. `persist_portfolio_snapshot` writes an immutable state snapshot and binds `produced/computed`.
3. A query run supplies `node_resource_selections.get_indexed_portfolio` outside domain input. The
   selection is either `current` with a stable identity or `locked` with an exact snapshot ID.
4. The server-owned `resource_policy` pins the producer system/node/output/kind/schema, resolves
   canonical content, and binds `consumed/resolved` or `consumed/replayed`.
5. A `current` selection is canonicalized to the exact locked ID on the trace; trace-to-dataset copy,
   clone, finalization, and evaluation preserve that exact selection.
6. The raw portfolio stays request-local; only intent-specific, policy-safe facts reach an LLM.

This keeps graph, prompt, model, dataset, portfolio state, and changing external observations
independent while giving all node outputs one observable artifact model.

## Reveal and privacy policy

Synthetic snapshots may expose full normalized content. Real snapshots expose shared metadata,
allowlisted provenance, and a structural or domain-specific projection by default. Raw holdings,
account identifiers, quantities, provider contract identifiers, vendor authorization data, and full
market payloads remain server-side unless a product explicitly registers a safer policy.

## Extension rules

- Register a stable node `snapshot_policy`; do not infer snapshot identity from arbitrary state.
- Register a server-owned `resource_policy` for cross-flow consumers; clients choose current identity
  or an exact locked ID but cannot redirect the producer contract.
- Register external capabilities by source key; never accept a request-supplied provider URL.
- Version content schemas and fail closed on incompatible or corrupt locked snapshots.
- Keep artifact metadata and per-trace usage metadata separate.
- Persist normalized boundary contracts, not raw vendor responses or secrets.
- Add domain storage only when its query/integrity needs justify an extension; discovery still flows
  through the generic catalog.
- Mark conditionally used policies `required: false`; required nodes fail if the handler does not bind
  a matching output key, schema version, and direction.
- Do not snapshot ordinary pure calculations merely because they are deterministic.
