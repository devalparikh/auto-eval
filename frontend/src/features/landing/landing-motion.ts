"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useState, type RefObject } from "react";

/**
 * Cycles through a sequence of timed phases while `running` is true. Each
 * entry is the length of that phase in milliseconds. The phase index resets
 * to 0 whenever `resetKey` changes so a scene replays from its first beat.
 */
export function useCycle(
  durations: readonly number[],
  running: boolean,
  resetKey: unknown = null,
) {
  const [state, setState] = useState({ phase: 0, key: resetKey });
  const phase = state.key === resetKey ? state.phase : 0;
  const schedule = durations.join(",");

  useEffect(() => {
    if (!running) return;
    const waits = schedule.split(",").map(Number);
    const timer = setTimeout(
      () => {
        setState((current) => ({
          phase:
            ((current.key === resetKey ? current.phase : 0) + 1) %
            waits.length,
          key: resetKey,
        }));
      },
      waits[phase] ?? 1000,
    );
    return () => clearTimeout(timer);
  }, [phase, running, resetKey, schedule]);

  return phase;
}

/**
 * Whether an element is on screen and the viewer has not asked for reduced
 * motion. Scenes use this to start their loops only while they are visible.
 */
export function useSceneActive(ref: RefObject<HTMLElement | null>) {
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { amount: 0.4 });
  return {
    active: inView && !reduceMotion,
    reduceMotion: Boolean(reduceMotion),
  };
}

/** A mm:ss timer that counts while `running` is true and resets otherwise. */
export function useTimer(running: boolean) {
  const [state, setState] = useState({ seconds: 0, running });
  const seconds = state.running === running ? state.seconds : 0;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setState((current) => ({
        seconds: (current.running ? current.seconds : 0) + 1,
        running: true,
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
