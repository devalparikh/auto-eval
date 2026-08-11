import { describe, expect, it } from "vitest";
import {
  anchoredViewport,
  buildCodebaseFlow,
  focusNodeForLevel,
  semanticLevelForZoom,
  semanticLevelLabel,
} from "@/features/codebase/codebase-layout";
import type { CodebaseGraph, CodebaseNode } from "@/lib/types";

describe("codebase semantic layout", () => {
  it("maps zoom bands to progressively deeper structure", () => {
    expect(semanticLevelForZoom(0.7)).toBe(0);
    expect(semanticLevelForZoom(1)).toBe(1);
    expect(semanticLevelForZoom(1.4)).toBe(2);
    expect(semanticLevelForZoom(2)).toBe(3);
    expect(semanticLevelForZoom(1.2, 2)).toBe(2);
    expect(semanticLevelForZoom(1.1, 2)).toBe(1);
    expect(focusNodeForLevel(fixtureGraph().nodes, 2, "area:backend")).toBe(
      "module:backend/api",
    );
  });

  it("reveals only the focused branch and aggregates dependencies", () => {
    const graph = fixtureGraph();

    const overview = buildCodebaseFlow(graph, 0, null);
    expect(overview.nodes.map((node) => node.id)).toEqual([
      "area:frontend",
      "area:backend",
    ]);
    expect(overview.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "area:frontend",
          target: "area:backend",
        }),
      ]),
    );

    const files = buildCodebaseFlow(graph, 2, "file:frontend/src/page.tsx");
    expect(files.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "module:frontend/app",
        "file:frontend/src/page.tsx",
      ]),
    );
    expect(files.nodes.map((node) => node.id)).not.toContain(
      "file:backend/src/api.py",
    );
    expect(
      files.nodes.find((node) => node.id === "file:frontend/src/page.tsx")?.data
        .selected,
    ).toBe(true);

    const symbols = buildCodebaseFlow(graph, 3, null);
    expect(symbols.nodes.some((node) => node.id.startsWith("symbol:"))).toBe(
      true,
    );
  });

  it("keeps the focused node under the same screen point after relayout", () => {
    const flow = buildCodebaseFlow(
      fixtureGraph(),
      2,
      "module:frontend/app",
      "module:frontend/app",
    );
    const moduleNode = flow.nodes.find(
      (node) => node.id === "module:frontend/app",
    );
    expect(moduleNode).toBeDefined();
    const viewport = anchoredViewport(
      moduleNode!,
      { x: 420, y: 280 },
      1.35,
    );
    expect(viewport.zoom).toBe(1.35);
    expect(viewport.x + (moduleNode!.position.x + 98) * viewport.zoom).toBe(420);
    expect(viewport.y + (moduleNode!.position.y + 31) * viewport.zoom).toBe(280);
  });

  it("uses mode-specific semantic labels", () => {
    expect(semanticLevelLabel(2, "files")).toBe("Files");
    expect(semanticLevelLabel(2, "logic")).toBe("Capabilities");
  });
});

function fixtureGraph(): CodebaseGraph {
  const nodes: CodebaseNode[] = [
    node("area:frontend", "area", "Frontend", "frontend", null),
    node("area:backend", "area", "Backend", "backend", null),
    node(
      "module:frontend/app",
      "module",
      "app",
      "frontend/app",
      "area:frontend",
    ),
    node("module:backend/api", "module", "api", "backend/api", "area:backend"),
    node(
      "file:frontend/src/page.tsx",
      "file",
      "page.tsx",
      "frontend/src/page.tsx",
      "module:frontend/app",
    ),
    node(
      "file:backend/src/api.py",
      "file",
      "api.py",
      "backend/src/api.py",
      "module:backend/api",
    ),
    node(
      "symbol:frontend/src/page.tsx:function:Page",
      "symbol",
      "Page",
      "frontend/src/page.tsx:4",
      "file:frontend/src/page.tsx",
    ),
  ];
  return {
    mode: "files",
    model_path: null,
    repository: {
      name: "example",
      root: "/tmp/example",
      branch: "main",
      head: "abc",
      short_head: "abc",
      dirty: true,
    },
    comparison: {
      source: "working",
      label: "Local changes",
      base_ref: "abc",
      target_ref: "working tree",
    },
    summary: {
      areas: 2,
      modules: 2,
      files: 2,
      symbols: 1,
      changed_files: 1,
      additions: 3,
      deletions: 1,
      truncated: false,
    },
    nodes,
    edges: [
      {
        id: "a-m1",
        source: "area:frontend",
        target: "module:frontend/app",
        kind: "contains",
        status: "unchanged",
        label: null,
      },
      {
        id: "a-m2",
        source: "area:backend",
        target: "module:backend/api",
        kind: "contains",
        status: "unchanged",
        label: null,
      },
      {
        id: "m-f1",
        source: "module:frontend/app",
        target: "file:frontend/src/page.tsx",
        kind: "contains",
        status: "unchanged",
        label: null,
      },
      {
        id: "m-f2",
        source: "module:backend/api",
        target: "file:backend/src/api.py",
        kind: "contains",
        status: "unchanged",
        label: null,
      },
      {
        id: "f-s",
        source: "file:frontend/src/page.tsx",
        target: "symbol:frontend/src/page.tsx:function:Page",
        kind: "contains",
        status: "added",
        label: null,
      },
      {
        id: "import",
        source: "file:frontend/src/page.tsx",
        target: "file:backend/src/api.py",
        kind: "imports",
        status: "added",
        label: null,
      },
    ],
  };
}

function node(
  id: string,
  kind: CodebaseNode["kind"],
  label: string,
  path: string,
  parent_id: string | null,
): CodebaseNode {
  return {
    id,
    kind,
    label,
    path,
    parent_id,
    detail_level:
      kind === "area" ? 0 : kind === "module" ? 1 : kind === "file" ? 2 : 3,
    language: null,
    symbol_kind: null,
    line: null,
    lines: 10,
    status: id.includes("page") ? "added" : "unchanged",
    additions: id.includes("page") ? 3 : 0,
    deletions: 0,
    before_path: null,
    description: null,
    source_paths: [],
    responsibilities: [],
  };
}
