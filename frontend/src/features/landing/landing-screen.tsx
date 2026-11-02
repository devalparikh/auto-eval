import {
  ChartBarIcon,
  DatabaseIcon,
  GitBranchIcon,
  GithubLogoIcon,
  PulseIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

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
import { ProductPreview } from "@/features/landing/product-preview";
import { TraceWaterfall } from "@/features/landing/trace-waterfall";
import styles from "@/features/landing/landing.module.css";

const GITHUB_URL = "https://github.com/devalparikh/auto-eval";

const steps = [
  {
    index: "01",
    title: "Import your agent",
    description:
      "Register your graph, handlers, and scoring from one manifest.",
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
    title: "The manifest names the system",
    description:
      "One file declares the system key, default model, and where the graph and handlers live. AutoEval discovers the rest.",
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
      "Choose what is redacted, what is stored, and what never leaves the machine. Provider keys stay in the backend environment.",
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

const faqs = [
  [
    "Do I need an API key?",
    "Not to start. The included agents run on mock models. Add an OpenRouter key for hosted models, or LM Studio for local ones.",
  ],
  [
    "Can I compare graph versions as well as models?",
    "Yes. Select any mix of graph versions and models on one finalized dataset. Results show the change in accuracy, cost, and latency against the earliest version.",
  ],
  [
    "Can I benchmark my own fine-tuned model?",
    "Yes, through LM Studio. Load the model, list it in LM_STUDIO_MODELS, and it appears beside hosted models.",
  ],
  [
    "Can I fine-tune a model in AutoEval?",
    "Yes, on Apple Silicon. Custom models fine-tunes a base model on a finalized dataset and produces a downloadable adapter. Adapters cannot be selected in a benchmark yet.",
  ],
  [
    "Do I need a specific agent framework?",
    "No. Add a code integration with your graph, handlers, scoring, and trace rules. AutoEval runs what you register.",
  ],
  [
    "Can a finalized dataset change?",
    "No. Each evaluation also records the exact graph, prompt, model, and snapshots it used, so every result traces back to what ran.",
  ],
  [
    "Is AutoEval hosted?",
    "No. It runs locally for one user with no authentication. Keep both services on loopback.",
  ],
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
      ["GitHub", GITHUB_URL],
      ["Architecture", `${GITHUB_URL}/blob/main/docs/architecture.md`],
      ["Extension guide", `${GITHUB_URL}/blob/main/docs/extension-guide.md`],
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
                Runs locally. Included agents need no API key.
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
              <a href="#workflow" className={styles.secondaryAction}>
                <span aria-hidden="true">›</span> see the workflow{" "}
                <kbd aria-hidden="true">W</kbd>
              </a>
            </LandingReveal>
          </div>
        </section>

        {/* Hero product preview */}
        <div className={`${styles.band} ${styles.bandLake}`}>
          <span className={styles.ticks} aria-hidden="true" />
          <div className={styles.bandInner}>
            <LandingReveal className={styles.previewPlacement} delay={0.1}>
              <ProductPreview variant="desktop" />
            </LandingReveal>
          </div>
        </div>

        <div className={styles.strip} aria-label="What AutoEval covers">
          <span>Evaluation workbench for agent systems</span>
          <div className={styles.stripIcons} aria-hidden="true">
            <GitBranchIcon size={15} weight="regular" />
            <PulseIcon size={15} weight="regular" />
            <DatabaseIcon size={15} weight="regular" />
            <ChartBarIcon size={15} weight="regular" />
            <ShieldCheckIcon size={15} weight="regular" />
          </div>
        </div>

        {/* Workflow */}
        <section
          id="workflow"
          className={styles.section}
          aria-labelledby="workflow-title"
        >
          <LandingReveal className={styles.sectionHead}>
            <span className={styles.eyebrow}>The loop</span>
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
            <Link href="/systems" className={styles.textLink}>
              <span aria-hidden="true">›</span> try an included agent
            </Link>
          </LandingReveal>
        </section>

        <ol className={styles.steps} aria-label="AutoEval workflow">
          {steps.map((step, index) => (
            <li key={step.index} className={styles.step}>
              <LandingReveal delay={index * 0.06} className={styles.stepInner}>
                <span className={styles.eyebrow}>Step {step.index}</span>
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
            <span className={styles.eyebrow}>Trace inspection</span>
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
            <Link href="/systems" className={styles.textLink}>
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
            <span className={styles.eyebrow}>Bring your own agent</span>
            <h2 id="modular-title">
              Use the agent
              <br />
              <Highlight tone="slate">you already have.</Highlight>
            </h2>
            <p>
              Your package owns the graph and the domain logic. AutoEval runs it
              and records the trace. No framework to adopt.
            </p>
            <a
              href={`${GITHUB_URL}/blob/main/docs/extension-guide.md`}
              className={styles.textLink}
              target="_blank"
              rel="noreferrer"
            >
              <span aria-hidden="true">›</span> read the extension guide
            </a>
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
            <span className={styles.eyebrow}>Benchmarks</span>
            <h2 id="compare-title">
              Benchmark every change
              <br />
              <Highlight tone="blue">against the same truth.</Highlight>
            </h2>
            <p>
              Run a finalized dataset across models and graph versions,
              including your own local fine-tunes. See what improved, what
              regressed, and what it cost.
            </p>
            <Link href="/systems" className={styles.textLink}>
              <span aria-hidden="true">›</span> start a benchmark
            </Link>
          </LandingReveal>
        </section>

        <div className={`${styles.band} ${styles.bandMeadow}`}>
          <span className={styles.ticks} aria-hidden="true" />
          <div className={styles.bandInner}>
            <LandingReveal className={styles.previewPlacement} delay={0.08}>
              <ProductPreview
                initialStage="evaluate"
                label="Interactive benchmark preview"
                tablistLabel="Benchmark workflow steps"
                idPrefix="model-comparison"
              />
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
            <span className={styles.eyebrow}>Provenance</span>
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
            <span className={styles.eyebrow}>Questions</span>
            <h2 id="faq-title">FAQs.</h2>
            <p>Everything else lives in the repository docs.</p>
          </LandingReveal>
          <LandingReveal delay={0.06} className={styles.faqList}>
            {faqs.map(([question, answer], index) => (
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
                {column.links.map(([label, href]) =>
                  href.startsWith("http") ? (
                    <li key={label}>
                      <a href={href} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    </li>
                  ) : (
                    <li key={label}>
                      <a href={href}>{label}</a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
          <div className={styles.footerMeta}>
            <span>Single user · no authentication · loopback only</span>
            <span className={styles.footerStatus}>
              <i aria-hidden="true" /> runs locally
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
