# Agent onboarding

AutoEval imports a validated graph contract and saves immutable versions. Start
at **Agent systems → Import system**, or open `/guide` for the interactive
walkthrough, downloadable starter, and coding-agent brief.

## Choose a route

| What you have | What to do |
| --- | --- |
| A prompt with JSON input and output | Adapt the starter `autoeval.json`. |
| A prepared local codebase | Drop its folder or select `autoeval.json`. Choose a manifest if the folder contains several. |
| A public GitHub repository | Paste its repository, subfolder, or manifest link. |
| A private repository | Clone it locally, then select the folder. |
| Custom tools, retrieval, or another agent framework | Register an adapter using [extension-guide.md](extension-guide.md), then import its manifest. |
| A revision of an existing system | Keep the same system key and choose **Import version** in Artifacts. |

The folder reader enumerates names and reads only `autoeval.json`, skipping
hidden and dependency directories. It never uploads source code, installs
packages, or runs the supplied code. GitHub import reads the selected manifest
from fixed GitHub hosts, with redirects disabled and bounded response sizes.
Use a commit ref for an unambiguous source revision. For branch names containing
slashes, use a commit link or a local folder.

## Manifest v1

The starter downloaded from `/guide` is the complete runnable example. Its
contract is deliberately small:

```json
{
  "schema_version": 1,
  "system": {
    "key": "support-summary",
    "name": "Support summary",
    "description": "Summarize support requests.",
    "input_template": { "text": "My invoice shows two charges." }
  },
  "graph": {
    "entry_point": "summarize",
    "output_node": "return_summary",
    "nodes": [
      {
        "id": "summarize",
        "label": "Summarize request",
        "kind": "llm",
        "handler": "llm_response",
        "task": "Summarize the request."
      },
      {
        "id": "return_summary",
        "label": "Return summary",
        "kind": "deterministic",
        "handler": "output"
      }
    ],
    "edges": [{ "source": "summarize", "target": "return_summary" }]
  },
  "prompt": { "content": "Return a JSON object with summary and next_step." }
}
```

- `schema_version` versions the import format. The server assigns graph and
  prompt version numbers.
- `system.key` is the identity across imports. Use 2–120 lowercase letters,
  digits, and hyphens, starting with a letter. Node and handler IDs use
  underscores instead, with 2–81 characters.
- `graph` uses the existing `AgentGraphDefinition`. LLM nodes can add a
  `response_schema`, `task`, and `prompt_key`. Omit `prompt_key` to use the
  manifest's primary prompt, stored under `<system-key>-system`.
- `prompt.content` is the primary prompt. Additional named prompts must already
  belong to the selected system; v1 does not create a prompt collection.
- Keep the file under 512 KiB. Unknown fields, unregistered handlers, cycles,
  duplicate edges, disconnected nodes, and mismatched references are rejected.
- The initial input template, name, and description belong to the system.
  Version imports preserve them. They are not execution inputs: runs store
  their exact request separately.

The schema source is `backend/src/autoeval_api/system_import_schemas.py` and the
graph source is `graph/definition.py`. OpenAPI publishes both. Extend these
contracts explicitly; do not infer runtime behavior from arbitrary source text.

## Handlers and framework adapters

Portable systems use one sequential path, ending with the deterministic
`output` handler:

| Handler | Kind | State update |
| --- | --- | --- |
| `input` | deterministic | Makes the request available as `input`. |
| `llm_response` | llm | Saves the provider's JSON object as `response`. Subsequent model calls can read it. |
| `output` | deterministic | Returns `response`, or `input` when no model response exists. |

The graph editor can add, remove, rename, and connect nodes, choose the entry
and output nodes, and edit labels, handlers, tasks, and prompt references.
Source mode preserves access to response schemas and runtime policies. Dragged
positions are editor layout only, so moving a node does not create a semantic
graph version.

For custom behavior, contribute a plugin with system-scoped handlers, scoring,
synthetic fixtures, and a trace policy as described in the extension guide.
Custom control flow and external runtimes need deliberate adapters. AutoEval's
current runner supports reachable acyclic graphs, not conditional edges or
loops. A model comparison is valid only when the selected provider controls
the relevant model calls. A wrapper that calls a fixed model internally does
not satisfy that contract.

## Import and version behavior

1. **Inspect** parses the manifest, validates handlers and topology, resolves
   existing ownership, and returns the proposed versions and a manifest hash.
   It does not write to the database or make an inference call.
2. **Review** shows the graph, full manifest, prompt, sample input, and warnings.
3. **Commit** rechecks the hash and version history, then saves everything in
   one transaction. A stale preview must be inspected again.

New systems receive an empty draft dataset with exact whole-JSON scoring.
Registered scoring for that dataset takes precedence. Review a trace into the
draft and finalize it before starting evaluations.

Changed graphs and prompts each get a new version. Unchanged content reuses its
existing version. A complete no-op import is rejected. Existing traces and
finalized datasets retain their original version references. Source labels are
unverified, descriptive import metadata, not proof of repository identity.
The success links select the imported graph and prompt versions, including
reused versions, when opening Run or Artifacts.

Endpoints: `POST /api/system-imports/inspect`,
`POST /api/system-imports/commit`, and
`GET /api/system-imports/handlers?system_key=...`.

## Local inference

Load a model in LM Studio, start its local server, and inspect
`http://127.0.0.1:1234/v1/models`. Set these backend environment values:

```dotenv
ENABLE_LM_STUDIO=true
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_MODELS=your-loaded-model-id
```

Restart AutoEval after saving `.env`. Its catalog exposes
`lmstudio/your-loaded-model-id`. IDs can be comma-separated. Optional
`LM_STUDIO_API_TOKEN` stays in the backend. Configuration does not prove the
server is running; a run checks actual availability.

The adapter uses bounded OpenAI-compatible chat completions, forwards JSON
schemas, rejects incomplete or invalid output, and records provider-reported
tokens and model identity. API cost is zero, excluding hardware and electricity.
The URL must be HTTP loopback with an explicit port and `/v1` path. Local
inference is disabled in the production profile.

Verified against [LM Studio's OpenAI-compatible API](https://lmstudio.ai/docs/developer/openai-compat)
and [structured output documentation](https://lmstudio.ai/docs/developer/openai-compat/structured-output).

## AI-assisted import decision

The first release uses deterministic import and a downloadable coding-agent
brief. A coding agent can inspect an unfamiliar system and prepare its manifest
or adapter; the same validator remains the acceptance boundary.

An embedded coding worker is a later extension. It needs an isolated checkout,
bounded execution, cancellation, a reviewable patch, synthetic parity tests,
and an explicit accept action before registration. The
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) can automate coding work;
it does not establish that a converted graph preserves another framework's
behavior. Add it when actual adapter work justifies that execution boundary.

No coding SDK or paid model dependency is required for onboarding today.
