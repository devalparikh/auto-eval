import Link from "next/link";

import { DottedText } from "@/components/dotted-text";
import { LandingReveal } from "@/features/landing/landing-reveal";
import { ProductPreview } from "@/features/landing/product-preview";
import styles from "@/features/landing/landing.module.css";

const workflow = [
  {
    title: "connect your agent",
    description:
      "Register the graph, handlers, scoring code, and provider adapters that already live with your system.",
  },
  {
    title: "inspect the run",
    description:
      "Open every node, model call, input, output, token count, cost, and timing in one trace.",
  },
  {
    title: "save the useful cases",
    description:
      "Turn reviewed traces into a draft dataset, then finalize it when the cases are ready to compare.",
  },
  {
    title: "test every model",
    description:
      "Run the same locked cases against each candidate and compare quality, cost, and latency.",
  },
];

const integrationRows = [
  ["plugin manifest", "names the system and its defaults"],
  ["graph definition", "records the workflow that will run"],
  ["handlers and scoring", "keep domain logic beside the agent"],
  ["trace policy", "controls what leaves and what persists"],
];

const provenanceRows = [
  ["graph and prompt", "content hashes"],
  ["dataset", "locked before evaluation"],
  ["runtime data", "pinned snapshots"],
  ["provider keys", "backend environment only"],
];

const faqs = [
  [
    "do I need a specific agent framework?",
    "No. Add a code integration with your graph, handlers, scoring, and any trace rules your system needs.",
  ],
  [
    "can I compare models and providers?",
    "Yes. AutoEval runs the same finalized dataset against every model you select through one provider interface.",
  ],
  [
    "can a finalized dataset change?",
    "No. Finalizing locks the dataset. Each evaluation also records the exact graph, prompt, model, and snapshots it used.",
  ],
  [
    "is AutoEval hosted?",
    "No. The current app runs locally for one user and has no authentication. Keep both services on loopback.",
  ],
];

export function LandingScreen() {
  return (
    <div className={styles.landing}>
      <div className={styles.frame}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <LandingReveal mode="load" className={styles.heroTitle}>
            <h1 id="landing-title">
              Trace your agent.{" "}
              <DottedText color="var(--landing-accent)">
                Test every change.
              </DottedText>
            </h1>
          </LandingReveal>
          <div className={styles.heroBottom}>
            <LandingReveal mode="load" delay={0.08}>
              <p>
                Inspect each run, save the cases that matter, and compare models
                against the same locked dataset.
              </p>
            </LandingReveal>
            <LandingReveal mode="load" delay={0.16} className={styles.actions}>
              <Link
                href="/systems"
                className={styles.primaryAction}
                data-sound="navigate"
              >
                open autoeval <span aria-hidden="true">↗</span>
              </Link>
              <a href="#workflow" className={styles.secondaryAction}>
                see the workflow <span aria-hidden="true">→</span>
              </a>
            </LandingReveal>
          </div>
        </section>

        <LandingReveal className={`${styles.visualBand} ${styles.lakeBand}`}>
          <div className={styles.scenery} aria-hidden="true" />
          <div className={styles.previewPlacement}>
            <ProductPreview variant="desktop" />
          </div>
        </LandingReveal>

        <section
          id="workflow"
          className={styles.copyBand}
          aria-labelledby="workflow-title"
        >
          <LandingReveal className={styles.copyMeasure}>
            <h2 id="workflow-title">One run becomes a repeatable test.</h2>
            <p>
              A reviewed trace becomes a dataset item. AutoEval keeps its graph,
              prompt, model, and runtime data attached.
            </p>
          </LandingReveal>
        </section>

        <ol className={styles.workflowList} aria-label="AutoEval workflow">
          {workflow.map((step, index) => (
            <li key={step.title} className={styles.interactionRow}>
              <LandingReveal
                delay={index * 0.04}
                className={styles.workflowRowInner}
              >
                <span className={styles.rowVerb}>{step.title}</span>
                <p>{step.description}</p>
                <span className={styles.rowArrow} aria-hidden="true">
                  ↗
                </span>
              </LandingReveal>
            </li>
          ))}
        </ol>

        <section
          id="modular"
          className={styles.splitBand}
          aria-labelledby="modular-title"
        >
          <LandingReveal className={styles.splitCopy}>
            <h2 id="modular-title">Use the agent you already have.</h2>
            <p>
              Your package owns the graph and domain logic. AutoEval runs it,
              records the trace, and makes each result reproducible.
            </p>
            <Link href="/systems" className={styles.inlineLink}>
              open an included system <span aria-hidden="true">→</span>
            </Link>
          </LandingReveal>
          <LandingReveal delay={0.08} className={styles.definitionList}>
            {integrationRows.map(([term, detail]) => (
              <div key={term} className={styles.definitionRow}>
                <strong>{term}</strong>
                <span>{detail}</span>
              </div>
            ))}
          </LandingReveal>
        </section>

        <section
          id="compare"
          className={styles.copyBand}
          aria-labelledby="compare-title"
        >
          <LandingReveal className={styles.copyMeasure}>
            <h2 id="compare-title">
              Compare every model against the same truth.
            </h2>
            <p>
              Open any result behind the total score. See where a model passed,
              failed, slowed down, or cost more.
            </p>
          </LandingReveal>
        </section>

        <LandingReveal className={`${styles.visualBand} ${styles.meadowBand}`}>
          <div className={styles.scenery} aria-hidden="true" />
          <div className={styles.previewPlacement}>
            <ProductPreview
              initialStage="evaluate"
              label="Interactive model comparison preview"
              tablistLabel="Model comparison workflow steps"
              idPrefix="model-comparison"
            />
          </div>
        </LandingReveal>

        <section
          id="provenance"
          className={styles.provenanceBand}
          aria-labelledby="provenance-title"
        >
          <LandingReveal className={styles.splitCopy}>
            <h2 id="provenance-title">Every result points back to what ran.</h2>
            <p>
              Evaluations pin the graph, prompt, model, dataset, and runtime
              snapshots before work starts.
            </p>
          </LandingReveal>
          <LandingReveal delay={0.08} className={styles.manifest}>
            <dl>
              {provenanceRows.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>
                    {value}
                    <span aria-hidden="true">✓</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p>
              <code>sha256 c94b...8fa1</code>
              <strong>resolved</strong>
            </p>
          </LandingReveal>
        </section>

        <section
          id="faq"
          className={styles.faqBand}
          aria-labelledby="faq-title"
        >
          <LandingReveal className={styles.faqTitle}>
            <h2 id="faq-title">Questions, answered.</h2>
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

        <section
          className={styles.finalCta}
          aria-labelledby="landing-cta-title"
        >
          <div className={styles.finalScenery} aria-hidden="true" />
          <LandingReveal className={styles.finalContent}>
            <h2 id="landing-cta-title">
              Run it. Trace it. Turn it into a test.
            </h2>
            <Link
              href="/systems"
              className={styles.finalAction}
              data-sound="navigate"
            >
              open autoeval <span aria-hidden="true">↗</span>
            </Link>
          </LandingReveal>
        </section>
      </div>
    </div>
  );
}
