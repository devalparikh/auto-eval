import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { starterJson } from "@/features/systems/import-starter";
import { Callout, DocActions, DocRow, DocSection, DocTable, Steps } from "../doc-blocks";
import { DownloadButton } from "../download-button";
import { ImportWalkthrough } from "../import-walkthrough";

export function ImportDoc() {
  return (
    <>
      <DocSection id="walkthrough" title="Walkthrough">
        <p>
          The starter manifest is a complete, runnable support-summary agent.
          Download it, change its key, input, and prompt, then import it.
        </p>
        <ImportWalkthrough />
        <DocActions>
          <DownloadButton filename="autoeval.json" content={starterJson}>
            Download starter
          </DownloadButton>
          <Link href="/import" className="app-button">
            Import a system <ArrowRightIcon size={14} aria-hidden="true" />
          </Link>
        </DocActions>
      </DocSection>

      <DocSection id="choose-a-source" title="Choose a source">
        <DocTable head={["What you have", "What to do"]}>
          <DocRow term="A prompt with JSON in and out">
            Adapt the <Link href="/docs/manifest#starter">starter manifest</Link>.
          </DocRow>
          <DocRow term="A prepared local codebase">
            Drop its folder on <Link href="/import">Import</Link>, or select
            its <code>autoeval.json</code>. If the folder holds several
            manifests, choose one.
          </DocRow>
          <DocRow term="A public GitHub repository">
            Paste a link to the repository, a subfolder, or the manifest. A
            commit link pins an exact revision.
          </DocRow>
          <DocRow term="A private repository">
            Clone it, then select the local folder.
          </DocRow>
          <DocRow term="Custom tools or another framework">
            <Link href="/docs/existing-code">Register a plugin</Link> first,
            then import its manifest.
          </DocRow>
          <DocRow term="A change to an existing system">
            Keep the same system key. See{" "}
            <a href="#new-versions">Import a new version</a>.
          </DocRow>
        </DocTable>
        <Callout>
          The folder reader opens only <code>autoeval.json</code> and skips
          hidden and dependency folders. It never uploads source code, installs
          packages, or runs your code.
        </Callout>
      </DocSection>

      <DocSection id="review-and-import" title="Review and import">
        <Steps>
          <li>
            <strong>Inspect.</strong> AutoEval parses the manifest, checks its
            handlers and topology, and proposes versions. Nothing is saved and
            no model is called.
          </li>
          <li>
            <strong>Review.</strong> The preview shows the graph, the full
            manifest, the prompt, the sample input, and any warnings.
          </li>
          <li>
            <strong>Import.</strong> <strong>Import system</strong> saves
            everything in one transaction. If the system changed since the
            preview, inspect it again.
          </li>
        </Steps>
        <p>
          A new system starts with an empty draft dataset scored by exact JSON
          match, unless a plugin registers its own scoring. Run the agent,{" "}
          <Link href="/docs/quickstart#save-a-test-case">
            save a reviewed trace
          </Link>{" "}
          into the draft, and finalize it before you benchmark.
        </p>
      </DocSection>

      <DocSection id="new-versions" title="Import a new version">
        <p>
          Import a manifest with the same <code>system.key</code>, or choose{" "}
          <strong>Import version</strong> in <strong>Graph &amp; prompts</strong>.
        </p>
        <ul>
          <li>Changed graphs and prompts each get a new version.</li>
          <li>
            Unchanged ones are reused, and an import that changes nothing is
            rejected.
          </li>
          <li>
            Existing traces and finalized datasets keep pointing at the versions
            they used.
          </li>
        </ul>
        <p>
          To change a graph without a file, open{" "}
          <strong>Graph &amp; prompts</strong>, choose{" "}
          <strong>Edit graph</strong>, and select{" "}
          <strong>Save new version</strong>. Moving nodes on the canvas is
          layout only and does not create a version.
        </p>
      </DocSection>
    </>
  );
}
