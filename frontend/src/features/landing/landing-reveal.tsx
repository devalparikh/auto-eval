"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

type LandingRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  mode?: "load" | "scroll";
};

const visible = { opacity: 1, y: 0, filter: "blur(0px)" };

export function LandingReveal({
  children,
  className,
  delay = 0,
  mode = "scroll",
}: LandingRevealProps) {
  const reduceMotion = useReducedMotion();
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
      initial={hidden}
      whileInView={visible}
      viewport={{ once: true, amount: 0.18, margin: "0px 0px -7% 0px" }}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}
