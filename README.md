# AutoEval

AutoEval is a local-first workspace for building, tracing, versioning, and evaluating multiple LangGraph agent systems. Each system owns its graphs, prompts, traces, datasets, evaluation runs, and results so every run is reproducible and cross-system combinations are rejected.

## What works

- Immutable LangGraph and prompt versions with content hashes
- End-to-end traces with per-node inputs, outputs, latency, token usage, and cost
- Draft datasets that accept reviewed trace examples, then become immutable when finalized
- Trustworthy trace-to-dataset provenance with idempotent promotion and reverse membership
- Runtime and evaluation trace origins recorded as separate facts from dataset membership
- Evaluation runs across multiple models with exact match, accuracy, macro precision, recall, F1, cost, and latency
- Capability-aware OpenRouter and deterministic mock inference providers behind the same interface
- Optional, disabled-by-default local CLI provider boundary
- Seeded Incident Triage, Investment Portfolio Analyst, and Investment Portfolio Q&A systems
- Deterministic portfolio allocation, concentration, bucket, liquidity, and scenario analysis
- Covered-call screening over a supplied hash-verified snapshot document and option-chain data
- A dedicated system run page that persists every execution as a trace
- In-place schema migrations and SQLite foreign-key enforcement
- FastAPI unit and integration tests plus frontend unit and Playwright test harnesses

## Local setup

Requirements: Python 3.11+, Node 20.9+, and npm.

```bash
cp .env.example .env
make setup
make dev
```

Open [http://localhost:3000](http://localhost:3000). The API runs at [http://localhost:8000](http://localhost:8000), with interactive development docs at [http://localhost:8000/docs](http://localhost:8000/docs).

OpenRouter is optional. Add `OPENROUTER_API_KEY` to `.env`, then choose an OpenRouter model on a system's **Run** or **Evaluations** page. The adapter posts to the fixed API endpoint `https://openrouter.ai/api/v1/chat/completions`; `OPENROUTER_APP_URL=http://localhost:3000` is only the optional application-attribution referrer, not the API base URL. The mock models require no network or secrets.

The checked-in model catalog currently includes GPT-5.6 **Luna** (not “Luma”), DeepSeek V4 Flash, and NVIDIA Nemotron 3 Ultra (free). Model request parameters are capability-driven. The free Nemotron route is restricted to inputs explicitly marked synthetic because its provider policy is not appropriate for confidential portfolio data.

## Tests

```bash
make test
make check
make e2e
make verify
```

`make check` is the practical edit loop: backend lint, format checks, and tests plus frontend lint, type checks, and unit tests. `make verify` adds the production frontend build and Playwright end-to-end suite.

Run `make seed` to ensure all three built-in systems and their synthetic demo results exist without starting the servers.

## Project map

```text
backend/src/autoeval_api/
  api/            Route groups, request dependencies, middleware
  agent_systems/  Built-in agent definitions, handlers, scoring, seed data
  graph/          Generic LangGraph topology, registries, trace-aware runner
  inference/      Provider contract, adapters, and provider registry
  services/       Queries and workflows for each product domain
  app.py          Application composition and dependency injection
  main.py         Thin ASGI export
  models.py       SQLAlchemy persistence models
  schemas.py      Pydantic API contracts
frontend/src/
  app/            Thin Next.js route shells
  components/     Shared product UI primitives
  features/       Domain screens, forms, state, and visualizations
  lib/            Typed API client and cross-feature utilities
docs/
  architecture.md
  agent-flow-refactor-plan.md
  extension-guide.md
  code-security-review.md
  dependency-security-report.md
  security-remediation-status.md
  external-skill-review.md
```

See [the architecture](docs/architecture.md), [multi-system and provenance design](docs/multi-system-trace-provenance.md), and [extension guide](docs/extension-guide.md) before adding an agent system, inference provider, node handler, scorer, API domain, or frontend feature.

## Important boundaries

- Versions are immutable. Create a new version instead of editing a final record.
- Only finalized dataset versions can start evaluations.
- Provider keys stay in the backend environment and are never exposed through `NEXT_PUBLIC_*` values.
- The CLI provider is off by default, uses fixed commands without a shell, and has timeout and output limits.
- Evaluation work runs in-process. There is no durable queue, worker recovery, or multi-instance coordination yet.

## Current limitations

- AutoEval is a local, single-user MVP with no authentication. Do not expose it to a network or place it behind a public reverse proxy.
- The workspace ships three built-in runnable systems; creating or importing arbitrary systems still uses code-level extension seams rather than a generic creation UI.
- A persisted `AgentSystemVersion` still represents one runnable graph. Portfolio Q&A is therefore registered as a separate runnable system in this milestone; the planned `AgentSystem -> AgentFlow -> AgentFlowVersion` migration is documented in [agent-flow-refactor-plan.md](docs/agent-flow-refactor-plan.md).
- Portfolio Q&A verifies the supplied snapshot document's content hash but does not yet resolve a snapshot ID from a durable index. A stale or missing option chain returns `needs_market_data`; live broker and market-data adapters are not implemented.
- A graph definition's `output_node` is validated, but its handler currently needs to return the top-level `output` key for a focused trace result. Arbitrary output-node keys are not extracted.
- Incident traces retain full local payloads. Portfolio traces apply a code-level projection that removes identity-like fields and raw dollar values, but configurable retention and deletion policies are not implemented.
- Multimodal inputs must be provider-ready JSON references. Binary upload/storage and image or audio generation outputs are not implemented.

The preserved before-fix reviews are [dependency-security-report.md](docs/dependency-security-report.md) and [code-security-review.md](docs/code-security-review.md). Their file and line evidence reflects the captured pre-refactor layout. The current disposition of the code findings is tracked in [security-remediation-status.md](docs/security-remediation-status.md). Read them before changing exposure, provider access, or dependency versions.
