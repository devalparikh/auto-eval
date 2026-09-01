import Link from "next/link";

import { DottedText } from "@/components/dotted-text";
import { ProductPreview } from "@/features/landing/product-preview";
import styles from "@/features/landing/landing.module.css";

const workflow = [
  { number: "01", verb: "Adapt", title: "Meet your system where it runs", description: "Register your graph, deterministic handlers, scoring logic, and provider adapters through explicit extension points." },
  { number: "02", verb: "Observe", title: "Turn a run into evidence", description: "Inspect the path through each node with normalized inputs, outputs, latency, token, cost, and model metadata when available." },
  { number: "03", verb: "Curate", title: "Keep the cases that matter", description: "Promote reviewed traces into draft datasets, refine them, then finalize an immutable version for repeatable evaluation." },
  { number: "04", verb: "Evaluate", title: "Compare on equal ground", description: "Replay the same finalized cases across selected models and review quality, cost, and latency together." },
];

const facts = [
  ["Graph + prompt", "Content-hashed versions"],
  ["Dataset", "Finalized before evaluation"],
  ["Runtime inputs", "Pinned snapshots"],
  ["Provider keys", "Backend environment only"],
];

const faqs = [
  ["Do I need a specific agent framework?", "No single architecture is imposed. Today, integrations are code-level: a system contributes a plugin manifest, graph definition, handlers, and optional scoring and trace policies."],
  ["Can I compare different models and providers?", "Yes. Provider adapters share one inference contract, and an evaluation can run a finalized dataset against selected model configurations."],
  ["How do datasets stay reproducible?", "Dataset versions become immutable when finalized. Evaluations also resolve exact graph, prompt, model, and snapshot provenance before execution."],
  ["Is AutoEval a hosted SaaS?", "Not yet. The current product is a local, single-user workbench with no authentication. It should remain on loopback while the platform matures."],
];

export function LandingScreen() {
  return (
    <div className={styles.landing}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroBackdrop} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> Modular evaluation infrastructure</p>
          <h1 id="landing-title" className={styles.title}>Know what changed.<br /><em>Prove what <DottedText color="var(--landing-highlight)">works.</DottedText></em></h1>
          <p className={styles.lede}>A local-first workbench for teams building agentic systems. Adapt your runtime, inspect execution traces, curate versioned datasets, and compare models on the exact same evidence.</p>
          <div className={styles.actions}>
            <Link href="/systems" className={styles.primaryAction} data-sound="navigate">Open the workbench <span aria-hidden="true">↗</span></Link>
            <a href="#workflow" className={styles.secondaryAction}>See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <p className={styles.heroNote}>Runs locally · Included examples require no provider key</p>
        </div>
        <div className={styles.previewColumn}>
          <p className={styles.previewPrompt}><span>LIVE PRODUCT WALKTHROUGH</span> Select a stage to follow one run into an evaluation.</p>
          <ProductPreview />
        </div>
      </section>

      <section className={styles.signalBar} aria-label="Platform capabilities">
        <strong>ONE EVIDENCE CHAIN</strong>
        <ul><li>YOUR RUNTIME</li><li>TRACES</li><li>DATASETS</li><li>MODELS</li><li>RESULTS</li></ul>
      </section>

      <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.sectionIntro}>
          <p className={styles.sectionLabel}>HOW IT WORKS / 01—04</p>
          <h2 id="workflow-title">One continuous path from runtime behavior to release confidence.</h2>
          <p>No screenshots stitched across separate tools. The trace you review becomes the case you evaluate, with provenance preserved through every stage.</p>
        </div>
        <ol className={styles.workflowList}>
          {workflow.map((step) => <li key={step.number}><span className={styles.stepNumber}>{step.number}</span><div><small>{step.verb}</small><h3>{step.title}</h3></div><p>{step.description}</p></li>)}
        </ol>
      </section>

      <section id="modular" className={styles.modular} aria-labelledby="modular-title">
        <div className={styles.modularDiagram} aria-label="Agent systems connect through adapters to shared evaluation infrastructure">
          <div className={styles.diagramSources}><span>YOUR SYSTEM A</span><span>YOUR SYSTEM B</span><span>YOUR SYSTEM N</span></div>
          <div className={styles.diagramConnector} aria-hidden="true"><i /><b>ADAPTER CONTRACT</b><i /></div>
          <div className={styles.diagramCore}><small>AUTOEVAL</small><strong>trace → dataset → evaluation</strong><p>One reproducible evidence layer</p></div>
          <div className={styles.diagramOutputs}><span>MODEL A</span><span>MODEL B</span><span>PROVIDER N</span></div>
        </div>
        <div className={styles.modularCopy}>
          <p className={styles.sectionLabel}>DESIGNED AROUND YOUR ARCHITECTURE</p>
          <h2 id="modular-title">Modular by contract, not by claim.</h2>
          <p>AutoEval keeps reusable evaluation infrastructure separate from domain logic. Add a system through scoped registries for graphs and handlers; add a provider behind one inference interface; add scoring beside the system that owns it.</p>
          <Link href="/systems" className={styles.inlineLink}>Explore the included systems <span>→</span></Link>
        </div>
      </section>

      <section id="evidence" className={styles.evidence} aria-labelledby="evidence-title">
        <div className={styles.evidenceCopy}>
          <p className={styles.sectionLabel}>REPRODUCIBILITY IS THE PRODUCT</p>
          <h2 id="evidence-title">A result is only useful when you can explain where it came from.</h2>
          <p>Every evaluation resolves the versions and resources it depends on before it runs. Finalized datasets cannot drift underneath a comparison.</p>
        </div>
        <div className={styles.manifestCard}>
          <header><span>RUN MANIFEST</span><b>IMMUTABLE</b></header>
          <dl>{facts.map(([term, value], index) => <div key={term}><dt><span>0{index + 1}</span>{term}</dt><dd>{value}<i>✓</i></dd></div>)}</dl>
          <footer><span>sha256</span><code>c94b…8fa1</code><strong>resolved</strong></footer>
        </div>
      </section>

      <section id="compare" className={styles.compare} aria-labelledby="compare-title">
        <div className={styles.compareHeading}><p className={styles.sectionLabel}>MAKE THE TRADEOFF VISIBLE</p><h2 id="compare-title">Quality alone is not the whole result.</h2><p>Compare the dimensions that shape a production decision without losing the case-level evidence behind the aggregate.</p></div>
        <div className={styles.resultsTable} role="img" aria-label="Example model comparison showing quality, cost, and latency">
          <div className={styles.tableHeader}><span>MODEL</span><span>QUALITY</span><span>COST / RUN</span><span>P95 LATENCY</span></div>
          <div><strong>model / candidate-a</strong><span><i style={{ width: "91%" }} />91%</span><span>$0.014</span><span>1.2s</span></div>
          <div><strong>model / candidate-b</strong><span><i style={{ width: "86%" }} />86%</span><span>$0.006</span><span>0.8s</span></div>
          <div><strong>model / baseline</strong><span><i style={{ width: "79%" }} />79%</span><span>$0.009</span><span>1.6s</span></div>
          <p>Illustrative interface — use your own models, metrics, and finalized datasets.</p>
        </div>
      </section>

      <section id="faq" className={styles.faq} aria-labelledby="faq-title">
        <div><p className={styles.sectionLabel}>BEFORE YOU PLUG IN</p><h2 id="faq-title">The practical questions.</h2></div>
        <div className={styles.faqList}>{faqs.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className={styles.finalCta} aria-labelledby="landing-cta-title">
        <p className={styles.sectionLabel}>START WITH THE INCLUDED EXAMPLES</p>
        <h2 id="landing-cta-title">Follow one run.<br />Keep what you learn.</h2>
        <Link href="/systems" className={styles.primaryAction} data-sound="navigate">Open the workbench <span aria-hidden="true">→</span></Link>
        <p>Local-first · Single-user · No authentication</p>
      </section>
    </div>
  );
}
