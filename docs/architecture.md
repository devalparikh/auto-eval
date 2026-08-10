# Architecture

AutoEval separates reusable execution infrastructure from each agent system's domain logic. The backend composes registries and services once; an agent package contributes one plugin manifest plus definitions, handlers, seed data, optional scoring, and an optional trace policy. The frontend follows the same rule: routes select a feature screen, while the feature owns its forms and state.

Each run compiles only the selected graph definition into its own LangGraph instance. Handler names are resolved through a system-scoped registry, so two growing systems may use the same local handler name without collision. AutoEval never constructs one global LangGraph containing nodes from every registered system.

## Reproducibility contract

Every run resolves five inputs before execution. A product may expose multiple flow registrations,
but one run still selects exactly one graph:

1. owning agent system
2. agent system version
3. same-system prompt version
4. inference model
5. request or finalized same-system dataset item

The trace stores those resolved IDs. A later version cannot change an existing trace or evaluation result.

## Data flow

```mermaid
flowchart LR
  Request[Request or dataset item] --> Resolve[Resolve exact versions]
  Resolve --> Graph[Compile LangGraph definition]
  Graph --> Node[Run traced nodes]
  Node --> Provider[Inference provider adapter]
  Node --> Deterministic[Deterministic node registry]
  Provider --> Spans[Trace spans]
  Deterministic --> Spans
  Spans --> Trace[End-to-end trace]
  Trace --> Review[Human review]
  Review --> Draft[Draft dataset version]
  Draft --> Final[Finalize immutable version]
  Final --> Eval[Multi-model evaluation]
  Eval --> Metrics[Quality, cost, latency]
```

## Version rules

- `AgentSystemVersion` stores a validated graph definition and SHA-256 content hash.
- `PromptVersion` stores the exact system prompt and SHA-256 content hash.
- `DatasetVersion` is mutable only while its status is `draft`.
- Finalizing a dataset version is one-way. Further edits require a new draft version.
- Evaluation runs accept only final dataset versions.
- Prompts and datasets belong to one agent system; cross-system selections are rejected.
- Trace execution origin and trace-to-dataset membership are independent provenance facts.

## Backend ownership

```text
autoeval_api/
  main.py                   ASGI export only
  app.py                    application composition, injection, lifespan
  api/
    dependencies.py         request-scoped dependencies
    middleware.py           request limits and security headers
    routes/                 one router per API domain
  agent_systems/
    registry.py             plugin composition and code-level UX metadata
    incident_triage/        built-in incident example
    portfolio_analyst/      synthetic portfolio analyst and deterministic math
    portfolio_query/        supplied-snapshot questions and covered-call screening
    seed.py                 built-in seed composition
  graph/                    generic topology, node registry, runner
  inference/                provider contract, adapters, registry
  market_data/              registered runtime capabilities and Tradier options adapter
  services/                 domain workflows, queries, serialization, scoring
  models.py                 persistence records
  migrations.py             additive upgrade path for the original SQLite schema
  schemas.py                public request and response contracts
```

Routes validate HTTP input and translate domain errors. Services own domain queries and workflows. The graph runner owns orchestration and span capture. Agent-system packages own domain-specific definitions and behavior. `app.py` is the composition root for replacing those dependencies without teaching routes about concrete providers or handlers.

## Implemented extension points

- `inference/base.py` defines the provider contract. `InferenceProviderRegistry.register` adds an adapter without changing the runner. OpenRouter model capabilities live in the typed, deterministic `inference/model_catalog.py` rather than being fetched at process startup.
- LLM span output records allowlisted inference metadata, including OpenRouter's returned resolved model ID and request ID, alongside requested model provenance on the parent trace.
- `graph/registry.py` registers deterministic and LLM-output handlers under `(system_key, handler_name)`. The runner resolves handlers through the selected system scope.
- `services/scoring.py` composes metric suites contributed by system plugins. Evaluation orchestration asks the registry for a suite instead of importing a concrete system.
- `agent_systems/registry.py::builtin_system_plugins` is the single built-in composition root. Each package exports `plugin.py` and keeps its definition, handlers, scoring, seed data, and trace projection local.
- The shared graph state has only `input`, a mergeable system-owned `data` envelope, and `output`; adding a system does not require adding domain fields to a global state type.
- Request-scoped `GraphRuntimeContext` carries repositories and local resources that must not enter graph state. Portfolio Query uses it to resolve a full snapshot locally, then an explicit deterministic node constructs the provider-safe model context.
- A node may declare a registered `runtime_input_policy` capability with separate direct-runtime and evaluation modes. The runner resolves direct Portfolio Q&A to `refresh` and evaluations to `locked`; locked mode requires the recorded fixture and cannot call a provider. The observation is runtime provenance, not graph or prompt version content.

There is currently no `DatasetImporter`, `ArtifactStore`, or `EvaluationDispatcher` interface. Dataset edits use the dataset service, payloads are stored as JSON in SQLite, and evaluation background work runs in the FastAPI process. Introduce a real interface only when adding a second implementation.

`AgentSystemSpec` is deliberately code-level. It supplies default models, an input template, editor identity, and the primary metric without trying to turn every agent UX into a database-driven form builder. Unknown registered systems receive generic JSON fallbacks.

## Frontend ownership

```text
frontend/src/
  app/                 route shells and global layout
  components/          shared shell, modal, status, and state UI
  features/
    catalog/            catalog projections
    traces/             trace list, run flow, DAG, inspector, review flow
    datasets/           draft editing and finalization
    evaluations/        model selection, launch, and polling
    run/                one-off pinned inference and latest trace result
    results/            tables, row projection, and cost/accuracy chart
    systems/            graph and prompt version editors
  lib/                 API client, DTOs, formatting, shared data hook, CSP
```

Keep domain behavior in its feature directory. Promote a component to `components/` only after it is genuinely shared. `lib/api.ts` and `lib/types.ts` are the frontend boundary for backend contract changes.

## Selection and output behavior

- A request or evaluation may omit graph and prompt version IDs. Resolution is always scoped to the selected system; omitting the system retains Incident Triage as the compatibility default.
- `output_node` must name a node in the graph definition. The runner currently expects the completed graph state to contain a top-level `output` key; otherwise the complete state becomes the trace output.
- All sink nodes connect to LangGraph `END`. `output_node` does not currently choose one sink when a graph branches.

## Local MVP boundaries

- SQLite and the in-process evaluation task are suitable for local, single-process use only.
- There is no authentication or authorization. Keep both servers on loopback.
- Trace capture and outbound inference are separate policy boundaries. Non-synthetic portfolio traces remove identity-like fields, exact shares, symbols, and raw dollar values; provider calls receive only an explicit typed model context. Synthetic fixtures may retain richer local trace output for evaluation and inspection.
- Provider secrets live only in the backend environment. CLI providers are disabled by default and cross a high-trust local execution boundary when enabled.
- Inputs and outputs persist as JSON. Providers may accept referenced multimodal input objects, but binary artifact storage and generated image, audio, or video outputs are future work.

See [extension-guide.md](extension-guide.md) for concrete edit paths and [code-security-review.md](code-security-review.md) plus [dependency-security-report.md](dependency-security-report.md) for the preserved before-fix security baseline.

## Built-in agent systems

The seeded incident-triage graph normalizes an incident report, asks an LLM for structured classification, applies deterministic routing policy, and drafts an operator response. Ground truth contains severity, route, and human-review requirement. This produces interpretable classification metrics without pretending that free-form text has a single objectively correct answer.

The Portfolio Analyst index flow normalizes supplied profile and holding context, identifies missing inputs, calculates allocation, concentration, bucket ranges, liquidity, and user-supplied scenarios deterministically, asks a model to explain those facts, applies a deterministic financial-safety gate, and persists an immutable snapshot outside LangGraph state. Its fixtures are synthetic and its evaluation checks arithmetic invariants rather than treating prose as objective truth.

The Portfolio Analyst query flow accepts a snapshot ID and question. It resolves the canonical snapshot from immutable local storage through request-scoped runtime context; the full snapshot never enters query graph state. A separate deterministic node either consumes a locked fixture or refreshes the registered options-chain capability. The initial live adapter uses Tradier with explicit timeout/size limits and records source, mode, provider reference, as-of/fetch time, quote delay/freshness, separate Greeks provenance, and contract count. Full real chains remain request-local. Tradier sandbox data is 15 minutes delayed with no Greeks; production brokerage quotes are real-time and Greeks are hourly. For covered-call questions, deterministic handlers validate call type, standard contract multiplier, quote freshness, lot-level share coverage and restrictions, DTE, delta availability/range, liquidity, spread, event timing, assignment constraints, premium math, and ranking. Unknown earnings timing fails closed when the blackout is enabled. Duplicate-symbol lots are aggregated without allowing an ineligible sleeve to overwrite an eligible one. The model receives the bounded question plus typed, allowlisted facts, safe market provenance, and aliased candidates; provider contract symbols never enter inference.

Portfolio Analyst is one logical product with separate `index` and `query` flow manifests. The catalog and Run UI expose that relationship while the current compatibility storage keeps independent runtime keys and graph-version histories. The normalized persistent multi-flow model is specified in [agent-flow-refactor-plan.md](agent-flow-refactor-plan.md). The two graphs are never merged.
