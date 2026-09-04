"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useRef, type ReactNode } from "react";

import styles from "@/features/landing/landing.module.css";

export type HighlightTone = "coral" | "green" | "blue" | "sand" | "slate";

const toneClass: Record<HighlightTone, string> = {
  coral: styles.toneCoral,
  green: styles.toneGreen,
  blue: styles.toneBlue,
  sand: styles.toneSand,
  slate: styles.toneSlate,
};

/**
 * Marker-style highlight behind a run of headline text. The wash is drawn as a
 * background gradient sized to the line so it wraps cleanly, and it sweeps in
 * from the left once the heading scrolls into view.
 */
export function Highlight({
  children,
  tone = "coral",
}: {
  children: ReactNode;
  tone?: HighlightTone;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once: true, amount: 0.6 });

  return (
    <span
      ref={ref}
      className={`${styles.highlight} ${toneClass[tone]}`}
      data-in={reduceMotion || inView ? "true" : "false"}
    >
      {children}
    </span>
  );
}
