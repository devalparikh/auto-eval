"use client";

import { useState } from "react";

const views = ["Build", "Trace", "Dataset", "Evaluate"] as const;
type PreviewView = (typeof views)[number];
const viewCopy: Record<PreviewView, { label: string; value: string; metric: string }> = {
  Build: { label: "graph version", value: "support-agent / v12", metric: "6 nodes" },
  Trace: { label: "trace", value: "tr_01J8F2KQ", metric: "1.84 s" },
  Dataset: { label: "dataset version", value: "edge-cases / v4", metric: "128 cases" },
  Evaluate: { label: "evaluation", value: "model-comparison / 024", metric: "92.4%" },
};

export function ProductPreview() {
  const [activeView, setActiveView] = useState<PreviewView>("Trace");
  const active = viewCopy[activeView];
  return (
    <div className="product-preview" aria-label="Interactive AutoEval product preview">
      <div className="preview-chrome"><div className="preview-dots" aria-hidden="true"><i /><i /><i /></div><span>workspace / customer-support</span><span className="preview-live"><i /> connected</span></div>
      <div className="preview-body">
        <aside className="preview-sidebar">
          <div className="preview-logo">a/e</div>
          {views.map((view, index) => <button key={view} type="button" aria-label={view} className={activeView === view ? "is-active" : undefined} onClick={() => setActiveView(view)} aria-pressed={activeView === view}><span>0{index + 1}</span>{view}</button>)}
        </aside>
        <div className="preview-main">
          <header className="preview-header"><div><span>{active.label}</span><strong>{active.value}</strong></div><b>{active.metric}</b></header>
          <div className="preview-canvas">
            <div className="preview-flow" aria-hidden="true">
              <div className="preview-node preview-node-input"><span>INPUT</span><b>Request</b><small>validated payload</small></div><i className="preview-line line-one" />
              <div className="preview-node preview-node-context"><span>CONTEXT</span><b>Retrieve</b><small>8 documents</small></div><i className="preview-line line-two" />
              <div className="preview-node preview-node-model"><span>MODEL</span><b>Generate</b><small>open / pinned</small></div><i className="preview-line line-three" />
              <div className="preview-node preview-node-check"><span>CHECK</span><b>Policy</b><small>passed · 42 ms</small></div>
            </div>
            <aside className="preview-inspector"><div className="preview-inspector-title"><span>SPAN DETAIL</span><b>Generate</b></div><dl><div><dt>Status</dt><dd className="preview-ok">● complete</dd></div><div><dt>Model</dt><dd>provider/model-v3</dd></div><div><dt>Tokens</dt><dd>1,284</dd></div><div><dt>Cost</dt><dd>$0.0042</dd></div><div><dt>Latency</dt><dd>820 ms</dd></div></dl><div className="preview-output"><span>OUTPUT</span><p>Response grounded in the retrieved account context.</p></div></aside>
          </div>
          <footer className="preview-timeline"><span>0 ms</span><i /><b style={{ width: activeView === "Evaluate" ? "82%" : "64%" }} /><span>1.84 s</span></footer>
        </div>
      </div>
    </div>
  );
}
