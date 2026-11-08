"use client";

import { useInView } from "motion/react";
import { useRef } from "react";

import { usePrefersReducedMotion } from "@/features/landing/landing-motion";
import styles from "@/features/landing/landing.module.css";

// The same run as the hero's trace step: four nodes, 968 ms, one model call.
const TOTAL_MS = 968;

const spans = [
  {
    kind: "LOGIC",
    name: "normalize",
    start: 0,
    duration: 2,
    meta: "normalize_query · replayed",
    tone: "logic",
  },
  {
    kind: "LIVE",
    name: "retrieve",
    start: 2,
    duration: 142,
    meta: "snapshot 93f2 · 3 documents",
    tone: "live",
  },
  {
    kind: "MODEL",
    name: "generate",
    start: 144,
    duration: 820,
    meta: "claude-sonnet-5 · 1,284 tokens",
    tone: "model",
  },
  {
    kind: "LOGIC",
    name: "format",
    start: 964,
    duration: 4,
    meta: "add_citations · 1 citation",
    tone: "logic",
  },
] as const;

const toneClass = {
  logic: styles.spanLogic,
  live: styles.spanLive,
  model: styles.spanModel,
} as const;

/**
 * A recorded run laid out as a span waterfall, with the grounding check that
 * failed on its output. Bars grow in from the left the first time the panel
 * is seen.
 */
export function TraceWaterfall() {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
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
          <span>968 ms · $0.0042</span>
        </header>
        <div className={styles.waterfallScale} aria-hidden="true">
          <div>
            <span>0 ms</span>
            <span>320</span>
            <span>640</span>
            <span>960</span>
          </div>
        </div>
        <ol className={styles.spanList}>
          {spans.map((span, index) => (
            <li
              key={span.name}
              className={`${styles.spanRow} ${toneClass[span.tone]}`}
              style={
                {
                  "--span-start": `${(span.start / TOTAL_MS) * 100}%`,
                  "--span-width": `${Math.max((span.duration / TOTAL_MS) * 100, 1.2)}%`,
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
