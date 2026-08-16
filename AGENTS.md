# AutoEval house rules

A local, single-user evaluation workbench: FastAPI backend in `backend/`, Next.js
frontend in `frontend/`. Read [docs/architecture.md](docs/architecture.md) before
adding a directory, and [docs/extension-guide.md](docs/extension-guide.md) before
adding an agent system, node handler, provider, or frontend feature.

## Rules that are enforced in code — do not work around them

- **Versions are immutable.** Create a new version; never edit a finalized graph,
  prompt, dataset version, or snapshot record. Content hashes exist to catch this.
- **Only finalized dataset versions can start evaluations.**
- **Provider keys stay in the backend environment.** Nothing secret goes in a
  `NEXT_PUBLIC_*` value — those ship to the browser.
- **The code map reads only `AUTOEVAL_CODEBASE_ROOT`.** Never resolve it from a
  request-supplied path.
- **Live market data fails closed.** Stale, missing, or incomplete observations
  reject the candidate rather than assuming a benign default.
- **Schema changes need both `models.py` (fresh databases) and a new migration
  in `migrations.py` (existing ones).** Append to `MIGRATIONS`; never reorder or
  edit a migration that has shipped.

## The edit loop

```bash
make check     # the default: api-contract drift, backend lint/format/tests, frontend lint/typecheck/tests
make verify    # check + production frontend build + Playwright e2e
```

Which target for which change:

| Change | Run |
|---|---|
| Backend logic or schema | `make check` |
| Backend response schema | `make api-types`, then `make check` |
| Frontend component or feature | `make check` |
| Routing, layout, or anything visual | `make verify` |
| Dependency versions or exposure | `make verify` + read the security docs below |

## Conventions

- Backend: routes stay thin and delegate to `services/`; `app.py` is the single
  composition root. Coerce untrusted JSON with `autoeval_api/coerce.py` rather
  than adding another private `_number()`.
- Parse a graph definition with `graph/definition.py::parse_graph_definition` and
  pass the model down. Do not reach into the raw dict with `node["kind"]`.
- Frontend: `lib/api-schema.ts` is generated (`make api-types`) and never edited
  by hand; `lib/api-contract.ts` keeps the hand-written `lib/types.ts` honest
  against it. Keep domain behavior in its feature directory and promote to
  `components/` only once it is genuinely shared.
- Do not add a global helper until more than one feature owns the behavior.

## Before changing exposure, provider access, or dependencies

Read [docs/code-security-review.md](docs/code-security-review.md),
[docs/dependency-security-report.md](docs/dependency-security-report.md), and the
current disposition in
[docs/security-remediation-status.md](docs/security-remediation-status.md). This
app has no authentication — it is not to be exposed to a network.
