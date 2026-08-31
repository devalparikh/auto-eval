"use client";

import { Handle, Position, useStore } from "@xyflow/react";
import type { ReactNode } from "react";
import { GraphNodeIcon, graphNodeIsFilled } from "@/features/graph/node-icon";
import {
  graphNodeTypeHint,
  graphNodeTypeLabel,
  graphNodeTypes,
  type GraphNodeType,
  type GraphNodeView,
} from "@/features/graph/node-view";

/**
 * Below this zoom a card is a map pin, not something to read: the detail lines
 * are illegible either way, and the label survives only because it is drawn
 * larger to compensate for the canvas scaling it back down.
 */
const overviewZoom = 0.78;

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
  const accent = `var(--node-${view.type})`;
  const zoom = useStore((state) => state.transform[2]);
  const overview = zoom < overviewZoom;
  // Cancel out the canvas scale so the label reads the same at any zoom.
  const scale = (size: number, cap: number) =>
    overview ? Math.min(cap, size / Math.max(zoom, 0.2)) : size;
  const labelSize = scale(12, 20);
  const badgeSize = scale(8, 13);
  return (
    <div
      style={{
        width,
        background: `var(--node-${view.type}-soft)`,
        borderColor: `var(--node-${view.type}-line)`,
      }}
      className={`relative rounded-[2px] border p-3 transition-shadow duration-150 ${
        selected
          ? "shadow-[0_0_0_2px_var(--focus),0_18px_45px_rgba(0,0,0,0.3)]"
          : "shadow-[0_14px_40px_rgba(0,0,0,0.22)]"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-[var(--border-strong)]"
      />
      <div className="flex items-start gap-2">
        <GraphNodeIcon type={view.type} />
        <span className="min-w-0 flex-1">
          <span
            style={{ fontSize: `${labelSize}px` }}
            className="block truncate leading-tight font-semibold"
          >
            {view.label}
          </span>
          {overview ? null : (
            <span
              style={{ color: accent }}
              className="mono mt-0.5 block truncate text-[8px] tracking-[0.04em]"
            >
              {view.typeLabel}
            </span>
          )}
        </span>
      </div>
      {overview ? null : (
        <p className="mono mt-2 truncate text-[8px] text-[var(--text-faint)]">
          {view.summary}
        </p>
      )}
      {view.badges.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {view.badges.map((badge) => (
            <span
              key={badge}
              style={{ fontSize: `${badgeSize}px` }}
              className="border border-[var(--border)] px-1.5 py-0.5 leading-tight text-[var(--text-muted)]"
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
            style={
              graphNodeIsFilled(type)
                ? { background: `var(--node-${type})` }
                : {
                    background: `var(--node-${type}-soft)`,
                    borderColor: `var(--node-${type}-line)`,
                  }
            }
            className={`size-2.5 rounded-[1px] ${
              graphNodeIsFilled(type) ? "" : "border"
            }`}
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
