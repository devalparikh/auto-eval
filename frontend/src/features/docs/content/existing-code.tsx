import Link from "next/link";
import { codingAgentBrief } from "@/features/systems/import-starter";
import { CodeBlock } from "../code-block";
import { DocActions, DocRow, DocSection, DocTable, ExternalLink } from "../doc-blocks";
import { DownloadButton } from "../download-button";

const EXTENSION_GUIDE =
  "https://github.com/devalparikh/auto-eval/blob/main/docs/extension-guide.md";

export function ExistingCodeDoc() {
  return (
    <>
      <DocSection id="pick-a-route" title="Pick a route">
        <p>
          Map what the agent actually does before choosing. Dropping a folder
          never installs or runs its code, so custom behavior has to be
          registered explicitly.
        </p>
        <DocTable head={["Your agent", "Route"]}>
          <DocRow term="A prompt with structured output">
            Adapt the{" "}
            <Link href="/docs/manifest#starter">starter manifest</Link>:{" "}
            <code>input</code> → <code>llm_response</code> →{" "}
            <code>output</code>.
          </DocRow>
          <DocRow term="Custom Python transforms or tools">
            Register handlers that return state updates, then import a manifest
            that names them.
          </DocRow>
          <DocRow term="Another agent framework">
            Keep the real tools, state, and control flow in an adapter. A model
            comparison needs its model calls to go through AutoEval&apos;s
            provider.
          </DocRow>
        </DocTable>
      </DocSection>

      <DocSection id="write-a-plugin" title="Write a plugin">
        <p>
          A plugin is a Python package under{" "}
          <code>backend/src/autoeval_api/agent_systems/&lt;system_key&gt;/</code>
          :
        </p>
        <DocTable head={["File", "Holds"]}>
          <DocRow term={<code>plugin.py</code>}>
            The system key, default models, input template, and optional trace
            policy.
          </DocRow>
          <DocRow term={<code>definition.py</code>}>
            The graph definition and prompt text.
          </DocRow>
          <DocRow term={<code>handlers.py</code>}>
            Deterministic transforms and model-response adapters, registered
            by <code>register_handlers</code>.
          </DocRow>
          <DocRow term={<code>scoring.py</code>}>
            <code>scoring_entries</code>: the metrics for the system&apos;s
            datasets.
          </DocRow>
          <DocRow term={<code>seed.py</code>}>
            Example records and dataset items.
          </DocRow>
          <DocRow term={<code>trace_policy.py</code>}>
            What to redact or reshape before a payload is stored or sent to a
            provider.
          </DocRow>
        </DocTable>
        <p>
          Add the package&apos;s <code>PLUGIN</code> to{" "}
          <code>builtin_system_plugins</code> in{" "}
          <code>agent_systems/registry.py</code>. Handlers, scoring, seeds, and
          the trace policy are derived from it. The{" "}
          <ExternalLink href={EXTENSION_GUIDE}>extension guide</ExternalLink>{" "}
          has the exact contracts.
        </p>
      </DocSection>

      <DocSection id="current-limits" title="Current limits">
        <ul>
          <li>
            The runner supports reachable, acyclic graphs. Conditional edges and
            loops are not supported yet.
          </li>
          <li>
            Handlers return partial state. The output node must put its result
            under the top-level <code>output</code> key.
          </li>
          <li>
            A model comparison is valid only when AutoEval&apos;s provider makes
            the model calls. A wrapper that calls a fixed model internally does
            not count.
          </li>
          <li>
            Graph versions store handler names. Renaming or removing a handler
            can make an old version unrunnable, so add a new name instead.
          </li>
        </ul>
      </DocSection>

      <DocSection id="coding-agent" title="Hand it to a coding agent">
        <p>
          Give this brief to the coding agent you already use. It inspects the
          codebase without running it and returns a manifest or the smallest
          adapter patch, plus one synthetic test case. Review its changes, then{" "}
          <Link href="/docs/import">import</Link> the result.
        </p>
        <CodeBlock
          title="Adapter brief"
          code={codingAgentBrief}
          collapsedLabel="Read the brief"
        />
        <DocActions>
          <DownloadButton
            filename="autoeval-adapter-brief.md"
            content={codingAgentBrief}
            mime="text/markdown"
          >
            Download brief
          </DownloadButton>
        </DocActions>
      </DocSection>
    </>
  );
}
