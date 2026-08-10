import Link from "next/link";
import Image from "next/image";

const workflow = [
  {
    title: "Trace",
    description: "Record every node, input, output, token, and failure.",
  },
  {
    title: "Review",
    description: "Inspect the graph and turn useful runs into examples.",
  },
  {
    title: "Freeze",
    description: "Finalize an immutable ground-truth dataset version.",
  },
  {
    title: "Evaluate",
    description: "Run the same versions and examples across models.",
  },
  {
    title: "Compare",
    description: "Read quality, cost, and latency from one result set.",
  },
];

export default function HomePage() {
  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="landing-kicker">Local agent workbench / 001</p>
          <h1 id="landing-title" className="landing-title">
            See where your agent <em>breaks.</em>
          </h1>
          <p className="landing-description">
            AutoEval records every node, prompt, model call, token, cost, and
            output, then pins the exact versions behind every evaluation.
          </p>
          <div className="landing-actions">
            <Link href="/traces" className="app-button" data-sound="navigate">
              Inspect traces
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/evaluations"
              className="landing-text-link"
              data-sound="navigate"
            >
              Run an evaluation <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ul className="landing-facts" aria-label="Workspace facts">
            <li>loopback only</li>
            <li>mock models included</li>
            <li>immutable versions</li>
          </ul>
        </div>
        <LandingArtwork />
      </section>

      <section className="landing-loop" aria-labelledby="loop-title">
        <div className="landing-loop-copy">
          <p className="landing-kicker">The operating loop</p>
          <h2 id="loop-title">Evidence in. Better agents out.</h2>
          <p>
            The seeded incident-triage system is already wired through the full
            workflow. No API key is required.
          </p>
        </div>
        <ol className="workflow-rail">
          {workflow.map((step, index) => (
            <li key={step.title} className="workflow-step">
              <span className="workflow-index">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="landing-close">
        <span>AutoEval / local single-user workspace</span>
        <span>Trace → dataset → evaluation → result</span>
      </footer>
    </div>
  );
}

function LandingArtwork() {
  return (
    <figure className="landing-art">
      <Image
        className="landing-art-image"
        src="/images/autoeval-landscape-hero-v2.jpg"
        alt="Airy dithered landscape of a pale mountain basin and stepping stones crossing a clear stream."
        fill
        preload
        sizes="(max-width: 780px) 100vw, 56vw"
      />
      <figcaption className="landing-art-caption">
        <span>System inspection / 001</span>
        <span>failure isolated</span>
      </figcaption>
      <div className="landing-art-meta" aria-hidden="true">
        <span>:: :: ·· :: · ::: ·· ::</span>
        <span>precision / trace / repair</span>
      </div>
    </figure>
  );
}
