"use client";

import { useInView } from "motion/react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

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
 * Steps through timed beats once and holds the last one, so a scene builds up
 * and settles instead of looping back to empty. Returns 0 at the start and
 * `durations.length` once every beat has played. Pausing (`running` false)
 * holds the current beat; a new `resetKey` replays from the first.
 */
export function useSteps(
  durations: readonly number[],
  running: boolean,
  resetKey: unknown = null,
) {
  const [state, setState] = useState({ step: 0, key: resetKey });
  const step = state.key === resetKey ? state.step : 0;
  const schedule = durations.join(",");

  useEffect(() => {
    if (!running) return;
    const waits = schedule.split(",").map(Number);
    if (step >= waits.length) return;
    const timer = setTimeout(
      () => setState({ step: step + 1, key: resetKey }),
      waits[step],
    );
    return () => clearTimeout(timer);
  }, [step, running, resetKey, schedule]);

  return step;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The reduced-motion preference, read so the first client render matches the
 * server's. Motion's `useReducedMotion` answers true on that first render, so
 * a scene that skips to its finished state rendered different text than the
 * server did, and React threw the page's HTML away to render it again.
 */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Whether an element is on screen and the viewer has not asked for reduced
 * motion. Scenes use this to start their loops only while they are visible.
 */
export function useSceneActive(ref: RefObject<HTMLElement | null>) {
  const reduceMotion = usePrefersReducedMotion();
  const inView = useInView(ref, { amount: 0.4 });
  return { active: inView && !reduceMotion, reduceMotion };
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
