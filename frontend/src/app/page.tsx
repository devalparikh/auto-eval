import Link from "next/link";
import Image from "next/image";

import { DottedText } from "@/components/dotted-text";

const workflow = [
  {
    title: "Capture the run",
    description:
      "Open the trace to see which node failed, what it received, and what it returned.",
  },
  {
    title: "Save the evidence",
    description:
      "Turn a useful run into a versioned dataset with the exact inputs still attached.",
  },
  {
    title: "Compare the change",
    description:
      "Run the same dataset against a new graph or model. Compare quality, cost, and latency.",
  },
];

export default function HomePage() {
  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <h1 id="landing-title" className="landing-title">
            See where your agent{" "}
            <em>
              <DottedText color="var(--accent)">breaks.</DottedText>
            </em>
          </h1>
          <p className="landing-description">
            AutoEval records every node, prompt, model call, token, cost, and
            output, then pins the exact versions behind every evaluation.
          </p>
          <div className="landing-actions">
            <Link href="/systems" className="app-button" data-sound="navigate">
              Browse systems
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/systems/incident-triage/run"
              className="landing-text-link"
              data-sound="navigate"
            >
              Try the sample run <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <LandingArtwork />
      </section>

      <section className="landing-loop" aria-labelledby="loop-title">
        <div className="landing-loop-copy">
          <h2 id="loop-title">From one failed run to a measured fix.</h2>
          <p>The sample incident-triage system works without an API key.</p>
        </div>
        <ol className="workflow-stack">
          {workflow.map((step) => (
            <li key={step.title} className="workflow-step">
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>
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
    </figure>
  );
}
