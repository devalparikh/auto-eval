"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const GITHUB_URL = "https://github.com/devalparikh/auto-eval";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Single-key shortcuts that mirror the kbd chips on the landing buttons:
 * O opens the app, W scrolls to the workflow, G opens the repository.
 */
export function LandingHotkeys() {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat || isTypingTarget(event.target)) return;

      switch (event.key.toLowerCase()) {
        case "o":
          event.preventDefault();
          router.push("/systems");
          break;
        case "w":
          event.preventDefault();
          document
            .getElementById("workflow")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        case "g":
          event.preventDefault();
          window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
