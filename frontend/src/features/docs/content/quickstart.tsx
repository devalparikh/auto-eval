import Link from "next/link";
import { CodeBlock } from "../code-block";
import { Callout, DocSection, Steps } from "../doc-blocks";

const install = `git clone https://github.com/devalparikh/auto-eval.git
cd auto-eval
cp .env.example .env
make setup
make dev`;

const sample = "/systems/incident-triage";

export function QuickstartDoc() {
  return (
    <>
      <DocSection id="install" title="Install">
        <p>
          You need Python 3.11 or later, Node 20.9 or later, and npm.
        </p>
        <CodeBlock title="Terminal" code={install} />
        <p>
          Open <code>http://localhost:3000</code>. The API listens on port{" "}
          <code>8000</code>. Keep both on loopback: AutoEval has no
          authentication.
        </p>
        <Callout>
          Reading this at <code>localhost:3000</code>? AutoEval is already
          running. Skip to the next step.
        </Callout>
      </DocSection>

      <DocSection id="run-a-sample-agent" title="Run a sample agent">
        <Steps>
          <li>
            Open <Link href={`${sample}/run`}>Incident triage → Run</Link>. The
            request input is already filled with a synthetic incident.
          </li>
          <li>
            Keep the mock model, or choose another, and select{" "}
            <strong>Run inference</strong>.
          </li>
          <li>
            When it finishes, select <strong>Inspect full trace</strong>.
          </li>
        </Steps>
      </DocSection>

      <DocSection id="inspect-the-trace" title="Inspect the trace">
        <p>
          The trace lists every node in the order it ran, with its input,
          output, latency, tokens, and cost. It also records the graph version,
          prompt versions, and model the run used. When a node fails, the trace
          keeps the error and the state that led to it.
        </p>
        <p>
          Every run you make lands in{" "}
          <Link href={`${sample}/traces`}>Traces</Link>, beside the traces the
          sample benchmark produced.
        </p>
      </DocSection>

      <DocSection id="save-a-test-case" title="Save a test case">
        <Steps>
          <li>
            On the trace, select <strong>Add to dataset</strong>.
          </li>
          <li>
            Check the expected output. It starts as the model&apos;s answer and
            becomes what every candidate is scored against, so correct it if
            the model was wrong. Then select <strong>Add example</strong>.
          </li>
          <li>
            Open <Link href={`${sample}/datasets`}>Datasets</Link> and select{" "}
            <strong>Finalize version</strong> when the draft is ready.
          </li>
        </Steps>
        <Callout tone="warning">
          Finalizing is one-way. Later edits go into a new draft version, so a
          finalized test never changes under a benchmark.
        </Callout>
      </DocSection>

      <DocSection id="run-a-benchmark" title="Run a benchmark">
        <p>
          Open <Link href={`${sample}/evaluations`}>Evaluate</Link>. Choose a
          dataset version, one or more graph versions, and the models to
          compare, then select <strong>Run benchmark</strong>. A draft offers{" "}
          <strong>Finalize &amp; run benchmark</strong>, which locks it and
          starts the run in one step.
        </p>
        <p>
          Each graph version runs as its own evaluation, one at a time, on the
          same cases.
        </p>
      </DocSection>

      <DocSection id="read-the-results" title="Read the results">
        <p>
          <Link href={`${sample}/results`}>Results</Link> lists accuracy, F1,
          precision, recall, cost, and latency for each model and graph
          version, and plots accuracy against cost. Each row links to a trace
          from the run behind it.
        </p>
        <p>
          Incident triage ships with one finished benchmark, so Results has
          data before you run anything. Next,{" "}
          <Link href="/docs/import">import your own agent</Link> or{" "}
          <Link href="/docs/models">add a hosted or local model</Link>.
        </p>
      </DocSection>
    </>
  );
}
