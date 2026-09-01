import Link from "next/link";

import { DottedText } from "@/components/dotted-text";
import { ProductPreview } from "@/features/landing/product-preview";
import styles from "@/features/landing/landing.module.css";

const workflow = [
  { number: "01", verb: "Connect", title: "Add your agent", description: "Register its graph, handlers, scoring code, and provider adapters." },
  { number: "02", verb: "Trace", title: "Inspect the run", description: "See each node, its input and output, timing, token use, cost, and model details." },
  { number: "03", verb: "Save", title: "Build a test set", description: "Add reviewed traces to a draft dataset. Finalize it when the cases are ready." },
  { number: "04", verb: "Compare", title: "Test the models", description: "Run every model against the same cases. Compare quality, cost, and latency." },
];

const facts = [
  ["Graph and prompt", "Content hashes"],
  ["Dataset", "Locked before each eval"],
  ["Runtime data", "Pinned snapshots"],
  ["Provider keys", "Backend environment only"],
];

const faqs = [
  ["Do I need a specific agent framework?", "No. You add an integration in code. It includes a plugin manifest, graph definition, handlers, and any scoring or trace rules you need."],
  ["Can I compare models and providers?", "Yes. Provider adapters use one interface. An eval runs the same finalized dataset against each model you select."],
  ["Can a finished dataset change?", "No. Finalizing a dataset locks it. Each eval also records the graph, prompt, model, and snapshot IDs it used."],
  ["Is AutoEval hosted?", "No. The current app runs locally for one user and has no authentication. Keep it on loopback."],
];

export function LandingScreen() {
  return (
    <div className={styles.landing}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroBackdrop} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <h1 id="landing-title" className={styles.title}>Evals for<br /><em>agent systems.</em></h1>
          <p className={styles.heroStatement}>Trace your agent. <DottedText color="var(--landing-highlight)">Test every change.</DottedText></p>
          <p className={styles.lede}>Connect your agent code to AutoEval. Inspect each run, save useful traces as versioned test cases, and compare models on the same dataset.</p>
          <div className={styles.actions}>
            <Link href="/systems" className={styles.primaryAction} data-sound="navigate">Open AutoEval <span aria-hidden="true">↗</span></Link>
            <a href="#workflow" className={styles.secondaryAction}>See the workflow <span aria-hidden="true">↓</span></a>
          </div>
          <p className={styles.heroNote}>Runs locally. The included examples need no provider key.</p>
        </div>
        <div className={styles.previewColumn}>
          <p className={styles.previewPrompt}>Choose a step and see what AutoEval records.</p>
          <ProductPreview />
        </div>
      </section>

      <section className={styles.signalBar} aria-label="Platform capabilities">
        <strong>ONE RUN BECOMES A REPEATABLE TEST</strong>
        <ul><li>YOUR AGENT</li><li>TRACES</li><li>DATASETS</li><li>MODELS</li><li>RESULTS</li></ul>
      </section>

      <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.sectionIntro}>
          <h2 id="workflow-title">Run an agent. Save the trace. Test it again.</h2>
          <p>A reviewed trace becomes a dataset item. AutoEval keeps the graph, prompt, model, and runtime data attached.</p>
        </div>
        <ol className={styles.workflowList}>
          {workflow.map((step) => <li key={step.number}><span className={styles.stepNumber}>{step.number}</span><div><small>{step.verb}</small><h3>{step.title}</h3></div><p>{step.description}</p></li>)}
        </ol>
      </section>

      <section id="modular" className={styles.modular} aria-labelledby="modular-title">
        <div className={styles.modularDiagram} aria-label="Agent systems connect to AutoEval through code adapters">
          <div className={styles.diagramSources}><span>YOUR SYSTEM A</span><span>YOUR SYSTEM B</span><span>YOUR SYSTEM N</span></div>
          <div className={styles.diagramConnector} aria-hidden="true"><i /><b>CODE ADAPTER</b><i /></div>
          <div className={styles.diagramCore}><small>AUTOEVAL</small><strong>trace → dataset → evaluation</strong><p>One saved record of what ran</p></div>
          <div className={styles.diagramOutputs}><span>MODEL A</span><span>MODEL B</span><span>PROVIDER N</span></div>
        </div>
        <div className={styles.modularCopy}>
          <h2 id="modular-title">Use the agent you already have.</h2>
          <p>Your package owns the graph, handlers, and scoring code. AutoEval runs them, records traces, versions datasets, and compares models.</p>
          <Link href="/systems" className={styles.inlineLink}>Open an included example <span>→</span></Link>
        </div>
      </section>

      <section id="evidence" className={styles.evidence} aria-labelledby="evidence-title">
        <div className={styles.evidenceCopy}>
          <h2 id="evidence-title">Every result points back to the exact inputs.</h2>
          <p>Before an eval starts, AutoEval pins the graph, prompt, model, dataset, and runtime snapshots. A finalized dataset cannot change.</p>
        </div>
        <div className={styles.manifestCard}>
          <header><span>RUN MANIFEST</span><b>IMMUTABLE</b></header>
          <dl>{facts.map(([term, value], index) => <div key={term}><dt><span>0{index + 1}</span>{term}</dt><dd>{value}<i>✓</i></dd></div>)}</dl>
          <footer><span>sha256</span><code>c94b…8fa1</code><strong>resolved</strong></footer>
        </div>
      </section>

      <section id="compare" className={styles.compare} aria-labelledby="compare-title">
        <div className={styles.compareHeading}><h2 id="compare-title">Compare quality, cost, and latency.</h2><p>Open any case behind the total score. See where each model passed, failed, slowed down, or cost more.</p></div>
        <div className={styles.resultsTable} role="img" aria-label="Example model comparison showing quality, cost, and latency">
          <div className={styles.tableHeader}><span>MODEL</span><span>QUALITY</span><span>COST / RUN</span><span>P95 LATENCY</span></div>
          <div><strong>model / candidate-a</strong><span><i style={{ width: "91%" }} />91%</span><span>$0.014</span><span>1.2s</span></div>
          <div><strong>model / candidate-b</strong><span><i style={{ width: "86%" }} />86%</span><span>$0.006</span><span>0.8s</span></div>
          <div><strong>model / baseline</strong><span><i style={{ width: "79%" }} />79%</span><span>$0.009</span><span>1.6s</span></div>
          <p>Example data. Your evals use your models, metrics, and finalized datasets.</p>
        </div>
      </section>

      <section id="faq" className={styles.faq} aria-labelledby="faq-title">
        <div><h2 id="faq-title">Questions,<br />answered.</h2></div>
        <div className={styles.faqList}>{faqs.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className={styles.finalCta} aria-labelledby="landing-cta-title">
        <h2 id="landing-cta-title">Run it. Trace it.<br />Turn it into a test.</h2>
        <Link href="/systems" className={styles.primaryAction} data-sound="navigate">Open AutoEval <span aria-hidden="true">→</span></Link>
        <p>Local app. One user. No authentication.</p>
      </section>
    </div>
  );
}
