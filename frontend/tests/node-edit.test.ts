import { describe, expect, it } from "vitest";
import {
  applyNodeEdit,
  editableNodeFields,
  graphDraftChanged,
  graphDraftChanges,
  isNodeEditable,
} from "@/features/graph/node-edit";
import type { GraphDefinition, GraphNodeDefinition } from "@/lib/types";

const liveNode: GraphNodeDefinition = {
  id: "load_portfolio_market_data",
  label: "Resolve or fetch external options observation",
  kind: "deterministic" as const,
  handler: "load_portfolio_market_data",
  task: null,
  runtime_input_policy: {
    source: "options_chain",
    schema_version: 1,
    required: false,
    runtime_mode: "refresh" as const,
    evaluation_mode: "locked" as const,
  },
  snapshot_policy: {
    output_key: "options_chain",
    snapshot_kind: "external_observation" as const,
    schema_version: 1,
    binding_mode: "produce_or_consume" as const,
    reveal_policy_key: "external_observation",
    required: false,
  },
};

const definition: GraphDefinition = {
  entry_point: "load_portfolio_market_data",
  output_node: "answer",
  nodes: [
    liveNode,
    {
      id: "answer",
      label: "Explain computed answer",
      kind: "llm" as const,
      handler: "answer",
      task: "answer",
      prompt_key: "answer-prompt",
    },
  ],
  edges: [{ source: "load_portfolio_market_data", target: "answer" }],
};

const toLocked = {
  nodeId: "load_portfolio_market_data",
  field: "live_data_run_behaviour" as const,
  value: "locked",
};

describe("editable node fields", () => {
  it("offers a live-data node the choice of where its run data comes from", () => {
    const [field, ...rest] = editableNodeFields(liveNode);

    expect(rest).toHaveLength(0);
    expect(isNodeEditable(liveNode)).toBe(true);
    expect(field?.value).toBe("refresh");
    expect(field?.choices.map((choice) => choice.value)).toEqual([
      "refresh",
      "locked",
    ]);
    expect(field?.choices.map((choice) => choice.label)).toEqual([
      "Fetch new data each run",
      "Use a saved snapshot",
    ]);
    expect(field?.description).toContain("Evaluations always use the data");
  });

  it("tells the reader they pick the snapshot on the run page", () => {
    const [field] = editableNodeFields(liveNode);
    const saved = field?.choices.find((choice) => choice.value === "locked");

    expect(saved?.hint).toContain("choose which snapshot on the run page");
  });

  it("keeps schema and version vocabulary out of the choices", () => {
    const [field] = editableNodeFields(liveNode);
    const words = [
      field?.label,
      field?.description,
      ...(field?.choices.flatMap((choice) => [choice.label, choice.hint]) ?? []),
    ]
      .join(" ")
      .toLowerCase();

    for (const forbidden of [
      "runtime_mode",
      "runtime_input_policy",
      "policy",
      "schema",
      "graph version",
      "immutable",
      "locked",
      "refresh",
    ]) {
      expect(words).not.toContain(forbidden);
    }
  });

  it("offers nothing on a node with no settings", () => {
    const model = definition.nodes[1]!;

    expect(editableNodeFields(model)).toEqual([]);
    expect(isNodeEditable(model)).toBe(false);
  });
});

describe("applying an edit", () => {
  it("returns a new definition and leaves the original alone", () => {
    const next = applyNodeEdit(definition, toLocked);

    expect(next).not.toBe(definition);
    expect(next.nodes[0]?.runtime_input_policy?.runtime_mode).toBe("locked");
    expect(definition.nodes[0]?.runtime_input_policy?.runtime_mode).toBe(
      "refresh",
    );
    expect(next.nodes[1]).toBe(definition.nodes[1]);
  });

  it("changes only the one setting and keeps everything else on the node", () => {
    const next = applyNodeEdit(definition, toLocked);
    const policy = next.nodes[0]?.runtime_input_policy;

    expect(policy?.evaluation_mode).toBe("locked");
    expect(policy?.source).toBe("options_chain");
    expect(policy?.required).toBe(false);
    expect(next.nodes[0]?.snapshot_policy).toEqual(liveNode.snapshot_policy);
    expect(next.entry_point).toBe(definition.entry_point);
    expect(next.edges).toBe(definition.edges);
  });

  it("carries keys this app does not model through untouched", () => {
    const withExtra = {
      ...definition,
      nodes: [
        { ...liveNode, response_schema: { type: "object" } },
        definition.nodes[1],
      ],
    } as unknown as GraphDefinition;

    const next = applyNodeEdit(withExtra, toLocked) as unknown as {
      nodes: Array<Record<string, unknown>>;
    };

    expect(next.nodes[0]?.response_schema).toEqual({ type: "object" });
  });

  it("does nothing for a value already chosen, an unknown node, or a node without the setting", () => {
    expect(
      applyNodeEdit(definition, { ...toLocked, value: "refresh" }),
    ).toBe(definition);
    expect(applyNodeEdit(definition, { ...toLocked, nodeId: "missing" })).toBe(
      definition,
    );
    expect(applyNodeEdit(definition, { ...toLocked, nodeId: "answer" })).toBe(
      definition,
    );
  });

  it("ignores a value that is not one of the offered choices", () => {
    expect(applyNodeEdit(definition, { ...toLocked, value: "whatever" })).toBe(
      definition,
    );
  });
});

describe("reviewing a draft", () => {
  it("sees no difference against an equal but separate definition", () => {
    const copy = JSON.parse(JSON.stringify(definition)) as GraphDefinition;

    expect(graphDraftChanged(definition, copy)).toBe(false);
    expect(graphDraftChanges(definition, copy)).toEqual([]);
  });

  it("names the change in words the reader can check", () => {
    const next = applyNodeEdit(definition, toLocked);

    expect(graphDraftChanged(definition, next)).toBe(true);
    expect(graphDraftChanges(definition, next)).toEqual([
      {
        nodeId: "load_portfolio_market_data",
        field: "live_data_run_behaviour",
        summary:
          "Resolve or fetch external options observation — now uses a saved snapshot instead of fetching new data",
      },
    ]);
  });

  it("names the change back the other way too", () => {
    const locked = applyNodeEdit(definition, toLocked);
    const back = applyNodeEdit(locked, { ...toLocked, value: "refresh" });

    expect(graphDraftChanged(locked, back)).toBe(true);
    expect(graphDraftChanges(locked, back)[0]?.summary).toBe(
      "Resolve or fetch external options observation — now fetches new data instead of using a saved snapshot",
    );
    expect(graphDraftChanged(definition, back)).toBe(false);
  });

  it("reports a hand-edited difference it cannot narrate", () => {
    const renamed = {
      ...definition,
      nodes: [{ ...liveNode, label: "Options data" }, definition.nodes[1]!],
    } satisfies GraphDefinition;

    expect(graphDraftChanged(definition, renamed)).toBe(true);
    expect(graphDraftChanges(definition, renamed)).toEqual([]);
  });

  it("ignores a node the saved version never had", () => {
    const added = {
      ...definition,
      nodes: [
        ...definition.nodes,
        { ...liveNode, id: "extra", runtime_input_policy: undefined },
      ],
    } as unknown as GraphDefinition;

    expect(graphDraftChanges(definition, added)).toEqual([]);
  });
});
