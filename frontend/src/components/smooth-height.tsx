"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Eases to the height of its content instead of snapping, so swapping a panel
 * does not jolt everything below it down the page.
 */
export function SmoothHeight({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(content.offsetHeight));
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className="smooth-height"
      initial={false}
      animate={{ height }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }
      }
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
}
