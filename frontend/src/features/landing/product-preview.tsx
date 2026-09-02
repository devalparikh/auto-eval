"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

import styles from "@/features/landing/landing.module.css";

const stages = [
  {
    key: "connect",
    index: "01",
    label: "Connect",
    title: "Agent setup",
    value: "research-assistant / v7",
    description:
      "Register the graph and handlers. Your agent code stays in its own package.",
    meta: "graph and handlers",
    icon: "⌁",
  },
  {
    key: "observe",
    index: "02",
    label: "Trace",
    title: "Trace",
    value: "tr_01J8F2KQ",
    description:
      "Open one run. Check the node path, timing, model call, and output.",
    meta: "current trace",
    icon: "◇",
  },
  {
    key: "curate",
    index: "03",
    label: "Save",
    title: "Dataset",
    value: "failure-modes / v4",
    description:
      "Add the reviewed trace to a draft dataset. Finalize it when it is ready.",
    meta: "128 reviewed cases",
    icon: "↓",
  },
  {
    key: "evaluate",
    index: "04",
    label: "Compare",
    title: "Evaluation",
    value: "comparison / 024",
    description: "Run the same locked cases against each model.",
    meta: "four candidates",
    icon: "↗",
  },
] as const;

type Stage = (typeof stages)[number]["key"];

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
  const [activeStage, setActiveStage] = useState<Stage>(initialStage);
  const active = stages.find((stage) => stage.key === activeStage) ?? stages[1];
  const activeIndex = stages.findIndex((stage) => stage.key === activeStage);
  const nextStage = stages[(activeIndex + 1) % stages.length];

  return (
    <div
      className={`${styles.productPreview} ${variant === "desktop" ? styles.desktopPreview : ""}`}
      aria-label={label}
    >
      <div className={styles.previewWindow}>
        <div className={styles.previewChrome}>
          <div className={styles.previewDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span className={styles.previewWindowTitle}>AutoEval Desktop</span>
          <div className={styles.previewChromeTools}>
            <span className={styles.workspaceAvatar}>RA</span>
            <span>Research assistant</span>
            <span className={styles.previewLive}>
              <i /> running locally
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
              <span>⌘ K</span>
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
                onClick={() => setActiveStage(stage.key)}
              >
                <span className={styles.stageIcon} aria-hidden="true">
                  {stage.icon}
                </span>
                <span className={styles.stageCopy}>
                  <b>{stage.label}</b>
                  <small>{stage.meta}</small>
                </span>
                <span className={styles.stageIndex}>{stage.index}</span>
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
              <b>
                {activeStage === "evaluate" ? "complete" : "version pinned"}
              </b>
            </header>
            <p className={styles.previewDescription} aria-live="polite">
              {active.description}
            </p>
            {activeStage === "connect" && <ConnectScene />}
            {activeStage === "observe" && <TraceScene />}
            {activeStage === "curate" && <DatasetScene />}
            {activeStage === "evaluate" && <EvaluationScene />}
          </section>
        </div>
      </div>
      {variant === "desktop" ? (
        <div className={styles.previewDock} aria-live="polite">
          <span>Ask AutoEval</span>
          <p>Review this trace, keep the useful failures, then compare.</p>
          <div>
            <button type="button" onClick={() => setActiveStage(nextStage.key)}>
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

function ConnectScene() {
  return (
    <div className={styles.connectScene}>
      <div className={styles.codePanel}>
        <span>plugin.py</span>
        <code>
          <i>system_key</i> = &quot;research-assistant&quot;
          <br />
          <i>register_handlers</i>(registry)
          <br />
          <i>scoring_entries</i> = [...]
        </code>
      </div>
      <div className={styles.contractArrow}>
        registered with
        <br />
        <b>CODE ADAPTER</b>
        <span>→</span>
      </div>
      <div className={styles.contractStack}>
        <span>GRAPH</span>
        <span>HANDLERS</span>
        <span>SCORING</span>
        <span>TRACE POLICY</span>
      </div>
    </div>
  );
}

function TraceScene() {
  const nodes = [
    {
      id: "question",
      kind: "INPUT",
      name: "Question",
      meta: "0 ms",
      x: 7,
      y: 50,
    },
    {
      id: "retrieve",
      kind: "TOOL",
      name: "Retrieve",
      meta: "142 ms",
      x: 36,
      y: 27,
    },
    {
      id: "generate",
      kind: "MODEL",
      name: "Generate",
      meta: "820 ms",
      x: 65,
      y: 50,
    },
    {
      id: "grounding",
      kind: "CHECK",
      name: "Grounding",
      meta: "passed",
      x: 36,
      y: 79,
    },
  ] as const;
  const [selected, setSelected] =
    useState<(typeof nodes)[number]["id"]>("generate");
  const activeNode = nodes.find((node) => node.id === selected) ?? nodes[2];
  return (
    <div className={styles.traceScene}>
      <div className={styles.traceCanvas}>
        <div className={styles.canvasTools} aria-label="Graph controls">
          <button type="button" aria-label="Zoom out">
            −
          </button>
          <span>100%</span>
          <button type="button" aria-label="Zoom in">
            +
          </button>
          <button type="button">Fit</button>
        </div>
        <svg
          className={styles.graphEdges}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="trace-arrow"
              markerWidth="5"
              markerHeight="5"
              refX="4"
              refY="2.5"
              orient="auto"
            >
              <path d="M0,0 L5,2.5 L0,5 Z" />
            </marker>
          </defs>
          <path d="M31 50 C34 50 33 27 36 27" />
          <path d="M60 27 C63 27 62 50 65 50" />
          <path d="M65 56 C62 56 63 79 60 79" />
        </svg>
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`${styles.previewNode} ${selected === node.id ? styles.selectedNode : ""}`}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            aria-pressed={selected === node.id}
            onClick={() => setSelected(node.id)}
          >
            <span>
              <i /> {node.kind}
            </span>
            <b>{node.name}</b>
            <small>{node.meta}</small>
            <em aria-hidden="true" />
          </button>
        ))}
      </div>
      <aside className={styles.inspector}>
        <span>SPAN DETAIL</span>
        <strong>{activeNode.name}</strong>
        <dl>
          <div>
            <dt>Status</dt>
            <dd className={styles.ok}>● complete</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{activeNode.id === "generate" ? "Claude 3.5 Haiku" : "—"}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>1,284</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>$0.0042</dd>
          </div>
          <div>
            <dt>Latency</dt>
            <dd>820 ms</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function DatasetScene() {
  const [mode, setMode] = useState<"review" | "tag" | "finalize">("review");
  return (
    <div className={styles.datasetScene}>
      <div className={styles.datasetToolbar}>
        <span>128 CASES</span>
        <b>DRAFT</b>
        <div className={styles.saveModes} aria-label="Dataset mode">
          {(["review", "tag", "finalize"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.caseList}>
        <div>
          <span>001</span>
          <strong>Ambiguous retrieval</strong>
          <small>from tr_01J8F2KQ</small>
          <b>reviewed</b>
        </div>
        <div>
          <span>002</span>
          <strong>Missing source citation</strong>
          <small>from tr_01J8E9MP</small>
          <b>reviewed</b>
        </div>
        <div>
          <span>003</span>
          <strong>Conflicting context</strong>
          <small>from tr_01J8D44A</small>
          <b>reviewed</b>
        </div>
      </div>
      <footer>
        <span>
          {mode === "finalize"
            ? "READY TO LOCK AS V4"
            : mode === "tag"
              ? "TAGGING FAILURE MODES"
              : "SOURCE RUN ATTACHED"}
        </span>
        <code>graph v7 · prompt v12 · snapshot 93f…</code>
      </footer>
    </div>
  );
}

function EvaluationScene() {
  const models = [
    {
      name: "Claude 3.5 Haiku",
      quality: 91,
      cost: 1.79,
      latency: "1.2s",
      x: 74,
      color: "#e06b55",
    },
    {
      name: "GPT-4o mini",
      quality: 86,
      cost: 0.77,
      latency: "0.8s",
      x: 27,
      color: "#5f8f7a",
    },
    {
      name: "Gemini 1.5 Flash",
      quality: 82,
      cost: 0.43,
      latency: "0.6s",
      x: 12,
      color: "#6e7fa8",
    },
    {
      name: "Llama 3.1 70B",
      quality: 79,
      cost: 1.15,
      latency: "1.6s",
      x: 48,
      color: "#9a7aaa",
    },
  ] as const;
  type ModelName = (typeof models)[number]["name"];
  const [selected, setSelected] = useState<ModelName>(models[0].name);
  return (
    <div className={styles.evaluationScene}>
      <div className={styles.evalSummary}>
        <div>
          <span>STATUS</span>
          <b className={styles.ok}>● complete</b>
        </div>
        <div>
          <span>DATASET</span>
          <b>failure-modes / v4</b>
        </div>
        <div>
          <span>CASES</span>
          <b>128 × 4 models</b>
        </div>
      </div>
      <div className={styles.comparisonLayout}>
        <div
          className={styles.dotChart}
          aria-label="Model quality versus cost comparison"
        >
          <span className={styles.yLabel}>quality score ↑</span>
          <div className={styles.chartPlot}>
            <div className={styles.targetZone}>best value</div>
            {models.map((model) => (
              <button
                key={model.name}
                type="button"
                className={selected === model.name ? styles.selectedDot : ""}
                style={
                  {
                    left: `${model.x}%`,
                    bottom: `${model.quality - 70}%`,
                    "--dot-color": model.color,
                  } as CSSProperties
                }
                onClick={() => setSelected(model.name)}
                aria-label={`${model.name}: ${model.quality}% quality, $${model.cost} cost`}
              >
                <i />
                <span>{model.name}</span>
              </button>
            ))}
          </div>
          <span className={styles.xLabel}>cost per 128 cases →</span>
        </div>
        <div className={styles.modelLegend}>
          {models.map((model) => (
            <button
              key={model.name}
              type="button"
              aria-pressed={selected === model.name}
              onClick={() => setSelected(model.name)}
            >
              <i style={{ background: model.color }} />
              <span>
                <b>{model.name}</b>
                <small>
                  {model.quality}% · ${model.cost} · {model.latency}
                </small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <footer>
        <span>512 / 512 runs resolved</span>
        <i>
          <b />
        </i>
      </footer>
    </div>
  );
}
