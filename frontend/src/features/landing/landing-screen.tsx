import Link from "next/link";

import { DottedText } from "@/components/dotted-text";
import { ProductPreview } from "@/features/landing/product-preview";

const capabilities = [
  { index: "01", title: "Bring your own system", description: "Connect any agent runtime through modular graph, handler, and provider interfaces—without rebuilding your stack around ours." },
  { index: "02", title: "See the whole run", description: "Follow every node, model call, input, output, token, cost, and latency from one inspectable trace." },
  { index: "03", title: "Turn evidence into evals", description: "Curate real traces into immutable datasets, then compare models and providers against the exact same cases." },
];

export function LandingScreen() {
  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-backdrop" aria-hidden="true" />
        <div className="landing-copy">
          <p className="landing-eyebrow"><span /> The modular evaluation workspace</p>
          <h1 id="landing-title" className="landing-title">
            Build better agents with{" "}<em><DottedText color="var(--landing-highlight)">evidence.</DottedText></em>
          </h1>
          <p className="landing-description">Plug in any agent system. Inspect every trace. Curate durable test sets. Run reproducible evaluations across the models and providers you choose.</p>
          <div className="landing-actions">
            <Link href="/systems" className="landing-primary-action" data-sound="navigate">Open the workbench <span aria-hidden="true">↗</span></Link>
            <a href="#platform" className="landing-text-link">Explore the platform <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="landing-preview-wrap"><ProductPreview /></div>
      </section>

      <section className="landing-proof" aria-label="Platform summary">
        <p>ONE WORKSPACE / EVERY EVALUATION LAYER</p>
        <div className="landing-proof-list" aria-hidden="true"><span>AGENT RUNTIMES</span><span>TRACES</span><span>DATASETS</span><span>MODELS</span><span>PROVIDERS</span></div>
      </section>

      <section id="platform" className="landing-platform" aria-labelledby="platform-title">
        <div className="landing-platform-heading">
          <p className="landing-section-label">THE EVALUATION LOOP</p>
          <h2 id="platform-title">Your system stays yours.<br />The learning compounds.</h2>
          <p>AutoEval separates your domain logic from the evaluation infrastructure around it, so every team can adopt the same rigorous loop without adopting the same agent architecture.</p>
        </div>
        <ol className="landing-capabilities">
          {capabilities.map((capability) => (
            <li key={capability.index}><span className="landing-capability-index">{capability.index}</span><h3>{capability.title}</h3><p>{capability.description}</p></li>
          ))}
        </ol>
      </section>

      <section className="landing-cta" aria-labelledby="landing-cta-title">
        <p className="landing-section-label">START WITH WHAT YOU HAVE</p>
        <h2 id="landing-cta-title">Connect a run. Keep the evidence.</h2>
        <Link href="/systems" className="landing-primary-action" data-sound="navigate">Enter AutoEval <span aria-hidden="true">→</span></Link>
      </section>
    </div>
  );
}
