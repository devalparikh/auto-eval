"use client";

import {
  BracketsCurlyIcon,
  BrainIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { GraphNodeType } from "@/features/graph/node-view";

const icons: Record<GraphNodeType, Icon> = {
  model: BrainIcon,
  live: CloudArrowDownIcon,
  saved: DatabaseIcon,
  logic: BracketsCurlyIcon,
};

/**
 * Model calls and live fetches spend money or reach outside the app, so they
 * carry a filled chip; nodes that only move data already at hand stay quiet.
 */
const filled: Record<GraphNodeType, boolean> = {
  model: true,
  live: true,
  saved: false,
  logic: false,
};

export function graphNodeIcon(type: GraphNodeType): Icon {
  return icons[type];
}

export function graphNodeIsFilled(type: GraphNodeType): boolean {
  return filled[type];
}

/** The node's icon chip, identical on a graph card and in the details panel. */
export function GraphNodeIcon({ type }: { type: GraphNodeType }) {
  const Icon = icons[type];
  return (
    <span
      style={
        filled[type]
          ? { background: `var(--node-${type})`, color: "var(--accent-ink)" }
          : {
              background: "var(--surface-raised)",
              borderColor: `var(--node-${type}-line)`,
              color: `var(--node-${type})`,
            }
      }
      className={`grid size-7 shrink-0 place-items-center rounded-[2px] ${
        filled[type] ? "" : "border"
      }`}
    >
      <Icon size={14} weight="bold" aria-hidden />
    </span>
  );
}
