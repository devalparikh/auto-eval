# Agent flow ownership refactor

## Decision

Do not combine all registered nodes into one LangGraph. A run should select one immutable flow version and compile only that graph. The current system-scoped plugin and handler registry already enforces this runtime boundary for an arbitrary number of independently growing systems.

The remaining data-model mismatch is ownership: `AgentSystemVersion` currently means both “version of a product agent” and “version of its one graph.” That works for Incident Triage, but Portfolio Analyst now has two durable workflows:

- `portfolio-index`: normalize and analyze a supplied portfolio into an indexed snapshot
- `portfolio-query`: answer questions over a referenced snapshot, including deterministic covered-call screening

The compatible runtime milestone keeps separate registration keys, but both manifests now declare
`product_key=portfolio-analyst` and distinct `index` and `query` flow identities. The catalog and Run
UI can therefore present one product without pretending that the query graph is a new version of the
index graph. The normalized database ownership below is still required before removing compatibility
system keys.

## Target model

```text
AgentSystem
  AgentFlow
    AgentFlowVersion
      Trace
      EvaluationRun
    Prompt
      PromptVersion
    Dataset
      DatasetVersion
  PortfolioSnapshot
```

Suggested identities:

- `AgentSystem(key, name, description)` owns product-level navigation and policy.
- `AgentFlow(agent_system_id, key, name, input_schema, output_schema, primary_metric)` owns one durable workflow contract.
- `AgentFlowVersion(agent_flow_id, version, definition, content_hash)` owns one immutable LangGraph definition.
- `Prompt` and `Dataset` move from system ownership to flow ownership so cross-flow combinations are rejected just as cross-system combinations are today.
- `Trace` and `EvaluationRun` pin an `agent_flow_version_id`; system ownership is derived through the flow.
- `PortfolioSnapshot(id, portfolio_system_id, schema_version, content_hash, as_of, source_kind, sanitized_summary, encrypted_or_external_ref)` is immutable. Raw positions should remain local or in a dedicated store rather than being duplicated into every trace.

## Migration sequence

1. Add `agent_flows` and `agent_flow_versions` without deleting current columns. Create one default flow per existing system and preserve every version ID through a deterministic mapping table.
2. Add nullable flow foreign keys to prompts, datasets, traces, and evaluation runs. Backfill from their current system/version ownership, validate no ambiguous provenance, then make the new keys required.
3. Change API selection from `agent_system_version_id` to `agent_flow_version_id`, retaining a compatibility alias for one release. Add `/systems/{system-key}/flows/{flow-key}/...` routes and flow selectors in the UI.
4. Move `portfolio-index` and `portfolio-query` under one Portfolio Analyst system. Keep their plugin modules and LangGraphs independent.
5. Remove legacy version columns only after migration verification proves IDs, hashes, trace spans, dataset membership, and evaluation provenance are unchanged.

Each step needs idempotent SQLite migration tests, cross-flow rejection tests, and a copy-of-current-database smoke test. This is intentionally a schema migration, not a registry trick.

## Completed snapshot/runtime slice

`PortfolioSnapshot` records are now immutable in SQLite. The index flow publishes snapshot references;
the query flow accepts only a snapshot ID, resolves the canonical document through request-scoped
LangGraph runtime context, and never copies the full snapshot into query graph state or checkpoints.
A dedicated deterministic node constructs the provider envelope. Deterministic nodes own eligibility,
quote-age validation, contract coverage, DTE, delta, spread, liquidity, event restrictions, premium
math, assignment impact, and ranking. The LLM may explain those facts but cannot manufacture contracts
or alter the ranking.

The query flow now has a registered options-chain runtime capability: direct runs may refresh Tradier while evaluations lock a recorded fixture and never call the network. Missing, stale, or incomplete data still fails closed. Synthetic fixtures never reuse real account quantities. Exact shares, dollar values, cost basis, gross premium, account identifiers, owner identity, and raw provider contract symbols are excluded from real-portfolio provider projections and intermediate persisted spans.
