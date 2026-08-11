# Logic map contract

The framework reads `.codemap/logic.json` from one configured Git repository. The manifest is transport-neutral, checked into the inspected repository, and independent of the host UI or database.

## Shape

```json
{
  "schema_version": 1,
  "title": "Product logical architecture",
  "components": [
    {
      "id": "backend.execution.runner",
      "kind": "component",
      "label": "Graph runner",
      "description": "Coordinates node execution and trace construction.",
      "parent_id": "backend.execution",
      "paths": ["backend/src/product/graph/runner.py"],
      "responsibilities": ["Advance graph state", "Record node outcomes"]
    }
  ],
  "relations": [
    {
      "source": "frontend.run",
      "target": "backend.execution",
      "kind": "calls",
      "label": "submits versioned runs"
    }
  ]
}
```

## Component rules

- `id`: stable lowercase semantic identifier containing letters, digits, dots, hyphens, or underscores.
- `kind`: `system`, `domain`, `capability`, or `component`.
- `parent_id`: omitted for systems; required for all other levels and must reference the immediately preceding level.
- `label`: short human-facing name.
- `description`: one sentence explaining behavior or purpose.
- `paths`: repository-relative file or glob ownership. Never use absolute paths or `..`.
- `responsibilities`: short verb-led outcomes owned by the component.

The hierarchy must be exactly four levels deep where detail exists, but a parent may have no deeper child when more fidelity would not help. Keep systems independently understandable. Keep domains cohesive. Phrase capabilities as outcomes. Use components for stable implementation boundaries, not every symbol.

## Relation rules

- `depends_on`: the source cannot fulfill its responsibility without the target.
- `calls`: the source actively invokes the target.
- `produces`: the source creates data or evidence consumed elsewhere.
- `consumes`: the source reads data or evidence owned elsewhere.

Avoid duplicating containment as a relation. Prefer one directional edge that best explains the runtime or data flow.

## Git behavior

The viewer loads the manifest from each comparison snapshot when present. When a historical side lacks it, the current worktree manifest is used as a projection lens. Component status combines manifest changes with file deltas matching `paths`; removed components remain visible as red ghost nodes.

This makes worktree, staged, commit, and pull-request views deterministic without running an agent inside the viewer. The coding agent maintains the semantic model; the framework calculates the Git diff.
