import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

import { DottedText } from "@/components/dotted-text";
import {
  GraphVisual,
  HandlersVisual,
  HashVisual,
  KeysVisual,
  LockVisual,
  ManifestVisual,
  PolicyVisual,
  SnapshotVisual,
} from "@/features/landing/feature-cards";
import { Highlight } from "@/features/landing/landing-highlight";
import { LandingHotkeys } from "@/features/landing/landing-hotkeys";
import { LandingReveal } from "@/features/landing/landing-reveal";
import { StepMark } from "@/features/landing/step-marks";
import {
  BenchmarkPreview,
  ProductPreview,
} from "@/features/landing/product-preview";
import { TraceWaterfall } from "@/features/landing/trace-waterfall";
import styles from "@/features/landing/landing.module.css";

const GITHUB_URL = "https://github.com/devalparikh/auto-eval";
// Seeded on first start with a finalized dataset, a trace, and a finished
// benchmark, so these links always land on something real.
const SAMPLE_SYSTEM = "/systems/incident-triage";

const steps = [
  {
    index: "01",
    title: "Connect your agent",
    description:
      "One manifest describes the graph. A plugin adds custom handlers and scoring.",
  },
  {
    index: "02",
    title: "Run and inspect the trace",
    description:
      "See every node, model call, input, output, cost, and timing in one place.",
  },
  {
    index: "03",
    title: "Save the useful cases",
    description:
      "Turn reviewed traces into a dataset, then finalize it to lock the test.",
  },
  {
    index: "04",
    title: "Test every model and graph change",
    description:
      "Run the same locked cases against each one. Compare quality, cost, and latency.",
  },
];

const integrationCards = [
  {
    title: "One plugin registers the system",
    description:
      "One file declares the system key, default models, and the package that holds the graph and handlers. AutoEval derives the rest.",
    visual: <ManifestVisual />,
  },
  {
    title: "The graph is the workflow",
    description:
      "One path, typed by step. Deterministic steps replay, live steps read a frozen snapshot, and model steps call the candidate.",
    visual: <GraphVisual />,
  },
  {
    title: "Handlers and scoring stay with you",
    description:
      "Domain logic never moves into the workbench. Your package registers handlers and scoring entries; AutoEval calls them.",
    visual: <HandlersVisual />,
  },
  {
    title: "Trace policy decides what persists",
    description:
      "Choose what is redacted, what is stored, and what never leaves the machine.",
    visual: <PolicyVisual />,
  },
];

const provenanceCards = [
  {
    title: "Content hashes",
    description:
      "Graphs and prompts are versioned by content. Nothing is edited in place.",
    visual: <HashVisual />,
  },
  {
    title: "Locked datasets",
    description:
      "Finalizing freezes the cases every candidate is measured on.",
    visual: <LockVisual />,
  },
  {
    title: "Pinned snapshots",
    description:
      "External data is captured once and frozen with the case. A score change next month means your agent changed, not the world.",
    visual: <SnapshotVisual />,
  },
  {
    title: "Keys stay in the backend",
    description:
      "Provider credentials stay in the server environment and never reach the browser.",
    visual: <KeysVisual />,
  },
];

const faqs: { question: string; answer: ReactNode }[] = [
  {
    question: "Do I need an API key?",
    answer: (
      <>
        Not to start. The sample agents run on mock models. Set{" "}
        <code>OPENROUTER_API_KEY</code> for hosted models, or connect LM Studio
        for local ones.
      </>
    ),
  },
  {
    question: "Do I need a specific agent framework?",
    answer:
      "No. Describe your graph in one manifest, or add a plugin for custom handlers and scoring. Graphs must be acyclic for now, with no loops or conditional edges.",
  },
  {
    question: "Can I compare graph versions as well as models?",
    answer:
      "Yes. Select any mix of graph versions and models on one finalized dataset. Results show the change in accuracy, cost, and latency against the earliest version.",
  },
  {
    question: "Can I benchmark my own fine-tuned model?",
    answer: (
      <>
        Yes, through LM Studio. Load the model, list it in{" "}
        <code>LM_STUDIO_MODELS</code>, and it appears beside hosted models.
      </>
    ),
  },
  {
    question: "Can I fine-tune a model in AutoEval?",
    answer:
      "Yes, on Apple Silicon. Custom models trains a LoRA adapter on a finalized dataset, ready to download. Adapters can't be picked in a benchmark yet.",
  },
  {
    question: "Can a finalized dataset change?",
    answer:
      "No. You start a new draft version instead. Each evaluation also records the exact graph, prompt, model, and snapshots it used, so every result traces back to what ran.",
  },
  {
    question: "Is AutoEval hosted?",
    answer: (
      <>
        No. It runs on your machine for one user, with no authentication, so
        keep both services on loopback. Setup takes a few commands; the{" "}
        <Link href="/docs/quickstart">quickstart</Link> lists them.
      </>
    ),
  },
];

const footerColumns = [
  {
    heading: "Product",
    links: [
      ["Workflow", "#workflow"],
      ["Trace inspection", "#trace"],
      ["Bring your agent", "#modular"],
      ["Benchmarks", "#compare"],
      ["Provenance", "#provenance"],
    ],
  },
  {
    heading: "Resources",
    links: [
      ["Docs", "/docs"],
      ["Quickstart", "/docs/quickstart"],
      ["GitHub", GITHUB_URL],
      ["Architecture", `${GITHUB_URL}/blob/main/docs/architecture.md`],
      [
        "Security notes",
        `${GITHUB_URL}/blob/main/docs/code-security-review.md`,
      ],
    ],
  },
];

export function LandingScreen() {
  return (
    <div className={styles.landing}>
      <LandingHotkeys />
      <div className={styles.frame}>
        {/* Hero */}
        <section className={styles.hero} aria-labelledby="landing-title">
          <LandingReveal mode="load" className={styles.heroTitle}>
            <h1 id="landing-title">
              Trace your agent.{" "}
              <DottedText color="var(--landing-accent)">
                Test every change.
              </DottedText>
            </h1>
          </LandingReveal>
          <div className={styles.heroRow}>
            <LandingReveal mode="load" delay={0.08} className={styles.heroCopy}>
              <p>
                See every node and model call. Save real runs as tests.
                Benchmark each model, prompt, and graph change on quality, cost,
                and latency.
              </p>
              <p className={styles.actionNote}>
                Runs on your machine. No sign-up, and the sample agents need no
                API key.
              </p>
            </LandingReveal>
            <LandingReveal mode="load" delay={0.16} className={styles.actions}>
              <Link
                href="/systems"
                className={styles.primaryAction}
                data-sound="navigate"
              >
                start benchmarking <kbd aria-hidden="true">B</kbd>
              </Link>
              <Link href="/docs" className={styles.secondaryAction}>
                <span aria-hidden="true">›</span> read the docs{" "}
                <kbd aria-hidden="true">D</kbd>
              </Link>
            </LandingReveal>
          </div>
        </section>

        {/* Hero product preview */}
        <div className={`${styles.band} ${styles.bandLake}`}>
          <span className={styles.ticks} aria-hidden="true" />
          <div className={styles.bandInner}>
            <LandingReveal className={styles.previewPlacement} delay={0.1}>
              <ProductPreview />
            </LandingReveal>
          </div>
        </div>

        {/* Workflow */}
        <section
          id="workflow"
          className={styles.section}
          aria-labelledby="workflow-title"
        >
          <LandingReveal className={styles.sectionHead}>
            <h2 id="workflow-title">
              One run becomes
              <br />
              <Highlight tone="coral">a repeatable test.</Highlight>
            </h2>
            <p>
              Save a reviewed trace as a test case. Its input, expected answer,
              and runtime data are locked, so every model and graph version
              faces the same test.
            </p>
            <Link href={`${SAMPLE_SYSTEM}/run`} className={styles.textLink}>
              <span aria-hidden="true">›</span> run a sample agent
            </Link>
          </LandingReveal>
        </section>

        <ol className={styles.steps} aria-label="AutoEval workflow">
          {steps.map((step, index) => (
            <li key={step.index} className={styles.step}>
              <LandingReveal delay={index * 0.06} className={styles.stepInner}>
                <span className={styles.stepIndex}>{step.index}</span>
                <StepMark index={index} />
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </LandingReveal>
            </li>
          ))}
        </ol>

        {/* Trace inspection */}
        <section
          id="trace"
          className={`${styles.section} ${styles.sectionTrace}`}
          aria-labelledby="trace-title"
        >
          <LandingReveal className={styles.sectionHead}>
            <h2 id="trace-title">
              See what the agent did
              <br />
              <Highlight tone="green">and where it went wrong.</Highlight>
            </h2>
            <p>
              Every run is recorded node by node: inputs, outputs, model calls,
              tokens, cost, and timing. Failures keep the context that caused
              them.
            </p>
            <Link href={`${SAMPLE_SYSTEM}/traces`} className={styles.textLink}>
              <span aria-hidden="true">›</span> inspect a sample trace
            </Link>
          </LandingReveal>
        </section>

        <div className={`${styles.band} ${styles.bandTrace}`}>
          <span className={styles.ticks} aria-hidden="true" />
          <div className={styles.bandInner}>
            <LandingReveal delay={0.08}>
              <TraceWaterfall />
            </LandingReveal>
          </div>
        </div>

        {/* Bring your own agent */}
        <section
          id="modular"
          className={`${styles.section} ${styles.sectionModular}`}
          aria-labelledby="modular-title"
        >
          <LandingReveal className={styles.sectionHead}>
            <h2 id="modular-title">
              Use the agent
              <br />
              <Highlight tone="slate">you already have.</Highlight>
            </h2>
            <p>
              Your package owns the graph and the domain logic. AutoEval runs it
              and records the trace. No framework to adopt.
            </p>
            <Link href="/docs/import" className={styles.textLink}>
              <span aria-hidden="true">›</span> how to connect your agent
            </Link>
          </LandingReveal>
          <div className={styles.cardGrid}>
            {integrationCards.map((card, index) => (
              <LandingReveal
                key={card.title}
                delay={index * 0.06}
                className={styles.cardShell}
              >
                <div className={styles.card}>
                  <div className={styles.cardCopy}>
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>
                  <div className={styles.cardVisual}>{card.visual}</div>
                </div>
              </LandingReveal>
            ))}
          </div>
        </section>

        {/* Model comparison */}
        <section
          id="compare"
          className={`${styles.section} ${styles.sectionCompare}`}
          aria-labelledby="compare-title"
        >
          <LandingReveal className={styles.sectionHead}>
            <h2 id="compare-title">
              Benchmark every change
              <br />
              <Highlight tone="blue">against the same truth.</Highlight>
            </h2>
            <p>
              Run a finalized dataset across models and graph versions,
              including your own fine-tunes served through LM Studio. See what
              improved, what regressed, and what it cost.
            </p>
            <Link href={`${SAMPLE_SYSTEM}/results`} className={styles.textLink}>
              <span aria-hidden="true">›</span> see sample results
            </Link>
          </LandingReveal>
        </section>

        <div className={`${styles.band} ${styles.bandMeadow}`}>
          <span className={styles.ticks} aria-hidden="true" />
          <div className={styles.bandInner}>
            <LandingReveal className={styles.previewPlacement} delay={0.08}>
              <BenchmarkPreview />
            </LandingReveal>
          </div>
        </div>

        {/* Provenance */}
        <section
          id="provenance"
          className={`${styles.section} ${styles.sectionProvenance}`}
          aria-labelledby="provenance-title"
        >
          <LandingReveal className={styles.sectionHead}>
            <h2 id="provenance-title">
              Every result points back
              <br />
              <Highlight tone="sand">to what ran.</Highlight>
            </h2>
            <p>
              Evaluations pin the graph, prompt, model, dataset, and runtime
              snapshots before work starts. Versions are immutable, so last
              month&rsquo;s score still means what it meant then.
            </p>
          </LandingReveal>
          <div className={`${styles.cardGrid} ${styles.cardGridFour}`}>
            {provenanceCards.map((card, index) => (
              <LandingReveal
                key={card.title}
                delay={index * 0.06}
                className={styles.cardShell}
              >
                <div className={`${styles.card} ${styles.cardCompact}`}>
                  <div className={styles.cardCopy}>
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>
                  <div className={styles.cardVisual}>{card.visual}</div>
                </div>
              </LandingReveal>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section
          id="faq"
          className={styles.faqBand}
          aria-labelledby="faq-title"
        >
          <LandingReveal className={styles.faqTitle}>
            <h2 id="faq-title">FAQs.</h2>
            <p>
              Everything else is in the <Link href="/docs">docs</Link>.
            </p>
          </LandingReveal>
          <LandingReveal delay={0.06} className={styles.faqList}>
            {faqs.map(({ question, answer }, index) => (
              <details
                key={question}
                className={styles.faqItem}
                open={index === 0}
              >
                <summary>
                  <span>{question}</span>
                  <b aria-hidden="true">+</b>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </LandingReveal>
        </section>

        {/* Final call to action */}
        <section
          className={`${styles.band} ${styles.bandCta}`}
          aria-labelledby="landing-cta-title"
        >
          <span className={styles.ticks} aria-hidden="true" />
          <LandingReveal className={styles.finalContent}>
            <h2 id="landing-cta-title">
              Know which change
              <br />
              actually helped.
            </h2>
            <div className={styles.finalActions}>
              <Link
                href="/systems"
                className={styles.finalPrimary}
                data-sound="navigate"
              >
                start benchmarking <kbd aria-hidden="true">B</kbd>
              </Link>
              <a
                href={GITHUB_URL}
                className={styles.finalSecondary}
                target="_blank"
                rel="noreferrer"
              >
                <GithubLogoIcon size={14} weight="regular" aria-hidden="true" />
                view on github <kbd aria-hidden="true">G</kbd>
              </a>
            </div>
          </LandingReveal>
        </section>

        {/* Footer */}
        <footer className={styles.footer}>
          <div className={styles.footerBrand}>
            <span aria-hidden="true">a/e</span>
            <div>
              <strong>AutoEval</strong>
              <p>A local evaluation workbench for agent systems.</p>
            </div>
          </div>
          {footerColumns.map((column) => (
            <div key={column.heading} className={styles.footerColumn}>
              <span className={styles.eyebrow}>{column.heading}</span>
              <ul>
                {column.links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith("http") ? (
                      <a href={href} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    ) : href.startsWith("#") ? (
                      <a href={href}>{label}</a>
                    ) : (
                      <Link href={href}>{label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </footer>
      </div>
    </div>
  );
}
