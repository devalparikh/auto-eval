"use client";

import { useState } from "react";

import styles from "@/features/landing/landing.module.css";

const stages = [
  { key: "connect", index: "01", label: "Adapt", title: "System contract", value: "research-assistant / v7", description: "Register a graph and scoped handlers while your domain logic stays in its own package." },
  { key: "observe", index: "02", label: "Observe", title: "Trace", value: "tr_01J8F2KQ", description: "Inspect the path, timing, and captured metadata for one execution." },
  { key: "curate", index: "03", label: "Curate", title: "Dataset", value: "failure-modes / v4", description: "Promote the reviewed trace into a draft, then finalize an immutable test set." },
  { key: "evaluate", index: "04", label: "Evaluate", title: "Evaluation", value: "comparison / 024", description: "Replay the same cases across selected model configurations." },
] as const;

type Stage = (typeof stages)[number]["key"];

export function ProductPreview() {
  const [activeStage, setActiveStage] = useState<Stage>("observe");
  const active = stages.find((stage) => stage.key === activeStage) ?? stages[1];

  return (
    <div className={styles.productPreview} aria-label="Interactive AutoEval product walkthrough">
      <div className={styles.previewChrome}>
        <div className={styles.previewDots} aria-hidden="true"><i /><i /><i /></div>
        <span>workspace / research-assistant</span>
        <span className={styles.previewLive}><i /> local</span>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewTabs} role="tablist" aria-label="Evaluation workflow stages">
          {stages.map((stage) => (
            <button key={stage.key} id={`preview-tab-${stage.key}`} type="button" role="tab" aria-selected={activeStage === stage.key} aria-controls={`preview-panel-${stage.key}`} className={activeStage === stage.key ? styles.activeTab : undefined} onClick={() => setActiveStage(stage.key)}>
              <span>{stage.index}</span>{stage.label}
            </button>
          ))}
        </div>
        <section id={`preview-panel-${active.key}`} role="tabpanel" aria-labelledby={`preview-tab-${active.key}`} className={styles.previewMain}>
          <header className={styles.previewHeader}>
            <div><span>{active.title}</span><strong>{active.value}</strong></div>
            <b>{activeStage === "evaluate" ? "complete" : "version pinned"}</b>
          </header>
          <p className={styles.previewDescription} aria-live="polite">{active.description}</p>
          {activeStage === "connect" && <ConnectScene />}
          {activeStage === "observe" && <TraceScene />}
          {activeStage === "curate" && <DatasetScene />}
          {activeStage === "evaluate" && <EvaluationScene />}
        </section>
      </div>
    </div>
  );
}

function ConnectScene() {
  return <div className={styles.connectScene}><div className={styles.codePanel}><span>plugin.py</span><code><i>system_key</i> = &quot;research-assistant&quot;<br /><i>register_handlers</i>(registry)<br /><i>scoring_entries</i> = [...]</code></div><div className={styles.contractArrow}>registered through<br /><b>SCOPED CONTRACT</b><span>→</span></div><div className={styles.contractStack}><span>GRAPH</span><span>HANDLERS</span><span>SCORING</span><span>TRACE POLICY</span></div></div>;
}

function TraceScene() {
  return <div className={styles.traceScene}><div className={styles.traceCanvas} aria-hidden="true"><div className={`${styles.previewNode} ${styles.inputNode}`}><span>INPUT</span><b>Question</b><small>0 ms</small></div><i className={`${styles.flowLine} ${styles.flowOne}`} /><div className={`${styles.previewNode} ${styles.contextNode}`}><span>CONTEXT</span><b>Retrieve</b><small>142 ms</small></div><i className={`${styles.flowLine} ${styles.flowTwo}`} /><div className={`${styles.previewNode} ${styles.modelNode}`}><span>MODEL</span><b>Generate</b><small>820 ms</small></div><i className={`${styles.flowLine} ${styles.flowThree}`} /><div className={`${styles.previewNode} ${styles.policyNode}`}><span>CHECK</span><b>Grounding</b><small>passed</small></div></div><aside className={styles.inspector}><span>SPAN DETAIL</span><strong>Generate</strong><dl><div><dt>Status</dt><dd className={styles.ok}>● complete</dd></div><div><dt>Model</dt><dd>candidate-a</dd></div><div><dt>Tokens</dt><dd>1,284</dd></div><div><dt>Cost</dt><dd>$0.0042</dd></div><div><dt>Latency</dt><dd>820 ms</dd></div></dl></aside></div>;
}

function DatasetScene() {
  return <div className={styles.datasetScene}><div className={styles.datasetToolbar}><span>128 CASES</span><b>DRAFT</b><button type="button" tabIndex={-1}>Finalize v4</button></div><div className={styles.caseList}><div><span>001</span><strong>Ambiguous retrieval</strong><small>from tr_01J8F2KQ</small><b>reviewed</b></div><div><span>002</span><strong>Missing source citation</strong><small>from tr_01J8E9MP</small><b>reviewed</b></div><div><span>003</span><strong>Conflicting context</strong><small>from tr_01J8D44A</small><b>reviewed</b></div></div><footer><span>PROVENANCE ATTACHED</span><code>graph v7 · prompt v12 · snapshot 93f…</code></footer></div>;
}

function EvaluationScene() {
  return <div className={styles.evaluationScene}><div className={styles.evalSummary}><div><span>STATUS</span><b className={styles.ok}>● complete</b></div><div><span>DATASET</span><b>failure-modes / v4</b></div><div><span>CASES</span><b>128 × 3 models</b></div></div><div className={styles.evalTable}><header><span>MODEL</span><span>QUALITY</span><span>COST</span><span>LATENCY</span></header><div><strong>candidate-a</strong><span>91%</span><span>$1.79</span><span>1.2s</span></div><div><strong>candidate-b</strong><span>86%</span><span>$0.77</span><span>0.8s</span></div><div><strong>baseline</strong><span>79%</span><span>$1.15</span><span>1.6s</span></div></div><footer><span>384 / 384 runs resolved</span><i><b /></i></footer></div>;
}
