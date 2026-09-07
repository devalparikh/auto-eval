"use client";

import {
  BracketsCurlyIcon,
  CheckIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import {
  graphNodeTypeHint,
  graphNodeTypeLabel,
  graphNodeTypes,
  type GraphNodeType,
  type GraphNodeView,
} from "@/features/graph/node-view";

const icons = {
  model: WaveformIcon,
  live: CloudArrowDownIcon,
  saved: DatabaseIcon,
  logic: BracketsCurlyIcon,
} as const;

/**
 * The node card every graph screen draws. Colour, icon, and badge wording come
 * from the node view, so the same node looks the same wherever it appears.
 */
export function GraphNodeCard({
  view,
  selected = false,
  width = 212,
  footer,
}: {
  view: GraphNodeView;
  selected?: boolean;
  width?: number;
  footer?: ReactNode;
}) {
  const Icon = icons[view.type];
  const accent = `var(--node-${view.type})`;
  const soft = `var(--node-${view.type}-soft)`;
  return (
    <div
      data-selected={selected}
      style={{
        width,
        background: `color-mix(in srgb, var(--surface-raised) 94%, ${accent})`,
        borderColor: selected
          ? "var(--accent)"
          : `color-mix(in srgb, var(--border-strong) 78%, ${accent})`,
      }}
      className="graph-node-card relative rounded-[8px] border p-3 shadow-[0_14px_40px_rgba(0,0,0,0.22)]"
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
      <div className="flex items-start gap-2">
        <span
          style={{ background: soft, color: accent }}
          className="grid size-7 shrink-0 place-items-center rounded-[8px]"
        >
          <Icon size={14} weight="bold" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[12px] font-semibold"
            title={view.label}
          >
            {view.label}
          </span>
          <span
            style={{ color: accent }}
            className="mono mt-0.5 inline-flex max-w-full items-center rounded-[4px] border border-[var(--border)] px-1.5 py-0 text-[8px] font-medium leading-[10px] tracking-[0.04em]"
          >
            {view.typeLabel}
          </span>
        </span>
      </div>
      <p className="mono mt-2 truncate text-[8px] text-[var(--text-faint)]">
        {view.summary}
      </p>
      {view.badges.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {view.badges.map((badge) => (
            <span
              key={badge}
              className="rounded-[4px] border border-[var(--border)] px-1.5 py-0.5 text-[8px] text-[var(--text-muted)]"
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}
      {footer ? (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          {footer}
        </div>
      ) : null}
      {selected ? (
        <span
          aria-hidden
          style={{ color: accent }}
          className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[0_2px_8px_rgba(0,0,0,0.22)]"
        >
          <CheckIcon size={9} weight="bold" />
        </span>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
    </div>
  );
}

/** Colour key for the node types present in the graph on screen. */
export function GraphLegend({ types }: { types: GraphNodeType[] }) {
  const present = graphNodeTypes.filter((type) => types.includes(type));
  if (!present.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {present.map((type) => (
        <li key={type} className="flex items-center gap-1.5">
          <span
            aria-hidden
            style={{ background: `var(--node-${type})` }}
            className="size-2 rounded-[3px]"
          />
          <span className="text-[10px] font-medium">
            {graphNodeTypeLabel(type)}
          </span>
          <span className="text-[10px] text-[var(--text-faint)]">
            {graphNodeTypeHint(type)}
          </span>
        </li>
      ))}
    </ul>
  );
}
