"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";

import styles from "@/features/landing/landing.module.css";

const spans = [
  {
    kind: "INPUT",
    name: "question",
    start: 0,
    duration: 4,
    total: 1420,
    meta: "user turn",
    tone: "logic",
  },
  {
    kind: "CONTEXT",
    name: "retrieve",
    start: 4,
    duration: 142,
    total: 1420,
    meta: "3 documents · 2,118 tok",
    tone: "live",
  },
  {
    kind: "MODEL",
    name: "generate",
    start: 150,
    duration: 820,
    total: 1420,
    meta: "candidate-a · 1,284 tok · $0.0042",
    tone: "model",
  },
  {
    kind: "CHECK",
    name: "grounding",
    start: 974,
    duration: 446,
    total: 1420,
    meta: "policy · failed",
    tone: "fail",
  },
] as const;

const toneClass = {
  logic: styles.spanLogic,
  live: styles.spanLive,
  model: styles.spanModel,
  fail: styles.spanFail,
} as const;

/**
 * A recorded run laid out as a span waterfall, ending in the grounding check
 * that failed. Bars grow in from the left the first time the panel is seen.
 */
export function TraceWaterfall() {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once: true, amount: 0.35 });

  return (
    <div
      ref={ref}
      className={styles.waterfall}
      data-in={reduceMotion || inView ? "true" : "false"}
      aria-label="Sample trace: research-assistant run with a failed grounding check"
    >
      <div className={styles.waterfallChips} aria-hidden="true">
        <span className={styles.chip}>tr_01J8F2KQ</span>
        <span className={styles.chip}>graph v7 · prompt v12</span>
        <span className={styles.chip}>1 model call</span>
      </div>
      <div className={styles.waterfallPanel}>
        <header className={styles.waterfallHead}>
          <span>
            <i aria-hidden="true" />
            research-assistant / traces / tr_01J8F2KQ
          </span>
          <span>1.42 s · $0.0042</span>
        </header>
        <div className={styles.waterfallScale} aria-hidden="true">
          <div>
            <span>0 ms</span>
            <span>400</span>
            <span>800</span>
            <span>1,200</span>
          </div>
        </div>
        <ol className={styles.spanList}>
          {spans.map((span, index) => (
            <li
              key={span.name}
              className={`${styles.spanRow} ${toneClass[span.tone]}`}
              style={
                {
                  "--span-start": `${(span.start / span.total) * 100}%`,
                  "--span-width": `${Math.max((span.duration / span.total) * 100, 1.2)}%`,
                  "--span-index": index,
                } as React.CSSProperties
              }
            >
              <span className={styles.spanKind}>{span.kind}</span>
              <span className={styles.spanName}>{span.name}</span>
              <span className={styles.spanTrack} aria-hidden="true">
                <i />
              </span>
              <span className={styles.spanMeta}>
                {span.duration} ms · {span.meta}
              </span>
            </li>
          ))}
        </ol>
        <div className={styles.callout} role="note">
          <span className={styles.calloutTag}>FAIL</span>
          <div>
            <strong>grounding: answer cites a source outside the context</strong>
            <p>
              The reply references arxiv:2403.0117, but the retrieve node
              returned three documents and none of them is that paper.
            </p>
          </div>
          <span className={styles.calloutAction}>
            saved to failure-modes / draft
            <b aria-hidden="true">↗</b>
          </span>
        </div>
      </div>
    </div>
  );
}
