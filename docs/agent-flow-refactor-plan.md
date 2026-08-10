# Agent flow ownership refactor

## Decision

Do not combine all registered nodes into one LangGraph. A run should select one immutable flow version and compile only that graph. The current system-scoped plugin and handler registry already enforces this runtime boundary for an arbitrary number of independently growing systems.

The remaining data-model mismatch is ownership: `AgentSystemVersion` currently means both “version of a product agent” and “version of its one graph.” That works for Incident Triage, but Portfolio Analyst now has two durable workflows:

- `portfolio-index`: normalize and analyze a supplied portfolio into an indexed snapshot
- `portfolio-query`: answer questions over a referenced snapshot, including deterministic covered-call screening

Portfolio Q&A is registered as a separate runnable system for the current compatible milestone. It must not be presented as a new version of the indexing graph because the two graphs have different input and output contracts.

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

## Snapshot and covered-call contract

The current query graph accepts a supplied immutable snapshot document, verifies its content hash, and consumes a supplied option-chain payload. The target flow adds server-side snapshot resolution by ID so a caller does not resubmit the full document. Deterministic nodes own eligibility, quote-age validation, contract coverage, DTE, delta, spread, liquidity, event restrictions, premium math, assignment impact, and ranking. The LLM receives only a structurally projected candidate summary and may explain it; it cannot manufacture contracts or alter the ranking.

Until a market-data or broker adapter exists, missing or stale chain data returns `needs_market_data`. Synthetic fixtures never reuse real account quantities. Exact shares, dollar values, cost basis, gross premium, account identifiers, and owner identity are excluded from persisted and provider-bound projections by default.
