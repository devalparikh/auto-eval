import Link from "next/link";
import { starterJson } from "@/features/systems/import-starter";
import { CodeBlock } from "../code-block";
import { DocActions, DocRow, DocSection, DocTable } from "../doc-blocks";
import { DownloadButton } from "../download-button";

export function ManifestDoc() {
  return (
    <>
      <DocSection id="fields" title="Fields">
        <DocTable head={["Field", "What belongs here"]}>
          <DocRow term={<code>schema_version</code>}>
            <code>1</code>. The manifest format, independent of your graph
            versions.
          </DocRow>
          <DocRow term={<code>system</code>}>
            A stable <code>key</code>, a <code>name</code>, an optional{" "}
            <code>description</code>, and a JSON{" "}
            <code>input_template</code>.
          </DocRow>
          <DocRow term={<code>graph.nodes</code>}>
            Each step&apos;s <code>id</code>, <code>label</code>,{" "}
            <code>kind</code>, and registered <code>handler</code>. Model
            nodes can add a <code>task</code>, a{" "}
            <code>response_schema</code>, and a <code>prompt_key</code>.
          </DocRow>
          <DocRow term={<code>graph.edges</code>}>
            <code>source</code> and <code>target</code> node IDs. The graph
            must be reachable and acyclic.
          </DocRow>
          <DocRow term={<code>graph.entry_point</code>}>
            The first step to run.
          </DocRow>
          <DocRow term={<code>graph.output_node</code>}>
            The step that produces the result. Its handler writes the output.
          </DocRow>
          <DocRow term={<code>prompt.content</code>}>
            The primary system prompt, stored as its own immutable version.
          </DocRow>
        </DocTable>
      </DocSection>

      <DocSection id="validation" title="Validation rules">
        <ul>
          <li>
            <code>system.key</code> identifies the system across imports: 2–120
            lowercase letters, digits, and hyphens, starting with a letter. Node
            and handler IDs use underscores instead, with 2–81 characters.
          </li>
          <li>
            Omit <code>prompt_key</code> to use the primary prompt, stored as{" "}
            <code>&lt;system-key&gt;-system</code>. Other named prompts must
            already belong to the system.
          </li>
          <li>Keep the file under 512 KiB.</li>
          <li>
            Unknown fields, unregistered handlers, cycles, duplicate edges,
            disconnected nodes, and mismatched references are rejected.
          </li>
          <li>
            The name, description, and input template belong to the system.
            Version imports keep them, and each run stores its own request.
          </li>
        </ul>
      </DocSection>

      <DocSection id="handlers" title="Built-in handlers">
        <p>
          A portable graph is one sequential path that ends with the
          deterministic <code>output</code> handler. Tools, retrieval, and other
          custom steps need <Link href="/docs/existing-code">a plugin</Link>.
        </p>
        <DocTable head={["Handler", "What it does"]}>
          <DocRow term={<code>input</code>}>
            Deterministic. Makes the request available as{" "}
            <code>input</code>.
          </DocRow>
          <DocRow term={<code>llm_response</code>}>
            Model. Saves the model&apos;s JSON object as{" "}
            <code>response</code>, which later model calls can read.
          </DocRow>
          <DocRow term={<code>output</code>}>
            Deterministic. Returns <code>response</code>, or{" "}
            <code>input</code> when no model responded.
          </DocRow>
        </DocTable>
      </DocSection>

      <DocSection id="starter" title="Starter manifest">
        <p>
          A complete, runnable example: a support-summary agent with three
          nodes. Change its key, input, and prompt to make it yours.
        </p>
        <CodeBlock title="autoeval.json" code={starterJson} />
        <DocActions>
          <DownloadButton filename="autoeval.json" content={starterJson}>
            Download starter
          </DownloadButton>
        </DocActions>
      </DocSection>
    </>
  );
}
