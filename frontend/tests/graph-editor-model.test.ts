import { describe, expect, it } from "vitest";
import {
  addGraphEdge,
  addGraphNode,
  graphDefinitionFromSource,
  graphDefinitionToSource,
  removeGraphNode,
  updateGraphNode,
  validateGraphDefinition,
  type EditableGraphDefinition,
} from "@/features/systems/graph-editor-model";

const definition = {
  entry_point: "prepare",
  output_node: "answer",
  metadata: { owner: "evaluation" },
  nodes: [
    {
      id: "prepare",
      label: "Prepare",
      kind: "deterministic",
      handler: "input",
      task: null,
      runtime_input_policy: {
        source: "request",
        runtime_mode: "refresh",
        evaluation_mode: "locked",
        schema_version: 1,
        required: true,
      },
      response_schema: { type: "object" },
    },
    {
      id: "answer",
      label: "Answer",
      kind: "llm",
      handler: "llm_response",
      task: "Answer",
      prompt_key: "answer-prompt",
    },
  ],
  edges: [{ source: "prepare", target: "answer" }],
} satisfies EditableGraphDefinition;

describe("graph editor model", () => {
  it("round trips advanced and unknown fields through visual edits", () => {
    const parsed = graphDefinitionFromSource(JSON.stringify(definition));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const updated = updateGraphNode(parsed.definition, "prepare", {
      label: "Prepare request",
    });
    const reparsed = graphDefinitionFromSource(
      graphDefinitionToSource(updated),
    );
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    expect(reparsed.definition.metadata).toEqual({ owner: "evaluation" });
    expect(reparsed.definition.nodes[0]?.runtime_input_policy).toEqual(
      definition.nodes[0].runtime_input_policy,
    );
    expect(reparsed.definition.nodes[0]?.response_schema).toEqual({
      type: "object",
    });
  });

  it("renames and removes nodes without leaving broken topology", () => {
    const renamed = updateGraphNode(definition, "prepare", {
      id: "load_input",
    });
    expect(renamed.entry_point).toBe("load_input");
    expect(renamed.edges).toEqual([{ source: "load_input", target: "answer" }]);

    const removed = removeGraphNode(renamed, "answer");
    expect(removed.output_node).toBe("load_input");
    expect(removed.edges).toEqual([]);
    expect(validateGraphDefinition(removed)).toEqual([]);
  });

  it("adds nodes and edges and rejects duplicate or cyclic topology", () => {
    const added = addGraphNode(definition, "deterministic", "output");
    expect(added.nodeId).toBe("new_node");
    const connected = { ...addGraphEdge(added.definition, "answer", added.nodeId), output_node: added.nodeId };
    expect(validateGraphDefinition(connected)).toEqual([]);
    expect(addGraphEdge(connected, "answer", added.nodeId)).toBe(connected);

    const cyclic = addGraphEdge(connected, added.nodeId, "prepare");
    expect(validateGraphDefinition(cyclic)).toContainEqual({
      path: "edges",
      message: "The graph must be acyclic.",
    });
  });
});
