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
import { ProductPreview } from "@/features/landing/product-preview";
import { TraceWaterfall } from "@/features/landing/trace-waterfall";
import styles from "@/features/landing/landing.module.css";

const GITHUB_URL = "https://github.com/devalparikh/auto-eval";

const steps = [
  {
    index: "01",
    title: "Connect your agent",
    description:
      "Register the graph, handlers, scoring code, and provider adapters that already live in your package.",
  },
  {
    index: "02",
    title: "Run and inspect the trace",
    description:
      "Every node, model call, input, output, token count, cost, and timing lands in one recorded run.",
  },
  {
    index: "03",
    title: "Save the useful cases",
    description:
      "Promote reviewed traces into a draft dataset, then finalize it once the cases are worth locking.",
  },
  {
    index: "04",
    title: "Test every model",
    description:
      "Run the locked cases against each candidate and compare quality, cost, and latency side by side.",
  },
];

const integrationCards = [
  {
    title: "The manifest names the system",
    description:
      "One small file declares the system key, default model, and where the graph and handlers live. AutoEval discovers the rest.",
    visual: <ManifestVisual />,
  },
  {
    title: "The graph is the workflow",
    description:
      "One path, typed by step. Deterministic steps replay, live steps read a frozen snapshot, and model steps call the candidate, so a trace reads the way the graph does.",
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
      "Graphs and prompts are versioned by content. The same bytes always resolve to the same version, so nothing is edited in place.",
    visual: <HashVisual />,
  },
  {
    title: "Locked datasets",
    description:
      "Only a finalized dataset version can start an evaluation. Finalizing freezes the cases every candidate will be measured on.",
    visual: <LockVisual />,
  },
  {
    title: "Pinned snapshots",
    description:
      "External data is captured once and frozen with the case. Rerun it next month and the run sees the same inputs, so a score change means the model changed, not the world.",
    visual: <SnapshotVisual />,
  },
  {
    title: "Keys stay in the backend",
    description:
      "Provider credentials are read from the server environment only. Nothing secret is ever shipped to the browser bundle.",
    visual: <KeysVisual />,
  },
];

const faqs = [
  [
    "Do I need a specific agent framework?",
    "No. Add a code integration with your graph, handlers, scoring, and any trace rules your system needs. AutoEval runs what you register.",
  ],
  [
    "Can I compare models and providers?",
    "Yes. AutoEval runs the same finalized dataset against every model you select through one provider interface, then lines up quality, cost, and latency.",
  ],
  [
    "Can a finalized dataset change?",
    "No. Finalizing locks the dataset. Each evaluation also records the exact graph, prompt, model, and snapshots it used, so a result can always be traced back.",
  ],
  [
    "Is AutoEval hosted?",
    "No. The current app runs locally for one user and has no authentication. Keep both services on loopback and do not expose them to a network.",
  ],
];

const footerColumns = [
  {
    heading: "Product",
    links: [
      ["Workflow", "#workflow"],
      ["Trace inspection", "#trace"],
      ["Bring your agent", "#modular"],
      ["Model comparison", "#compare"],
      ["Provenance", "#provenance"],
    ],
  },
  {
    heading: "Resources",
    links: [
      ["GitHub", GITHUB_URL],
      ["Architecture", `${GITHUB_URL}/blob/main/docs/architecture.md`],
      ["Extension guide", `${GITHUB_URL}/blob/main/docs/extension-guide.md`],
      ["Security notes", `${GITHUB_URL}/blob/main/docs/code-security-review.md`],
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
                AutoEval runs your agent, records every node and model call,
                and turns the reviewed runs into a locked dataset you can test
                every model against.
              </p>
            </LandingReveal>
            <LandingReveal mode="load" delay={0.16} className={styles.actions}>
              <Link
                href="/systems"
                className={styles.primaryAction}
                data-sound="navigate"
              >
                open autoeval <kbd aria-hidden="true">O</kbd>
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
              A reviewed trace becomes a dataset item. AutoEval keeps the graph,
              prompt, model, and runtime data attached, so the case can be rerun
              exactly as it happened and compared across every candidate.
            </p>
            <Link href="/systems" className={styles.textLink}>
              <span aria-hidden="true">›</span> open an included system
            </Link>
          </LandingReveal>
        </section>

        <ol className={styles.steps} aria-label="AutoEval workflow">
          {steps.map((step, index) => (
            <li key={step.index} className={styles.step}>
              <LandingReveal delay={index * 0.06} className={styles.stepInner}>
                <span className={styles.eyebrow}>Step {step.index}</span>
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
              token counts, cost, and timing. Failures show up with the exact
              context that produced them, not a summary of it.
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
              Your package owns the graph and the domain logic. AutoEval runs
              it, records the trace, and makes each result reproducible without
              asking you to adopt a framework.
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
                className={styles.card}
              >
                <div className={styles.cardCopy}>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </div>
                <div className={styles.cardVisual}>{card.visual}</div>
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
            <span className={styles.eyebrow}>Model comparison</span>
            <h2 id="compare-title">
              Compare every model
              <br />
              <Highlight tone="blue">against the same truth.</Highlight>
            </h2>
            <p>
              Point a finalized dataset at each candidate and let the same
              cases run. Open any result behind the total score to see where a
              model passed, failed, slowed down, or cost more.
            </p>
            <Link href="/systems" className={styles.textLink}>
              <span aria-hidden="true">›</span> start a comparison
            </Link>
          </LandingReveal>
        </section>

        <div className={`${styles.band} ${styles.bandMeadow}`}>
          <span className={styles.ticks} aria-hidden="true" />
          <div className={styles.bandInner}>
            <LandingReveal className={styles.previewPlacement} delay={0.08}>
              <ProductPreview
                initialStage="evaluate"
                label="Interactive model comparison preview"
                tablistLabel="Model comparison workflow steps"
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
              snapshots before work starts. Versions are immutable, so a score
              from last month still means what it meant then.
            </p>
          </LandingReveal>
          <div className={`${styles.cardGrid} ${styles.cardGridFour}`}>
            {provenanceCards.map((card, index) => (
              <LandingReveal
                key={card.title}
                delay={index * 0.06}
                className={`${styles.card} ${styles.cardCompact}`}
              >
                <div className={styles.cardCopy}>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </div>
                <div className={styles.cardVisual}>{card.visual}</div>
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
            <h2 id="faq-title">Questions, answered.</h2>
            <p>
              Everything else lives in the repository docs, next to the code it
              describes.
            </p>
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
              Run it. Trace it.
              <br />
              Turn it into a test.
            </h2>
            <div className={styles.finalActions}>
              <Link
                href="/systems"
                className={styles.finalPrimary}
                data-sound="navigate"
              >
                open autoeval <kbd aria-hidden="true">O</kbd>
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
