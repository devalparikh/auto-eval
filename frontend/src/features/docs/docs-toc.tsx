"use client";

import { ArrowUpIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import type { DocsSection } from "./docs-pages";
import styles from "./docs.module.css";

// The tab glide from x.ai/bot, so the marker arrives rather than slides.
const glide = { duration: 0.22, ease: [0.32, 0.72, 0, 1] } as const;

/** A heading counts as current once its top passes this far down the window. */
const READING_LINE = 120;

/**
 * Which section the reader is in. The last heading above the reading line
 * wins; at the very bottom the last section wins, because a short final
 * section can never reach the line.
 */
function sectionInView(headings: HTMLElement[]): string | null {
  if (!headings.length) return null;
  const atBottom =
    window.scrollY > 0 &&
    window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 4;
  if (atBottom) return headings[headings.length - 1].id;
  let current = headings[0].id;
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top > READING_LINE) break;
    current = heading.id;
  }
  return current;
}

/**
 * The page's sections with a marker on the one being read. Choosing an entry
 * holds the marker there while the page scrolls to it, so it does not stop at
 * every section on the way.
 */
export function DocsToc({ sections }: { sections: DocsSection[] }) {
  const [active, setActive] = useState<string | null>(
    sections[0]?.id ?? null,
  );
  const reduceMotion = useReducedMotion();
  const layoutId = `docs-toc:${useId()}`;
  const hold = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    const headings = sections
      .map((section) => document.getElementById(section.id))
      .filter((heading): heading is HTMLElement => heading !== null);
    let held: string | null = null;
    let frame = 0;
    let releaseTimer = 0;

    function measure() {
      frame = 0;
      if (!held) setActive(sectionInView(headings));
    }
    function release() {
      const heading = held ? document.getElementById(held) : null;
      held = null;
      // Keep the chosen section if the page could not bring it all the way
      // up, as long as it is still in the upper part of the window.
      const top = heading?.getBoundingClientRect().top ?? -1;
      if (top < 0 || top > window.innerHeight * 0.6) measure();
    }
    function releaseAfter(ms: number) {
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(release, ms);
    }
    function onScroll() {
      // While held, wait for the scroll to settle before measuring again.
      if (held) releaseAfter(150);
      else if (!frame) frame = window.requestAnimationFrame(measure);
    }
    function onHashChange() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (sections.some((section) => section.id === id)) hold.current(id);
    }

    hold.current = (id) => {
      held = id;
      setActive(id);
      // A click that does not scroll still lets go.
      releaseAfter(800);
    };
    frame = window.requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("hashchange", onHashChange);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(releaseTimer);
      hold.current = () => {};
    };
  }, [sections]);

  if (!sections.length) return null;

  return (
    <nav className={styles.toc} aria-label="On this page">
      <p className={styles.tocLabel}>On this page</p>
      <ul className={styles.tocList}>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={styles.tocLink}
              aria-current={active === section.id ? "location" : undefined}
              onClick={() => hold.current(section.id)}
            >
              {active === section.id ? (
                <motion.span
                  className={styles.tocMarker}
                  layoutId={reduceMotion ? undefined : layoutId}
                  transition={glide}
                  aria-hidden="true"
                />
              ) : null}
              {section.title}
            </a>
          </li>
        ))}
      </ul>
      <a href="#main-content" className={styles.tocTop}>
        <ArrowUpIcon size={11} aria-hidden="true" />
        Back to top
      </a>
    </nav>
  );
}
