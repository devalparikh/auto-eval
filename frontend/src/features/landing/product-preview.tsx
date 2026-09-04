"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Badge, BadgeSwap } from "@/features/landing/feature-cards";
import { useCycle, useSceneActive } from "@/features/landing/landing-motion";
import styles from "@/features/landing/landing.module.css";

const stages = [
  {
    key: "connect",
    index: "01",
    label: "Connect",
    crumb: "systems / research-assistant",
    title: "Agent setup",
    value: "research-assistant / v7",
    description:
      "Register the graph and handlers. Your agent code stays in its own package.",
    meta: "graph and handlers",
    prompt: "Register the research assistant and check its contract.",
  },
  {
    key: "observe",
    index: "02",
    label: "Trace",
    crumb: "traces / tr_01J8F2KQ",
    title: "Trace",
    value: "tr_01J8F2KQ",
    description:
      "Open one run. Check the node path, timing, model call, and output.",
    meta: "current trace",
    prompt: "Review this trace, keep the useful failures, then compare.",
  },
  {
    key: "curate",
    index: "03",
    label: "Save",
    crumb: "datasets / failure-modes",
    title: "Dataset",
    value: "failure-modes / v4",
    description:
      "Add the reviewed trace to a draft dataset. Finalize it when it is ready.",
    meta: "128 reviewed cases",
    prompt: "Add the grounding failure to failure-modes and finalize v4.",
  },
  {
    key: "evaluate",
    index: "04",
    label: "Compare",
    crumb: "evaluations / 024",
    title: "Evaluation",
    value: "comparison / 024",
    description: "Run the same locked cases against each model.",
    meta: "six candidates",
    prompt: "Run failure-modes v4 against every candidate, including ft-v3.",
  },
] as const;

type Stage = (typeof stages)[number]["key"];

const AUTO_ADVANCE_MS = 7200;

export function ProductPreview({
  initialStage = "observe",
  label = "Interactive AutoEval workflow",
  tablistLabel = "AutoEval workflow steps",
  idPrefix = "autoeval-workflow",
  variant = "embedded",
}: {
  initialStage?: Stage;
  label?: string;
  tablistLabel?: string;
  idPrefix?: string;
  variant?: "desktop" | "embedded";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { active: inView, reduceMotion } = useSceneActive(rootRef);
  const [activeStage, setActiveStage] = useState<Stage>(initialStage);
  const [hovered, setHovered] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const active = stages.find((stage) => stage.key === activeStage) ?? stages[1];
  const activeIndex = stages.findIndex((stage) => stage.key === activeStage);
  const nextStage = stages[(activeIndex + 1) % stages.length];
  const autoplay = inView && !hovered && !interacted && !reduceMotion;

  useEffect(() => {
    if (!autoplay) return;
    const timer = setTimeout(
      () => setActiveStage(nextStage.key),
      AUTO_ADVANCE_MS,
    );
    return () => clearTimeout(timer);
  }, [autoplay, activeStage, nextStage.key]);

  function select(stage: Stage) {
    setInteracted(true);
    setActiveStage(stage);
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.productPreview} ${variant === "desktop" ? styles.desktopPreview : ""}`}
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setInteracted(false);
      }}
    >
      <div className={styles.previewWindow}>
        <div className={styles.previewChrome}>
          <div className={styles.previewDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span className={styles.previewCrumbs}>
            <b>research-assistant</b>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={active.key}
                initial={reduceMotion ? false : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {active.crumb}
              </motion.span>
            </AnimatePresence>
          </span>
          <div className={styles.previewChromeTools}>
            <span className={styles.previewSearch}>
              search <kbd>⌘K</kbd>
            </span>
            <span className={styles.previewLive}>
              <i /> local
            </span>
          </div>
        </div>
        <div className={styles.previewBody}>
          <div className={styles.previewRail}>
            <div className={styles.railWorkspace} aria-hidden="true">
              <span className={styles.railMark}>ra</span>
              <span className={styles.railName}>
                <b>research-assistant</b>
                <small>local workspace</small>
              </span>
              <i className={styles.railChevron} />
            </div>
            <div className={styles.railSection} aria-hidden="true">
              <span>Evaluation loop</span>
              <span>{activeIndex + 1} / 4</span>
            </div>
            <div
              className={styles.previewTabs}
              role="tablist"
              aria-label={tablistLabel}
              aria-orientation="vertical"
            >
              {stages.map((stage, index) => (
                <button
                  key={stage.key}
                  id={`${idPrefix}-tab-${stage.key}`}
                  type="button"
                  role="tab"
                  aria-selected={activeStage === stage.key}
                  aria-controls={`${idPrefix}-panel-${stage.key}`}
                  className={
                    activeStage === stage.key ? styles.activeTab : undefined
                  }
                  data-done={index < activeIndex ? "true" : "false"}
                  onClick={() => select(stage.key)}
                >
                  <span className={styles.stageIndex}>{stage.index}</span>
                  <span className={styles.stageCopy}>
                    <b>{stage.label}</b>
                    <small>{stage.meta}</small>
                  </span>
                  <span className={styles.stageState} aria-hidden="true" />
                  {activeStage === stage.key ? (
                    <i
                      key={`${stage.key}-${autoplay}`}
                      className={styles.tabProgress}
                      aria-hidden="true"
                      style={
                        {
                          "--progress-duration": `${AUTO_ADVANCE_MS}ms`,
                          animationPlayState: autoplay ? "running" : "paused",
                        } as CSSProperties
                      }
                    />
                  ) : null}
                </button>
              ))}
            </div>
            <div className={styles.railFooter} aria-hidden="true">
              <span>
                <i /> sqlite · loopback
              </span>
              <span>v0.1</span>
            </div>
          </div>
          <section
            id={`${idPrefix}-panel-${active.key}`}
            role="tabpanel"
            aria-labelledby={`${idPrefix}-tab-${active.key}`}
            className={styles.previewMain}
          >
            <header className={styles.previewHeader}>
              <div>
                <span>research-assistant / {active.title.toLowerCase()}</span>
                <strong>{active.value}</strong>
              </div>
              <StageBadge
                stage={active.key}
                running={inView && !reduceMotion}
              />
            </header>
            <p className={styles.previewDescription} aria-live="polite">
              {active.description}
            </p>
            <div className={styles.previewScene}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.key}
                  className={styles.previewTake}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  {activeStage === "connect" && (
                    <ConnectScene
                      running={inView}
                      reduceMotion={reduceMotion}
                    />
                  )}
                  {activeStage === "observe" && (
                    <TraceScene
                      running={inView}
                      reduceMotion={reduceMotion}
                      onInteract={() => setInteracted(true)}
                    />
                  )}
                  {activeStage === "curate" && (
                    <DatasetScene
                      running={inView}
                      reduceMotion={reduceMotion}
                    />
                  )}
                  {activeStage === "evaluate" && (
                    <EvaluationScene
                      running={inView}
                      reduceMotion={reduceMotion}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </section>
        </div>
      </div>
      {variant === "desktop" ? (
        <div className={styles.previewDock} aria-live="polite">
          <span>Ask AutoEval</span>
          <p
            key={active.key}
            className={reduceMotion ? undefined : styles.dockTyping}
          >
            {active.prompt}
          </p>
          <div>
            <button type="button" onClick={() => select(nextStage.key)}>
              continue to {nextStage.label.toLowerCase()}
              <span aria-hidden="true">↑</span>
            </button>
            <small>⌘ ↵</small>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SceneProps = {
  running: boolean;
  reduceMotion: boolean;
  onInteract?: () => void;
};

function StageBadge({ stage, running }: { stage: Stage; running: boolean }) {
  const phase = useCycle([1800, 6000], running, stage);
  const settled = !running || phase === 1;
  const labels: Record<Stage, [string, string]> = {
    connect: ["Reading manifest", "Registered"],
    observe: ["Running", "Version pinned"],
    curate: ["Draft", "Ready to finalize"],
    evaluate: ["768 runs in flight", "Complete"],
  };
  const [pending, done] = labels[stage];
  return (
    <BadgeSwap
      active={settled ? 1 : 0}
      items={[
        <Badge key="pending" tone="warning" spinning>
          {pending}
        </Badge>,
        <Badge key="done" tone="success">
          {done}
        </Badge>,
      ]}
    />
  );
}

function ConnectScene({ running, reduceMotion }: SceneProps) {
  const phase = useCycle([2200, 3200, 1400], running && !reduceMotion);
  const registered = reduceMotion || phase >= 1;
  const rows = [
    ["graph", "graph.json · 4 nodes"],
    ["handlers", "handlers.py · retrieve, generate"],
    ["scoring", "scoring.py · grounding, citation_format"],
    ["trace policy", "policy.py · redact inputs"],
  ];
  return (
    <div className={styles.connectScene}>
      <div className={styles.editor}>
        <div className={styles.editorBar}>
          <i />
          <i />
          <i />
          <span>research_assistant/plugin.py</span>
        </div>
        <pre>
          <span>
            <b>1</b>
            <em>from</em> autoeval_api <em>import</em> CodeAdapter
          </span>
          <span>
            <b>2</b>
          </span>
          <span>
            <b>3</b>
            <i>system_key</i> = &quot;research-assistant&quot;
          </span>
          <span>
            <b>4</b>
            <i>default_model</i> = &quot;candidate-a&quot;
          </span>
          <span>
            <b>5</b>
            <i>register_handlers</i>(registry)
          </span>
          <span data-typing={phase === 0 && !reduceMotion ? "true" : "false"}>
            <b>6</b>
            <i>scoring_entries</i> = [grounding, citation_format]
          </span>
        </pre>
      </div>
      <div className={styles.contractArrow}>
        registered with
        <br />
        <b>CODE ADAPTER</b>
        <span data-active={registered ? "true" : "false"}>→</span>
      </div>
      <ul
        className={styles.contractStack}
        data-show={registered ? "true" : "false"}
      >
        {rows.map(([name, detail], index) => (
          <li
            key={name}
            style={{ "--i": index } as CSSProperties}
            className={registered ? styles.rowEnter : undefined}
          >
            <span>{name}</span>
            <small>{detail}</small>
            <b className={registered ? styles.checkPop : undefined}>✓</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

const traceNodes = [
  {
    x: 8,
    kind: "input",
    name: "question",
    ms: "0 ms",
    detail: "dataset item 017",
  },
  {
    x: 112,
    kind: "step",
    name: "normalize",
    ms: "2 ms",
    detail: "deterministic",
  },
  {
    x: 216,
    kind: "live",
    name: "fetch",
    ms: "142 ms",
    detail: "snapshot 93f2",
  },
  {
    x: 320,
    kind: "model",
    name: "generate",
    ms: "820 ms",
    detail: "claude-sonnet-5",
  },
  {
    x: 424,
    kind: "check",
    name: "grounding",
    ms: "446 ms",
    detail: "score 0.92",
  },
] as const;

const NODE_W = 90;

function TraceScene({ running, reduceMotion, onInteract }: SceneProps) {
  const [pinned, setPinned] = useState<number | null>(null);
  const playing = running && !reduceMotion && pinned === null;
  const phase = useCycle([1100, 1200, 1800, 1600, 2600], playing, pinned);
  const done = reduceMotion || pinned !== null ? 5 : phase;
  const statusOf = (index: number) =>
    index < done ? "complete" : index === done ? "running" : "pending";
  const selectedIndex = pinned ?? Math.min(done, 4);

  function pin(index: number) {
    setPinned(index);
    onInteract?.();
  }
  const selected = traceNodes[selectedIndex];
  const snapshotState = done > 2 ? "frozen" : done === 2 ? "capturing" : "idle";
  const spans = [
    { name: "question", start: 0, width: 1, tone: "logic" },
    { name: "normalize", start: 1, width: 1, tone: "logic" },
    { name: "fetch", start: 2, width: 10, tone: "live" },
    { name: "generate", start: 12, width: 57, tone: "model" },
    { name: "grounding", start: 69, width: 31, tone: "check" },
  ];
  const outputs: Record<string, string> = {
    question:
      '{ "text": "Which 2024 paper introduced the retrieval benchmark we use in evals?",\n  "user": "analyst-7", "item": "017" }',
    normalize:
      '{ "query": "2024 paper retrieval benchmark evals",\n  "language": "en", "entities": ["retrieval benchmark"] }',
    fetch:
      '{ "snapshot": "93f2", "frozen": true,\n  "quotes": 12, "documents": 3, "age": "0 ms (replayed)" }',
    generate:
      '"The benchmark was introduced in BEIR-2 (Thakur et al., 2024)…"\n{ "model": "claude-sonnet-5", "tokens": 1284, "cost_usd": 0.0042 }',
    grounding:
      '{ "score": 0.92, "citations": 4, "in_context": 4,\n  "verdict": "pass" }',
  };
  const detailRows: Record<string, [string, string][]> = {
    question: [
      ["Source", "dataset item 017"],
      ["Tokens", "38"],
    ],
    normalize: [
      ["Handler", "normalize_query"],
      ["Pure", "yes · no I/O"],
    ],
    fetch: [
      ["Provider", "market + docs"],
      ["Snapshot", "93f2 · frozen"],
      ["Documents", "3"],
    ],
    generate: [
      ["Model", "claude-sonnet-5"],
      ["Tokens", "1,284"],
      ["Cost", "$0.0042"],
    ],
    grounding: [
      ["Score", "0.92"],
      ["Sources", "4 / 4 in context"],
    ],
  };
  return (
    <div className={styles.traceScene}>
      <div className={styles.traceCanvas}>
        <div className={styles.traceToolbar}>
          <span>
            {pinned === null
              ? "playing back the run · click a step to inspect it"
              : `inspecting ${selected.name} · playback paused`}
          </span>
          {pinned !== null ? (
            <button type="button" onClick={() => setPinned(null)}>
              <b aria-hidden="true">▶</b> replay run
            </button>
          ) : null}
        </div>
        <svg viewBox="0 0 522 210" className={styles.traceSvg}>
          {traceNodes.slice(0, -1).map((node, index) => (
            <g key={node.name}>
              <line
                className={styles.graphEdge}
                x1={node.x + NODE_W}
                y1={84}
                x2={traceNodes[index + 1].x}
                y2={84}
              />
              <line
                className={styles.graphEdgeFill}
                pathLength="1"
                x1={node.x + NODE_W}
                y1={84}
                x2={traceNodes[index + 1].x}
                y2={84}
                data-active={done > index ? "true" : "false"}
              />
            </g>
          ))}
          {traceNodes.map((node, index) => (
            <g
              key={node.name}
              className={`${styles.graphNode} ${styles.graphNodeButton}`}
              data-kind={node.kind}
              data-status={statusOf(index)}
              data-selected={selected.name === node.name ? "true" : "false"}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${node.name} step`}
              onClick={() => pin(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  pin(index);
                }
              }}
            >
              <rect x={node.x} y={58} width={NODE_W} height="52" rx="8" />
              <rect
                x={node.x}
                y={68}
                width="2.5"
                height="32"
                className={styles.graphNodeBar}
              />
              <text x={node.x + 12} y={75} className={styles.graphNodeKind}>
                {node.kind}
              </text>
              <text x={node.x + 12} y={91} className={styles.graphNodeName}>
                {node.name}
              </text>
              <text x={node.x + 12} y={103} className={styles.graphNodeMeta}>
                {index < done
                  ? node.ms
                  : index === done
                    ? "running…"
                    : "queued"}
              </text>
              <circle
                cx={node.x + NODE_W - 11}
                cy={70}
                r="3"
                className={styles.graphNodeDot}
              />
            </g>
          ))}
          <g className={styles.snapshotTag} data-state={snapshotState}>
            <line x1="261" y1="110" x2="261" y2="132" />
            <rect x="203" y="132" width="116" height="40" rx="7" />
            <text x="214" y="148" className={styles.graphNodeKind}>
              external data
            </text>
            <text x="214" y="163" className={styles.snapshotTagValue}>
              {snapshotState === "frozen"
                ? "snapshot 93f2 · frozen"
                : snapshotState === "capturing"
                  ? "capturing quotes + docs…"
                  : "captured on first run"}
            </text>
          </g>
          <text x="8" y="26" className={styles.graphNodeKind}>
            graph v7 · 5 nodes · one path
          </text>
          <text x="8" y="40" className={styles.graphNodeMeta}>
            deterministic steps replay, live steps read the frozen snapshot,
            model steps call the candidate
          </text>
        </svg>
        <div className={styles.traceOutput}>
          <span>
            {selected.name} output
            <b>{done > selectedIndex ? "recorded" : "pending"}</b>
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.pre
              key={selected.name}
              initial={reduceMotion ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              {outputs[selected.name]}
            </motion.pre>
          </AnimatePresence>
        </div>
        <div className={styles.traceSpans}>
          {spans.map((span, index) => (
            <button
              type="button"
              key={span.name}
              aria-label={`Inspect ${span.name} span`}
              data-tone={span.tone}
              data-selected={selectedIndex === index ? "true" : "false"}
              data-show={index <= done ? "true" : "false"}
              onClick={() => pin(index)}
              style={
                {
                  left: `${span.start}%`,
                  width: `${span.width}%`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
      <aside className={styles.inspector}>
        <span>SPAN DETAIL</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selected.name}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
          >
            <strong>{selected.name}</strong>
            <dl>
              <div>
                <dt>Status</dt>
                <dd className={done > selectedIndex ? styles.ok : styles.warn}>
                  ● {done > selectedIndex ? "complete" : "running"}
                </dd>
              </div>
              <div>
                <dt>Kind</dt>
                <dd>{selected.kind}</dd>
              </div>
              {detailRows[selected.name].map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div>
                <dt>Latency</dt>
                <dd>{selected.ms}</dd>
              </div>
            </dl>
          </motion.div>
        </AnimatePresence>
      </aside>
    </div>
  );
}

const caseItems = [
  ["001", "Ambiguous retrieval", "tr_01J8F2KQ"],
  ["002", "Missing source citation", "tr_01J8E9MP"],
  ["003", "Conflicting context", "tr_01J8D44A"],
] as const;

function DatasetScene({ running, reduceMotion }: SceneProps) {
  const phase = useCycle([1600, 1800, 2600], running && !reduceMotion);
  const added = reduceMotion || phase >= 1;
  const finalizing = reduceMotion || phase >= 2;
  return (
    <div className={styles.datasetScene}>
      <div className={styles.datasetToolbar}>
        <span>{added ? "129" : "128"} CASES</span>
        <BadgeSwap
          active={finalizing ? 1 : 0}
          items={[
            <Badge key="draft" tone="warning">
              Draft
            </Badge>,
            <Badge key="ready" tone="success">
              Ready
            </Badge>,
          ]}
        />
        <button
          type="button"
          tabIndex={-1}
          data-pressed={finalizing ? "true" : "false"}
        >
          Finalize v4
        </button>
      </div>
      <div className={styles.caseList}>
        {caseItems.map(([id, name, source]) => (
          <div key={id}>
            <span>{id}</span>
            <strong>{name}</strong>
            <small>from {source}</small>
            <b>reviewed</b>
          </div>
        ))}
        {added ? (
          <div className={styles.entryEnter}>
            <span>004</span>
            <strong>Grounding cites outside context</strong>
            <small>from tr_01J8F2KQ</small>
            <b data-new="true">just added</b>
          </div>
        ) : null}
      </div>
      {added ? (
        <div className={styles.caseDetail}>
          <div
            className={styles.entryEnter}
            style={{ "--i": 0 } as CSSProperties}
          >
            <span>INPUT</span>
            <p>
              &quot;Which 2024 paper introduced the retrieval benchmark we use
              in evals?&quot;
            </p>
          </div>
          <div
            className={styles.entryEnter}
            style={{ "--i": 1 } as CSSProperties}
          >
            <span>WHY IT WAS SAVED</span>
            <p>
              The answer cited arxiv:2403.0117, which none of the three
              retrieved documents contain.
            </p>
          </div>
          <div
            className={styles.entryEnter}
            style={{ "--i": 2 } as CSSProperties}
          >
            <span>SCORING</span>
            <p>grounding · citation_format</p>
          </div>
        </div>
      ) : null}
      <footer>
        <span>SOURCE RUN ATTACHED</span>
        <code>graph v7 · prompt v12 · snapshot 93f2</code>
      </footer>
    </div>
  );
}

const candidates = [
  {
    name: "Claude Opus 5",
    short: "Opus 5",
    vendor: "anthropic",
    score: 95,
    cost: 0.062,
    latency: "2.1s",
  },
  {
    name: "Claude Sonnet 5",
    short: "Sonnet 5",
    vendor: "anthropic",
    score: 93,
    cost: 0.021,
    latency: "1.2s",
  },
  {
    name: "ra-sonnet-ft-v3",
    short: "ft-v3",
    vendor: "finetune",
    score: 92,
    cost: 0.006,
    latency: "0.7s",
    best: true,
  },
  {
    name: "GPT-5",
    short: "GPT-5",
    vendor: "openai",
    score: 91,
    cost: 0.028,
    latency: "1.4s",
  },
  {
    name: "Claude Haiku 4.5",
    short: "Haiku 4.5",
    vendor: "anthropic",
    score: 86,
    cost: 0.004,
    latency: "0.6s",
  },
  {
    name: "Gemini 3 Flash",
    short: "Gemini 3 Flash",
    vendor: "google",
    score: 84,
    cost: 0.003,
    latency: "0.5s",
  },
] as const;

const vendorLabels: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  finetune: "Fine-tuned (yours)",
};

const caseRows = [
  ["001", "Ambiguous retrieval", true, true, false],
  ["002", "Missing source citation", true, true, false],
  ["003", "Conflicting context", true, true, true],
  ["004", "Grounding cites outside context", false, true, false],
] as const;

const CHART = { w: 520, h: 236, left: 44, right: 14, top: 18, bottom: 34 };
const X_MAX = 0.07;
const Y_MIN = 78;
const Y_MAX = 100;

function chartX(cost: number) {
  return CHART.left + (cost / X_MAX) * (CHART.w - CHART.left - CHART.right);
}

function chartY(score: number) {
  return (
    CHART.top +
    (1 - (score - Y_MIN) / (Y_MAX - Y_MIN)) *
      (CHART.h - CHART.top - CHART.bottom)
  );
}

function EvaluationScene({ running, reduceMotion }: SceneProps) {
  const phase = useCycle([1400, 2200, 3200], running && !reduceMotion);
  const scored = reduceMotion || phase >= 1;
  const complete = reduceMotion || phase >= 2;
  const xTicks = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07];
  const yTicks = [80, 85, 90, 95, 100];
  return (
    <div className={styles.evaluationScene}>
      <div className={styles.evalSummary}>
        <div>
          <span>STATUS</span>
          <b className={complete ? styles.ok : styles.warn}>
            ● {complete ? "complete" : "running"}
          </b>
        </div>
        <div>
          <span>DATASET</span>
          <b>failure-modes / v4</b>
        </div>
        <div>
          <span>CASES</span>
          <b>128 × 6 models</b>
        </div>
      </div>
      <div className={styles.chart} aria-hidden="true">
        <div className={styles.chartHead}>
          <strong>Eval score vs. cost per case</strong>
          <span>
            grounding + citation_format · lower cost and higher score is better
          </span>
        </div>
        <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} className={styles.chartSvg}>
          <rect
            className={styles.chartQuadrant}
            data-show={scored ? "true" : "false"}
            x={chartX(0)}
            y={chartY(100)}
            width={chartX(0.012) - chartX(0)}
            height={chartY(88) - chartY(100)}
          />
          <text
            className={styles.chartQuadrantLabel}
            data-show={scored ? "true" : "false"}
            x={chartX(0) + 8}
            y={chartY(100) + 13}
          >
            most attractive quadrant
          </text>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                className={styles.chartGrid}
                x1={CHART.left}
                x2={CHART.w - CHART.right}
                y1={chartY(tick)}
                y2={chartY(tick)}
              />
              <text
                className={styles.chartTick}
                x={CHART.left - 6}
                y={chartY(tick) + 3}
                textAnchor="end"
              >
                {tick}%
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={tick}>
              <line
                className={styles.chartGrid}
                y1={CHART.top}
                y2={CHART.h - CHART.bottom}
                x1={chartX(tick)}
                x2={chartX(tick)}
              />
              <text
                className={styles.chartTick}
                x={chartX(tick)}
                y={CHART.h - CHART.bottom + 12}
                textAnchor="middle"
              >
                ${tick.toFixed(2)}
              </text>
            </g>
          ))}
          <text
            className={styles.chartAxis}
            x={(CHART.left + CHART.w - CHART.right) / 2}
            y={CHART.h - 4}
            textAnchor="middle"
          >
            cost per case (USD)
          </text>
          <text
            className={styles.chartAxis}
            transform={`translate(10 ${(CHART.top + CHART.h - CHART.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            eval score
          </text>
          {candidates.map((candidate, index) => {
            const cx = chartX(candidate.cost);
            const cy = chartY(candidate.score);
            const labelLeft = candidate.cost > 0.05;
            return (
              <g
                key={candidate.name}
                className={styles.chartPoint}
                data-vendor={candidate.vendor}
                data-show={scored ? "true" : "false"}
                data-best={"best" in candidate ? "true" : "false"}
                style={
                  {
                    "--i": index,
                    "--cx": `${cx}px`,
                    "--cy": `${cy}px`,
                  } as CSSProperties
                }
              >
                {"best" in candidate && complete ? (
                  <circle className={styles.chartRing} cx={cx} cy={cy} r="6" />
                ) : null}
                <circle cx={cx} cy={cy} r="5" />
                <text
                  x={labelLeft ? cx - 9 : cx + 9}
                  y={cy + 3}
                  textAnchor={labelLeft ? "end" : "start"}
                >
                  {candidate.name}
                </text>
              </g>
            );
          })}
        </svg>
        <div className={styles.chartLegend}>
          {Object.entries(vendorLabels).map(([vendor, label]) => (
            <span key={vendor} data-vendor={vendor}>
              <i />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.evalCases} aria-label="Per-case results">
        <header>
          <span>CASE</span>
          <span>Sonnet 5</span>
          <span>ft-v3</span>
          <span>Haiku 4.5</span>
        </header>
        {caseRows.map(([id, name, ...results], rowIndex) => (
          <div key={id}>
            <span>{id}</span>
            <strong>{name}</strong>
            {results.map((passed, index) => (
              <b
                key={index}
                className={`${passed ? styles.pass : styles.fail} ${scored ? styles.tilePop : ""}`}
                data-show={scored ? "true" : "false"}
                style={{ "--i": rowIndex * 3 + index } as CSSProperties}
                aria-label={passed ? "passed" : "failed"}
              >
                {passed ? "✓" : "✗"}
              </b>
            ))}
          </div>
        ))}
      </div>
      <footer>
        <span>
          {complete ? "768 / 768" : scored ? "612 / 768" : "180 / 768"} runs
          resolved
        </span>
        <i>
          <b style={{ width: complete ? "100%" : scored ? "80%" : "23%" }} />
        </i>
      </footer>
    </div>
  );
}
