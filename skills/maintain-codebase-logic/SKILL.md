---
name: maintain-codebase-logic
description: Build, review, or refresh an agent-maintained `.codemap/logic.json` architecture model for an interactive codebase map. Use when Codex needs to describe a repository as systems, domains, capabilities, and components; keep that model aligned after architectural changes; assess the logical impact of a worktree, commit, or pull request; or repair an invalid or stale logic map without reducing it to folder structure.
---

# Maintain Codebase Logic

Maintain architectural judgment as versioned repository data. Describe what the software does and how responsibilities relate; use source paths only as evidence and ownership links.

## Establish the comparison

1. Read applicable `AGENTS.md`, architecture docs, package manifests, routes, entrypoints, registries, services, and high-signal tests.
2. Default to the current worktree. For a commit, inspect its parent diff. For a pull request, inspect the merge-base-to-head diff and PR description when available.
3. Read [references/logic-map-contract.md](references/logic-map-contract.md) before creating or restructuring the manifest.
4. Read an existing `.codemap/logic.json` before exploring broadly. Preserve stable IDs when responsibilities remain recognizable.

## Model behavior instead of folders

Use exactly four semantic levels:

1. `system`: independently understandable runtime or product surfaces such as frontend, backend, worker, or CLI.
2. `domain`: cohesive responsibility areas visible in product behavior or runtime architecture.
3. `capability`: user, operator, or system outcomes delivered by a domain.
4. `component`: stable implementation units that make a capability work.

Derive boundaries from execution flows, public interfaces, state ownership, versioning rules, and operational responsibilities. Do not create one logical node per directory, route, file, class, or function. Prefer 5-9 children per parent and split only when the distinction helps someone understand impact, ownership, or dependencies.

For every component:

- write a concise behavioral description
- list 1-4 responsibilities with distinct verbs
- add narrow source globs that own or implement the behavior
- keep IDs semantic and stable even when files move

Add only meaningful `depends_on`, `calls`, `produces`, and `consumes` relations. Label a relation when the data or action crossing the boundary is not obvious.

## Maintain the manifest

Update `.codemap/logic.json` when a change adds, removes, splits, merges, or materially changes a responsibility or dependency. Ordinary refactors should update source globs but retain logical IDs. Do not churn descriptions for wording alone.

For a worktree, commit, or PR:

1. Inspect the changed paths and their surrounding execution flow.
2. Identify affected existing components by source glob and responsibility.
3. Decide whether the change is implementation-only or architectural.
4. Update the target worktree manifest only when architecture or ownership changed.
5. Let the code-map framework calculate visual status by projecting Git file deltas onto the maintained model. Historical refs without a manifest use the current model as a projection lens.

If asked only to analyze a historical commit or external PR whose target worktree is unavailable, do not mutate the current manifest. Return the logical impact and ask the user to invoke this skill in the target checkout if they want the manifest updated there.

## Validate and report

Run:

```bash
python3 scripts/validate_logic_map.py .codemap/logic.json --repo-root .
```

Then run the host repository's relevant tests. Report:

- architectural nodes added, removed, or re-scoped
- relations added or removed
- source globs that no longer match
- important changed files that remain logically unowned

Use `/Users/devalparikh/Documents/Github/auto-eval/.codemap/logic.json` and its decoupled builder at `backend/src/autoeval_api/codebase/logic.py` as a reference implementation, not as a taxonomy to copy.
