/** This same runnable example is downloadable and used throughout the onboarding guide. */
export const starterManifest = {
  schema_version: 1,
  system: {
    key: "support-summary",
    name: "Support summary",
    description: "Summarize a support request and suggest a next step.",
    input_template: {
      text: "My invoice shows two charges for the same month.",
    },
  },
  graph: {
    entry_point: "read_request",
    output_node: "return_summary",
    nodes: [
      {
        id: "read_request",
        label: "Read request",
        kind: "deterministic",
        handler: "input",
      },
      {
        id: "summarize",
        label: "Summarize request",
        kind: "llm",
        handler: "llm_response",
        task: "Summarize the support request and suggest one next step.",
        response_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            next_step: { type: "string" },
          },
          required: ["summary", "next_step"],
          additionalProperties: false,
        },
      },
      {
        id: "return_summary",
        label: "Return summary",
        kind: "deterministic",
        handler: "output",
      },
    ],
    edges: [
      { source: "read_request", target: "summarize" },
      { source: "summarize", target: "return_summary" },
    ],
  },
  prompt: {
    content:
      "You summarize support requests. Return a JSON object with summary and next_step. Use only the provided request. Do not claim to have taken any action.",
  },
};

export const starterJson = JSON.stringify(starterManifest, null, 2);

export const codingAgentBrief = `Prepare this agent codebase for AutoEval. First inspect the actual entry point, model calls, tools, state, branching, and output. Do not run the agent, install dependencies, or read environment files to inspect it.

Use autoeval.json schema_version 1: system { key, name, description, input_template }, graph { entry_point, output_node, nodes, edges }, prompt { content }. A node has id, label, kind (deterministic or llm), handler, optional task, response_schema, and prompt_key. IDs use lowercase letters, digits, and underscores; system keys use hyphens. Built-in portable handlers are input (make the request available as input), llm_response (save model JSON into response), and output (return response, otherwise input). Portable graphs use one sequential path with a deterministic output handler at the final sink. Registered adapters can supply more complex reachable acyclic graphs.

Create a manifest only if these handlers preserve this system's behavior. Never replace a tool, retrieval step, conditional, loop, or stateful transform with a pass-through. For custom behavior, produce an adapter plan using AutoEval's docs/extension-guide.md: system-scoped registered handlers, explicit state updates, tests, scoring, and trace policy. Identify unsupported behavior and any model calls that cannot use AutoEval's provider boundary.

Deliver autoeval.json or the smallest adapter patch, one synthetic input and expected output, and a concise report of preserved behavior and remaining work. Keep secrets out of manifests. Reuse the same system key when preparing a new version. Validate through AutoEval's import preview before importing.`;

export function downloadText(
  filename: string,
  content: string,
  mime = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
