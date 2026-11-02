"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { useState, type PointerEvent, type ReactNode } from "react";

const glide = { stiffness: 560, damping: 44, mass: 0.6 };

/**
 * One highlight glides between rows instead of each row fading on its own, so
 * running the pointer down a list reads as a single continuous motion. It moves
 * on a spring and rows can differ in height, so it follows both.
 */
export function useHoverGlide({
  rowSelector,
  rowsKey,
  onRow,
}: {
  rowSelector: string;
  /** Changes when the rows rearrange, which strands the highlight on an old position. */
  rowsKey?: string;
  onRow?: (row: HTMLElement, bounds: DOMRect, jump: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const y = useSpring(0, glide);
  const height = useSpring(0, glide);
  const left = useMotionValue(0);
  const width = useMotionValue(0);
  const [hovering, setHovering] = useState(false);
  const [seenRowsKey, setSeenRowsKey] = useState(rowsKey);

  if (seenRowsKey !== rowsKey) {
    setSeenRowsKey(rowsKey);
    setHovering(false);
  }

  function onPointerOver(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) {
      return;
    }
    const list = event.currentTarget;
    const row = event.target.closest<HTMLElement>(rowSelector);
    if (!row || !list.contains(row)) return;
    const bounds = row.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    const nextY = bounds.top - listBounds.top + list.scrollTop;
    // The first row entered has nowhere to glide from.
    const jump = !hovering || Boolean(reduceMotion);
    if (jump) {
      y.jump(nextY);
      height.jump(bounds.height);
    } else {
      y.set(nextY);
      height.set(bounds.height);
    }
    left.jump(bounds.left - listBounds.left + list.scrollLeft);
    width.jump(bounds.width);
    setHovering(true);
    onRow?.(row, bounds, jump);
  }

  return {
    hovering,
    pillStyle: { y, height, left, width },
    listProps: {
      onPointerOver,
      onPointerLeave: () => setHovering(false),
    },
  };
}

/** A list whose rows share one gliding hover highlight. */
export function HoverGlide({
  children,
  className = "",
  as: Tag = "div",
  rowSelector = ".data-row",
  radius = 0,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "nav";
  rowSelector?: string;
  radius?: number;
  "aria-label"?: string;
}) {
  const { hovering, pillStyle, listProps } = useHoverGlide({ rowSelector });
  return (
    <Tag
      className={`hover-glide ${className}`.trim()}
      aria-label={ariaLabel}
      {...listProps}
    >
      <motion.span
        className="glide-pill"
        style={{ ...pillStyle, borderRadius: radius }}
        data-visible={hovering}
        aria-hidden="true"
      />
      {children}
    </Tag>
  );
}
