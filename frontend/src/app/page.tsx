import Link from "next/link";

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
          <p className="landing-kicker">Local agent workbench</p>
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
        <TraceField />
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
        <span>Local single-user workspace</span>
        <span>Trace → dataset → evaluation → result</span>
      </footer>
    </div>
  );
}

function TraceField() {
  return (
    <figure
      className="trace-field"
      aria-label="The seeded incident-triage graph: normalize input, classify incident, apply policy, and draft response"
    >
      <figcaption className="trace-field-header">
        <span>Incident-triage trace · v1</span>
        <span className="trace-field-live">ready</span>
      </figcaption>
      <svg
        className="trace-field-lines"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          className="trace-line-base"
          d="M240 240 C390 240 470 420 650 420"
        />
        <path
          className="trace-line-flow"
          d="M240 240 C390 240 470 420 650 420"
        />
        <path
          className="trace-line-base"
          d="M650 420 C650 545 435 535 330 650"
        />
        <path
          className="trace-line-flow"
          d="M650 420 C650 545 435 535 330 650"
        />
        <path
          className="trace-line-base"
          d="M330 650 C490 650 555 790 730 790"
        />
        <path
          className="trace-line-flow"
          d="M330 650 C490 650 555 790 730 790"
        />
      </svg>
      <HeroNode
        className="hero-node-1"
        name="normalize_input"
        kind="deterministic"
        detail="shape request"
      />
      <HeroNode
        className="hero-node-2"
        name="classify_incident"
        kind="llm"
        detail="severity + route"
      />
      <HeroNode
        className="hero-node-3"
        name="apply_policy"
        kind="deterministic"
        detail="review policy"
      />
      <HeroNode
        className="hero-node-4"
        name="draft_response"
        kind="llm"
        detail="operator draft"
      />
      <div className="trace-field-footer" aria-hidden="true">
        <span>:: :: ·· :: · ::: ·· ::</span>
        <span>4 nodes · directed</span>
      </div>
    </figure>
  );
}

function HeroNode({
  className,
  name,
  kind,
  detail,
}: {
  className: string;
  name: string;
  kind: string;
  detail: string;
}) {
  return (
    <div className={`hero-node ${className}`} aria-hidden="true">
      <div className="hero-node-top">
        <span className="hero-node-name">{name}</span>
        <span className="hero-node-kind">{kind}</span>
      </div>
      <div className="hero-node-body">
        <span>{detail}</span>
        <span className="hero-node-state">ok</span>
      </div>
    </div>
  );
}
