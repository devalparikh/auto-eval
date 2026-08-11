---
name: build-codebase-map
description: Build or adapt an interactive codebase architecture map with focus-preserving semantic zoom, file and agent-maintained logic modes, dependency edges, an inspector, and Git-aware visual diffs for working-tree, staged, commit, and pull-request changes. Use when Codex is asked to visualize a repository, create a Google-Maps-like code explorer, show graphical code diffs, add a code architecture page to an existing app, or reproduce the standalone-ready reference implementation from AutoEval.
---

# Build Codebase Map

Create a real repository explorer, not a static architecture illustration. Keep scanning and Git comparison independent of the host product so the feature can move into a standalone local app.

## Profile the repository

1. Read every applicable `AGENTS.md` and the host app's current theme/component conventions.
2. Run `python3 scripts/profile_codebase.py <repository-root>` for a quick stack and size profile.
3. Inspect installed graph libraries before adding a dependency. Reuse the host's graph/canvas primitive when it supports pan, zoom, custom nodes, and edge styling.
4. Decide whether to add a thin route to an existing app or create a separate local app. Preserve the same domain contract in either case.

## Establish the graph contract

Return one transport-neutral graph with:

- nodes for `area`, `module`, `file`, and `symbol`
- `contains` and `imports` edges
- stable IDs, logical path, parent ID, language, line count, and symbol metadata
- change status: `unchanged`, `added`, `modified`, `removed`, or `renamed`
- per-node additions and deletions
- repository, comparison, summary, truncation, and revision metadata

Expose two adapters through that contract:

- `files`: derive areas, modules, files, symbols, and imports from repository snapshots
- `logic`: read `.codemap/logic.json`, project changed source paths onto maintained systems, domains, capabilities, and components, and render explicit architectural relations

Keep the logic manifest versioned with the inspected repository. Use `$maintain-codebase-logic` to create or refresh it. When a historical comparison side lacks the manifest, use the current manifest as a projection lens rather than treating the whole architecture as newly added.

Keep parsing behind language adapters. Start with accurate Python AST parsing and conservative JavaScript/TypeScript extraction, then add languages based on the profiled repository. Resolve internal imports only when the target is unambiguous.

## Build exact Git comparisons

Construct before and after snapshots, then build one graph from their union:

| Selection | Before | After |
| --- | --- | --- |
| Structure | working tree | same working tree |
| Local | `HEAD` tree | tracked and untracked working tree |
| Staged | `HEAD` tree | Git index |
| Commit | first parent | selected commit |
| Pull request | merge base | PR head |

Include removed files and symbols as ghost nodes. Compare dependency-edge sets so added imports are green and removed imports are red. Use Git argument arrays without a shell. Validate revisions before resolving them.

For pull requests, prefer the repository's installed provider CLI or connector. Resolve base/head metadata, require the commits locally for full snapshot parsing, and return a clear recovery message when they are missing.

## Implement semantic zoom

Make zoom change the data scope, not just the pixel scale:

1. Show product areas at overview scale.
2. Reveal logical modules after the first threshold.
3. Reveal files after the second threshold.
4. Reveal symbols at maximum fidelity.

Expand only the branch under the wheel, pinch, selected node, or viewport center. Preserve that focal node's screen coordinates across relayout so users never have to pan down to find the content they just opened. Keep ancestors and siblings as context, aggregate dependencies to visible ancestors, and render only the focused branch at deeper levels.

Add hysteresis around semantic thresholds to prevent flicker. Animate viewport changes with a short ease-in-out curve, move existing nodes smoothly, and reveal newly mounted children with a restrained opacity and blur transition. Honor reduced motion.

## Compose the product surface

Keep the canvas primary. Add a compact comparison control band, diff summary, semantic-level indicator, minimap, zoom controls, diff legend, and a contextual inspector. Let selection expose containment, symbols, imports, imported-by relationships, paths, lines, and change counts.

Use the host theme tokens and interaction patterns. Use green for additions, red for removals, and a split red/green rail for modified nodes. Keep unchanged structure quiet. Provide loading, empty, error, keyboard-focus, dark, light, desktop, and mobile states.

## Preserve the local security boundary

Configure one repository root in the server process or launcher. Never accept an arbitrary filesystem path from the browser. Skip symlinks that leave the configured root, dependency/generated directories, lockfiles, oversized files, and binary content. Bound file count, file bytes, symbol count, subprocess time, and external CLI time.

Treat this feature as local-only until authentication, repository authorization, path disclosure, resource admission, and hosted subprocess boundaries are designed explicitly.

## Verify the result

1. Unit test symbol/import parsing, hierarchy grouping, rename detection, line counts, and semantic zoom thresholds.
2. Create a temporary Git repository and verify working, staged, commit, removed-file, and API behavior against real snapshots.
3. Exercise a real PR when provider access is available.
4. Run lint, type checks, unit tests, and the production build.
5. Inspect the rendered page in both themes and at desktop/mobile sizes. Zoom through all four semantic levels, select nodes, pan, refresh, and inspect browser console errors.
6. Confirm the browser cannot choose a repository path and no subprocess uses a shell.

Read [references/reference-implementation.md](references/reference-implementation.md) before copying architecture or comparing behavior with the AutoEval implementation.
