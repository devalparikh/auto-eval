# Extension guide

This guide names the smallest edit surface for each common extension. Start at the listed files and keep stable contracts outside the domain package.

## Add an agent system

Create `backend/src/autoeval_api/agent_systems/<system_key>/` with:

- `plugin.py` for its `AgentSystemSpec`, package path, and optional trace policy
- `definition.py` for the graph definition and prompt text
- `handlers.py` for deterministic transforms and LLM response adapters
- `scoring.py` exporting `scoring_entries`
- `seed.py` for example catalog records and dataset items
- `trace_policy.py` when persisted or provider-bound payloads require structural projection

Export `register_handlers` from the handler module and add the package's `PLUGIN` to `agent_systems/registry.py::builtin_system_plugins`. That is the only built-in composition edit: handler, scorer, seed, trace-policy, catalog, and demo registration are derived from the plugin. Deployments with their own catalog can instead inject registries and seed separately. Keep the generic runner free of domain-specific calculations. Add focused backend tests for topology, handler output, scoring, trace projection, registry scoping, and one traced run.

If a system needs finalized dataset versions from before some runtime-input policy existed to keep evaluating, set `AgentSystemPlugin.legacy_locked_input_exemptions_module` to a module with a `legacy_locked_input_exemptions(definition, item_input) -> set[str]` function; the default exempts nothing, so `EvaluationService._require_locked_runtime_inputs` fails closed for every other system.

Graph node handlers return partial state dictionaries. The node named by `output_node` currently needs to place the focused result under the top-level `output` key. A graph may use other state keys internally, but the runner does not extract an arbitrary output key from the declared output node.

## Add an inference provider

1. Implement the contract in `backend/src/autoeval_api/inference/base.py` in a new module under `inference/`.
2. Add the provider to `inference/registry.py::default_provider_registry`, or register it with `InferenceProviderRegistry.register` and inject that registry through `app.py::create_application` in tests or another deployment.
3. Add adapter tests with network or subprocess behavior replaced by a fake transport.

Provider selection is model-ID based. Keep API keys in backend settings, use fixed outbound destinations, return normalized token/cost metadata, and never place provider secrets in trace payloads. CLI adapters must keep shell execution disabled and remain opt-in.

To add an OpenRouter model, add one `OpenRouterModelConfig` in `inference/model_catalog.py` with its stable provider slug, supported modalities, supported request parameters, data-collection routing policy, and any UI notice. Do not make the live OpenRouter catalog part of application startup: pinned local config keeps evaluations reproducible and offline startup deterministic. Verify catalog drift separately against OpenRouter's models API and cover payload differences with `httpx.MockTransport` tests.

## Add a node handler

Put system-specific handlers beside the agent under `agent_systems/<system_key>/handlers.py`. The plugin receives a registry already scoped to its system key. Register deterministic functions with `register_deterministic` and LLM response adapters with `register_llm_output`. Graph versions store the registered string name, so renaming or removing a handler can make an old graph version unrunnable; prefer adding a new name and retaining the old handler.

Use `graph/topology.py` only for graph-wide validation or ordering that is independent of a particular agent system.

## Add or change scoring

Metric contracts and registry behavior live in `backend/src/autoeval_api/services/scoring.py`. Put domain-specific metric calculation in `agent_systems/<system_key>/scoring.py`, implement `MetricSuite`, and return its dataset-key mapping from `scoring_entries`. A deployment may instead construct `ScoringRegistry` and pass it to `app.py::create_application`. Keep evaluation orchestration in `services/evaluations.py`; it should select and call a suite, not know label names.

Version a finalized ground-truth dataset when a scoring change requires new labels. Final dataset versions are immutable.

## Add a backend API domain

Add a router under `backend/src/autoeval_api/api/routes/`, put reusable query/workflow logic under `services/`, define strict public contracts in `schemas.py`, and include the router from `app.py`. Request-scoped database access belongs in `api/dependencies.py`; cross-cutting HTTP behavior belongs in `api/middleware.py`.

Keep route functions small: validate and resolve HTTP input, call one service operation, and map expected domain errors to responses. Do not move persistence or provider details into routes.

Schema changes must update both `models.py` for fresh databases and `migrations.py` for existing local databases. Migration code must preserve IDs and payloads, fail explicitly on ambiguous duplicate provenance, and remain idempotent.

## Add a frontend feature

Add a directory under `frontend/src/features/<domain>/` and keep its screen, forms, local state, hooks, tables, and charts together. Route files under `frontend/src/app/` should only render the feature entry component. Reuse the shell, modal, loading/error/empty states, and status badge from `frontend/src/components/`.

When the API changes, run `make api-types` to regenerate `frontend/openapi.json` and `frontend/src/lib/api-schema.ts` from the backend, then update `frontend/src/lib/types.ts` and `frontend/src/lib/api.ts`. `frontend/src/lib/api-contract.ts` compares the two: a renamed, removed, or retyped field fails `npm run typecheck`, and a stale generated schema fails `make check`. The hand-written types stay the ones features import — they may narrow a backend `str` to a literal union and omit fields the UI never reads, but nothing else. Put pure domain projections near the owning feature, as `features/catalog/catalog-options.ts` and `features/results/result-rows.ts` do. Do not add a global helper until more than one feature owns the same behavior.

## Validate an extension

```bash
make check
make build
make e2e
```

`make verify` runs all three. The Playwright suite starts the API and frontend through `frontend/playwright.config.ts`; mock inference keeps the default workflow deterministic and offline.

Before changing exposure, CLI access, persistence, or dependencies, read the preserved baselines in [code-security-review.md](code-security-review.md) and [dependency-security-report.md](dependency-security-report.md).
