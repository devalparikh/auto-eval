"use client";

import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

import styles from "./dotted-text.module.css";
import { attachDottedTextCanvas } from "./dotted-text-canvas";

type DottedTextStyle = CSSProperties & {
  "--dotted-text-color": string;
  "--dotted-text-dot-size": string;
  "--dotted-text-dot-spacing": string;
};

type DottedTextProps = Omit<ComponentPropsWithoutRef<"span">, "color"> & {
  color?: string;
  dotSize?: number;
  dotSpacing?: number;
  interactionRadius?: number;
  interactionStrength?: number;
};

export function DottedText({
  children,
  className,
  color = "var(--accent)",
  dotSize = 1.2,
  dotSpacing = 4,
  interactionRadius,
  interactionStrength,
  style,
  ...props
}: DottedTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  const dottedTextStyle: DottedTextStyle = {
    ...style,
    "--dotted-text-color": color,
    "--dotted-text-dot-size": `${dotSize}px`,
    "--dotted-text-dot-spacing": `${dotSpacing}px`,
  };

  useEffect(() => {
    const root = rootRef.current;
    const text = textRef.current;
    const canvas = canvasRef.current;

    if (reduceMotion || !root || !text || !canvas) return;

    return attachDottedTextCanvas({
      canvas,
      dotSize,
      dotSpacing,
      interactionRadius,
      interactionStrength,
      root,
      text,
    });
  }, [
    children,
    color,
    dotSize,
    dotSpacing,
    interactionRadius,
    interactionStrength,
    reduceMotion,
  ]);

  return (
    <span
      {...props}
      ref={rootRef}
      className={[styles.dottedText, className].filter(Boolean).join(" ")}
      style={dottedTextStyle}
    >
      <span ref={textRef} className={styles.staticText}>
        {children}
      </span>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
    </span>
  );
}
