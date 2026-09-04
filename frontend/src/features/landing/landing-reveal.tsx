"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";

type LandingRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  mode?: "load" | "scroll";
};

const visible = { opacity: 1, y: 0, filter: "blur(0px)" };

/**
 * Fade-and-rise reveal. `data-seen` flips to "true" once the block has been
 * on screen so stylesheet-driven details inside it (typing, toggles, list
 * staggers) can start at the right moment instead of on page load.
 */
export function LandingReveal({
  children,
  className,
  delay = 0,
  mode = "scroll",
}: LandingRevealProps) {
  const reduceMotion = useReducedMotion();
  const [seen, setSeen] = useState(mode === "load");
  const hidden = reduceMotion
    ? false
    : {
        opacity: 0,
        y: mode === "load" ? 14 : 22,
        filter: "blur(8px)",
      };
  const transition = reduceMotion
    ? { duration: 0 }
    : {
        duration: mode === "load" ? 0.58 : 0.64,
        delay,
        ease: [0.16, 1, 0.3, 1] as const,
      };

  if (mode === "load") {
    return (
      <motion.div
        className={className}
        data-seen="true"
        initial={hidden}
        animate={visible}
        transition={transition}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={className}
      data-seen={seen || reduceMotion ? "true" : "false"}
      initial={hidden}
      whileInView={visible}
      onViewportEnter={() => setSeen(true)}
      viewport={{ once: true, amount: 0.18, margin: "0px 0px -7% 0px" }}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}
