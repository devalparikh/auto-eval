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
    meta: "three candidates",
    prompt: "Run failure-modes v4 against all three candidates.",
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
          <div
            className={styles.previewTabs}
            role="tablist"
            aria-label={tablistLabel}
          >
            <div className={styles.previewSidebarHeader} aria-hidden="true">
              <strong>evaluation loop</strong>
              <span>{activeIndex + 1} / 4</span>
            </div>
            {stages.map((stage) => (
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
                onClick={() => select(stage.key)}
              >
                <span className={styles.stageIndex}>{stage.index}</span>
                <span className={styles.stageCopy}>
                  <b>{stage.label}</b>
                  <small>{stage.meta}</small>
                </span>
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
                    <TraceScene running={inView} reduceMotion={reduceMotion} />
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

type SceneProps = { running: boolean; reduceMotion: boolean };

function StageBadge({ stage, running }: { stage: Stage; running: boolean }) {
  const phase = useCycle([1800, 6000], running, stage);
  const settled = !running || phase === 1;
  const labels: Record<Stage, [string, string]> = {
    connect: ["Reading manifest", "Registered"],
    observe: ["Running", "Version pinned"],
    curate: ["Draft", "Ready to finalize"],
    evaluate: ["384 runs in flight", "Complete"],
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
  { x: 14, y: 96, w: 104, kind: "input", name: "question", ms: "0 ms" },
  { x: 178, y: 30, w: 104, kind: "context", name: "retrieve", ms: "142 ms" },
  { x: 178, y: 162, w: 104, kind: "model", name: "generate", ms: "820 ms" },
  { x: 342, y: 96, w: 104, kind: "check", name: "grounding", ms: "446 ms" },
] as const;

const traceEdges = [
  "M118 122 C 150 122, 148 56, 178 56",
  "M118 122 C 150 122, 148 188, 178 188",
  "M282 56 C 312 56, 312 122, 342 122",
  "M282 188 C 312 188, 312 122, 342 122",
];

function TraceScene({ running, reduceMotion }: SceneProps) {
  const phase = useCycle([1300, 1500, 1500, 2600], running && !reduceMotion);
  const done = reduceMotion ? 4 : phase;
  const statusOf = (index: number) =>
    index < done ? "complete" : index === done ? "running" : "pending";
  const selected = traceNodes[Math.min(done, 3)];
  const selectedIndex = traceNodes.indexOf(selected);
  const spans = [
    { name: "question", start: 0, width: 1, tone: "logic" },
    { name: "retrieve", start: 1, width: 10, tone: "live" },
    { name: "generate", start: 11, width: 58, tone: "model" },
    { name: "grounding", start: 69, width: 31, tone: "check" },
  ];
  return (
    <div className={styles.traceScene}>
      <div className={styles.traceCanvas} aria-hidden="true">
        <svg viewBox="0 0 460 250" className={styles.traceSvg}>
          {traceEdges.map((d, index) => (
            <path
              key={d}
              className={styles.graphEdge}
              d={d}
              data-active={index < 2 ? done >= 1 : done >= 3}
            />
          ))}
          {traceNodes.map((node, index) => (
            <g
              key={node.name}
              className={styles.graphNode}
              data-kind={node.kind}
              data-status={statusOf(index)}
              data-selected={selected.name === node.name ? "true" : "false"}
            >
              <rect x={node.x} y={node.y} width={node.w} height="52" rx="8" />
              <rect
                x={node.x}
                y={node.y + 10}
                width="2.5"
                height="32"
                className={styles.graphNodeBar}
              />
              <text
                x={node.x + 13}
                y={node.y + 17}
                className={styles.graphNodeKind}
              >
                {node.kind}
              </text>
              <text
                x={node.x + 13}
                y={node.y + 33}
                className={styles.graphNodeName}
              >
                {node.name}
              </text>
              <text
                x={node.x + 13}
                y={node.y + 45}
                className={styles.graphNodeMeta}
              >
                {index < done
                  ? node.ms
                  : index === done
                    ? "running…"
                    : "queued"}
              </text>
              <circle
                cx={node.x + node.w - 11}
                cy={node.y + 12}
                r="3"
                className={styles.graphNodeDot}
              />
            </g>
          ))}
          {!reduceMotion ? (
            <circle className={styles.graphPulse} r="3">
              <animateMotion
                dur="2.8s"
                repeatCount="indefinite"
                path="M118 122 C 150 122, 148 56, 178 56 L 282 56 C 312 56, 312 122, 342 122"
              />
            </circle>
          ) : null}
        </svg>
        <div className={styles.traceSpans}>
          {spans.map((span, index) => (
            <span
              key={span.name}
              data-tone={span.tone}
              data-show={index <= done ? "true" : "false"}
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
              {selected.name === "generate" ? (
                <>
                  <div>
                    <dt>Model</dt>
                    <dd>candidate-a</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd>1,284</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>$0.0042</dd>
                  </div>
                </>
              ) : selected.name === "retrieve" ? (
                <>
                  <div>
                    <dt>Documents</dt>
                    <dd>3</dd>
                  </div>
                  <div>
                    <dt>Snapshot</dt>
                    <dd>93f2 · pinned</dd>
                  </div>
                </>
              ) : selected.name === "grounding" ? (
                <>
                  <div>
                    <dt>Score</dt>
                    <dd>0.92</dd>
                  </div>
                  <div>
                    <dt>Sources</dt>
                    <dd>4 / 4 in context</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Source</dt>
                  <dd>dataset item 017</dd>
                </div>
              )}
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

const modelRows = [
  ["candidate-a", 91, "$1.79", "1.2s"],
  ["candidate-b", 86, "$0.77", "0.8s"],
  ["baseline", 79, "$1.15", "1.6s"],
] as const;

const caseRows = [
  ["001", "Ambiguous retrieval", true, true, false],
  ["002", "Missing source citation", true, false, false],
  ["003", "Conflicting context", true, true, true],
  ["004", "Grounding cites outside context", false, true, false],
] as const;

function EvaluationScene({ running, reduceMotion }: SceneProps) {
  const phase = useCycle([1600, 2000, 3000], running && !reduceMotion);
  const scored = reduceMotion || phase >= 1;
  const complete = reduceMotion || phase >= 2;
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
          <b>128 × 3 models</b>
        </div>
      </div>
      <div className={styles.evalTable}>
        <header>
          <span>MODEL</span>
          <span>QUALITY</span>
          <span>COST</span>
          <span>LATENCY</span>
        </header>
        {modelRows.map(([model, quality, cost, latency], index) => (
          <div key={model} style={{ "--i": index } as CSSProperties}>
            <strong>{model}</strong>
            <span className={styles.qualityCell}>
              <i
                data-show={scored ? "true" : "false"}
                style={{ "--w": `${quality}%` } as CSSProperties}
              />
              {scored ? `${quality}%` : "…"}
            </span>
            <span>{scored ? cost : "…"}</span>
            <span>{scored ? latency : "…"}</span>
          </div>
        ))}
      </div>
      <div className={styles.evalCases} aria-label="Per-case results">
        <header>
          <span>CASE</span>
          <span>A</span>
          <span>B</span>
          <span>BASE</span>
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
          {complete ? "384 / 384" : scored ? "312 / 384" : "96 / 384"} runs
          resolved
        </span>
        <i>
          <b style={{ width: complete ? "100%" : scored ? "81%" : "25%" }} />
        </i>
      </footer>
    </div>
  );
}
