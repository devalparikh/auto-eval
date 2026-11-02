import { describe, expect, it } from "vitest";
import { withActiveEdges } from "@/components/graph-canvas";
import {
  pathForSystem,
  routeContentKey,
  systemInitials,
} from "@/components/sidebar-nav";

const edges = [
  { id: "a-b", source: "a", target: "b" },
  { id: "b-c", source: "b", target: "c" },
  { id: "c-d", source: "c", target: "d" },
];

describe("withActiveEdges", () => {
  it("marks only the edges touching the selected node", () => {
    const result = withActiveEdges(edges, "b");
    expect(result.map((edge) => edge.className)).toEqual([
      "graph-edge-active",
      "graph-edge-active",
      undefined,
    ]);
  });

  it("keeps the untouched edge objects, so React Flow does not redo them", () => {
    expect(withActiveEdges(edges, "b")[2]).toBe(edges[2]);
    expect(withActiveEdges(edges, null)).toBe(edges);
  });
});

describe("sidebar navigation helpers", () => {
  it("keeps the section when switching systems", () => {
    expect(pathForSystem("/systems/a/run", "b")).toBe("/systems/b/run");
    expect(pathForSystem("/systems/a", "b")).toBe("/systems/b");
  });

  it("falls back to the list when a record has no counterpart", () => {
    expect(pathForSystem("/systems/a/traces/t1", "b")).toBe(
      "/systems/b/traces",
    );
  });

  it("keeps one content frame across traces, and a new one elsewhere", () => {
    expect(routeContentKey("/systems/a/traces/t1")).toBe("/systems/a/traces");
    expect(routeContentKey("/systems/a/traces")).toBe("/systems/a/traces");
    expect(routeContentKey("/systems/a/results")).toBe("/systems/a/results");
  });

  it("builds initials from one or two words", () => {
    expect(systemInitials("Incident triage")).toBe("IT");
    expect(systemInitials("portfolio")).toBe("PO");
  });
});
