import { DocSection, Steps } from "../doc-blocks";

export function ProvenanceDoc() {
  return (
    <>
      <DocSection id="immutable-versions" title="Immutable versions">
        <p>
          Graph and prompt versions store their exact content with a SHA-256
          hash. Saving a change creates a new version. Nothing is edited in
          place, and an existing trace or result never moves to a newer
          version.
        </p>
      </DocSection>

      <DocSection id="datasets" title="Draft and finalized datasets">
        <ul>
          <li>A dataset version can change only while it is a draft.</li>
          <li>
            Finalizing is one-way. To change a finalized dataset, start a new
            draft.
          </li>
          <li>
            Only finalized versions can start evaluations.{" "}
            <strong>Finalize &amp; run benchmark</strong> does both in one step,
            and if the run then fails, the dataset stays finalized.
          </li>
        </ul>
        <p>
          Prompts and datasets belong to one agent system. A selection that
          mixes systems is rejected.
        </p>
      </DocSection>

      <DocSection id="what-a-run-pins" title="What a run pins">
        <p>Every run resolves five inputs before it starts, and its trace stores them:</p>
        <Steps>
          <li>The agent system</li>
          <li>The graph version</li>
          <li>The prompt versions, from the same system</li>
          <li>The model</li>
          <li>The request, or an item from a finalized dataset</li>
        </Steps>
        <p>A later version cannot change an existing trace or result.</p>
      </DocSection>

      <DocSection id="snapshots" title="Snapshots">
        <p>
          A snapshot is a saved copy of a node&apos;s output, such as an indexed
          portfolio or a market-data observation. Snapshots version separately
          from graphs, so editing a prompt does not force a new capture.
        </p>
        <ul>
          <li>
            A run that fetches live data can save what it fetched. A case whose
            live data was not saved cannot be added to a dataset.
          </li>
          <li>Evaluations replay the saved copy instead of calling the network.</li>
          <li>
            Live market data fails closed: a stale, missing, or incomplete
            observation rejects the candidate rather than assuming a default.
          </li>
        </ul>
      </DocSection>

      <DocSection id="graph-comparisons" title="Comparing graph versions">
        <p>
          A benchmark across graph versions runs one evaluation per version on
          the same dataset version, one at a time. Results shows each later
          version&apos;s change against the earliest, for the same model.
        </p>
      </DocSection>
    </>
  );
}
