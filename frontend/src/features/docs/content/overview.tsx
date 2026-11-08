import {
  CpuIcon,
  LightningIcon,
  PackageIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { DocCards, DocRow, DocSection, DocTable } from "../doc-blocks";
import styles from "../docs.module.css";

const loop = [
  {
    title: "Connect",
    body: (
      <>
        Import a graph from one <Link href="/docs/manifest">manifest</Link>, or
        register a <Link href="/docs/existing-code">plugin</Link> for custom
        handlers and scoring.
      </>
    ),
  },
  {
    title: "Trace",
    body: "Run the agent. Each node's input, output, model call, tokens, cost, and timing are recorded.",
  },
  {
    title: "Save",
    body: "Add reviewed traces to a draft dataset with their expected answers, then finalize it.",
  },
  {
    title: "Benchmark",
    body: "Run the finalized dataset across models and graph versions. Compare quality, cost, and latency.",
  },
];

export function OverviewDoc() {
  return (
    <>
      <DocSection id="the-loop" title="The loop">
        <p>
          AutoEval answers one question: did this change make the agent better?
          Every workflow in the app is a turn of this loop.
        </p>
        <ol className={styles.loop}>
          {loop.map((step, index) => (
            <li key={step.title}>
              <span>0{index + 1}</span>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </DocSection>

      <DocSection id="concepts" title="Core concepts">
        <DocTable head={["Term", "What it is"]}>
          <DocRow term="Agent system">
            One agent with its graph versions, prompts, traces, datasets, and
            results. Selections never mix systems.
          </DocRow>
          <DocRow term="Graph version">
            A graph definition: nodes, edges, and the handler each node runs,
            saved under a content hash.
          </DocRow>
          <DocRow term="Prompt version">
            A prompt&apos;s exact text, versioned the same way.
          </DocRow>
          <DocRow term="Trace">
            One run, recorded node by node, with the versions and model it used.
          </DocRow>
          <DocRow term="Dataset version">
            Reviewed cases with expected answers. A draft can change; a
            finalized version cannot.
          </DocRow>
          <DocRow term="Evaluation">
            A finalized dataset version scored against a graph version and one
            or more models.
          </DocRow>
          <DocRow term="Snapshot">
            A saved copy of a node&apos;s output, such as fetched market data.
            Evaluations replay it instead of fetching again.
          </DocRow>
        </DocTable>
      </DocSection>

      <DocSection id="sample-agents" title="Sample agents">
        <p>
          Three agents ship with AutoEval. They run on deterministic mock
          models, so they need no API key and score the same way on every run.
        </p>
        <ul>
          <li>
            <strong>Incident triage</strong> classifies an incident, applies a
            routing policy, and drafts a response. It ships with a finalized
            dataset and a finished benchmark, so its pages have data on first
            launch. <Link href="/systems/incident-triage/run">Run it</Link> or{" "}
            <Link href="/systems/incident-triage/results">
              open its results
            </Link>
            .
          </li>
          <li>
            <strong>Investment Portfolio Analyst</strong> measures a synthetic
            portfolio&apos;s allocation, concentration, liquidity, and
            scenarios, then saves the result as a snapshot.
          </li>
          <li>
            <strong>Investment Portfolio Q&amp;A</strong> answers questions
            against that saved snapshot, so every answer can be traced to the
            exact portfolio it read.
          </li>
        </ul>
      </DocSection>

      <DocSection id="ground-rules" title="Ground rules">
        <p>
          These are enforced in code, and they are why a score from last month
          still means what it meant then.
        </p>
        <ul>
          <li>
            <strong>Versions are immutable.</strong> Changing a graph or a
            prompt saves a new version.
          </li>
          <li>
            <strong>Only finalized datasets start evaluations.</strong>{" "}
            Finalizing is one-way.
          </li>
          <li>
            <strong>Every result names what ran:</strong> the graph, prompts,
            model, dataset, and snapshots.
          </li>
          <li>
            <strong>Keys stay in the backend.</strong> Provider credentials live
            in the server environment and never reach the browser.
          </li>
          <li>
            <strong>One user, on loopback.</strong> AutoEval has no
            authentication, so keep both services on your machine.
          </li>
        </ul>
        <p>
          <Link href="/docs/provenance">Versions and provenance</Link> covers
          each rule in detail.
        </p>
      </DocSection>

      <DocSection id="next-steps" title="Next steps">
        <DocCards
          items={[
            {
              href: "/docs/quickstart",
              title: "Quickstart",
              description: "Run a sample agent and read your first benchmark.",
              icon: LightningIcon,
            },
            {
              href: "/docs/import",
              title: "Import a system",
              description: "Bring your own agent in with one manifest.",
              icon: PackageIcon,
            },
            {
              href: "/docs/models",
              title: "Model providers",
              description: "Add hosted models or run them on your machine.",
              icon: CpuIcon,
            },
          ]}
        />
      </DocSection>
    </>
  );
}
