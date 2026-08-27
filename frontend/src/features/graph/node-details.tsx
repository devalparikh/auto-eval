"use client";

import {
  BracketsCurlyIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { GraphNodeView } from "@/features/graph/node-view";

const icons = {
  model: WaveformIcon,
  live: CloudArrowDownIcon,
  saved: DatabaseIcon,
  logic: BracketsCurlyIcon,
} as const;

/**
 * The panel shown when a node on any graph is clicked. Screens add their own
 * sections as children; the identity, facts, and data rows stay identical.
 */
export function GraphNodeDetails({
  view,
  action,
  children,
}: {
  view: GraphNodeView;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const Icon = icons[view.type];
  const accent = `var(--node-${view.type})`;
  const dataRows = [
    { label: "Reads", value: view.dataFlow.reads },
    { label: "Saves", value: view.dataFlow.writes },
    { label: "On a run", value: view.dataFlow.onRun },
    { label: "In an evaluation", value: view.dataFlow.onEvaluation },
  ].filter((row): row is { label: string; value: string } =>
    Boolean(row.value),
  );

  return (
    <section
      aria-label={`${view.label} details`}
      className="min-w-0 bg-[var(--surface)]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            style={{ background: `var(--node-${view.type}-soft)`, color: accent }}
            className="grid size-7 shrink-0 place-items-center rounded-[2px]"
          >
            <Icon size={14} weight="bold" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[12px] font-semibold">{view.label}</h3>
            <p style={{ color: accent }} className="mono mt-0.5 text-[9px]">
              {view.typeLabel}
            </p>
          </div>
        </div>
        {action}
      </header>
      <dl className="grid grid-cols-2 border-b border-[var(--border)] md:grid-cols-3">
        {view.facts.map((fact) => (
          <div
            key={`${fact.label}-${fact.value}`}
            className="min-w-0 border-r border-b border-[var(--border)] px-3 py-2.5 last:border-r-0"
          >
            <dt className="text-[9px] text-[var(--text-faint)]">
              {fact.label}
            </dt>
            <dd
              className="mono mt-1 truncate text-[10px] font-medium"
              title={fact.value}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      {dataRows.length ? (
        <dl className="border-b border-[var(--border)] px-4 py-3">
          {dataRows.map((row) => (
            <div key={row.label} className="flex gap-3 py-1">
              <dt className="w-[104px] shrink-0 text-[10px] text-[var(--text-faint)]">
                {row.label}
              </dt>
              <dd className="min-w-0 text-[10px] leading-5 text-[var(--text-muted)]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </section>
  );
}

export function GraphNodeDetailsEmpty({
  message = "Select a node to see what it does.",
}: {
  message?: string;
}) {
  return (
    <div className="grid min-h-[120px] place-items-center px-4 text-center text-[11px] text-[var(--text-muted)]">
      {message}
    </div>
  );
}
