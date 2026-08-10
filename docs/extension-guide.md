# Extension guide

This guide names the smallest edit surface for each common extension. Start at the listed files and keep stable contracts outside the domain package.

## Add an agent system

Create `backend/src/autoeval_api/agent_systems/<system_key>/` with:

- `definition.py` for the graph definition and prompt text
- `handlers.py` for deterministic transforms and LLM response adapters
- `scoring.py` only when the system needs its own metric suite
- `seed.py` for example catalog records and dataset items

Export a `register_handlers` function from the package and call it from `graph/registry.py::default_node_handler_registry`. Register the metric suite in `services/scoring.py::default_scoring_registry`. Add built-in seed initialization to the lifespan composition in `app.py`; deployments with their own catalog can instead inject registries and seed separately. Keep the generic runner free of incident-specific behavior. Add focused backend tests for topology, handler output, scoring, and one traced run.

Graph node handlers return partial state dictionaries. The node named by `output_node` currently needs to place the focused result under the top-level `output` key. A graph may use other state keys internally, but the runner does not extract an arbitrary output key from the declared output node.

## Add an inference provider

1. Implement the contract in `backend/src/autoeval_api/inference/base.py` in a new module under `inference/`.
2. Add the provider to `inference/registry.py::default_provider_registry`, or register it with `InferenceProviderRegistry.register` and inject that registry through `app.py::create_application` in tests or another deployment.
3. Add adapter tests with network or subprocess behavior replaced by a fake transport.

Provider selection is model-ID based. Keep API keys in backend settings, use fixed outbound destinations, return normalized token/cost metadata, and never place provider secrets in trace payloads. CLI adapters must keep shell execution disabled and remain opt-in.

## Add a node handler

Put system-specific handlers beside the agent under `agent_systems/<system_key>/handlers.py`. Register deterministic functions with `NodeHandlerRegistry.register_deterministic` and LLM response adapters with `register_llm_output`. Graph versions store the registered string name, so renaming or removing a handler can make an old graph version unrunnable; prefer adding a new name and retaining the old handler.

Use `graph/topology.py` only for graph-wide validation or ordering that is independent of a particular agent system.

## Add or change scoring

Metric contracts and registry behavior live in `backend/src/autoeval_api/services/scoring.py`. Put domain-specific metric calculation in `agent_systems/<system_key>/scoring.py`, implement `MetricSuite`, and add the dataset-key mapping to `services/scoring.py::default_scoring_registry`. A deployment may instead construct `ScoringRegistry` and pass it to `app.py::create_application`. Keep evaluation orchestration in `services/evaluations.py`; it should select and call a suite, not know label names.

Version a finalized ground-truth dataset when a scoring change requires new labels. Final dataset versions are immutable.

## Add a backend API domain

Add a router under `backend/src/autoeval_api/api/routes/`, put reusable query/workflow logic under `services/`, define strict public contracts in `schemas.py`, and include the router from `app.py`. Request-scoped database access belongs in `api/dependencies.py`; cross-cutting HTTP behavior belongs in `api/middleware.py`.

Keep route functions small: validate and resolve HTTP input, call one service operation, and map expected domain errors to responses. Do not move persistence or provider details into routes.

## Add a frontend feature

Add a directory under `frontend/src/features/<domain>/` and keep its screen, forms, local state, hooks, tables, and charts together. Route files under `frontend/src/app/` should only render the feature entry component. Reuse the shell, modal, loading/error/empty states, and status badge from `frontend/src/components/`.

When the API changes, update `frontend/src/lib/types.ts` and `frontend/src/lib/api.ts` first. Put pure domain projections near the owning feature, as `features/catalog/catalog-options.ts` and `features/results/result-rows.ts` do. Do not add a global helper until more than one feature owns the same behavior.

## Validate an extension

```bash
make check
make build
make e2e
```

`make verify` runs all three. The Playwright suite starts the API and frontend through `frontend/playwright.config.ts`; mock inference keeps the default workflow deterministic and offline.

Before changing exposure, CLI access, persistence, or dependencies, read the preserved baselines in [code-security-review.md](code-security-review.md) and [dependency-security-report.md](dependency-security-report.md).
