"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useCallback, useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { formatCost, formatDuration } from "@/lib/format";
import type { TraceSpan } from "@/lib/types";

export function TraceInspector({ span }: { span: TraceSpan | null }) {
  const [copied, setCopied] = useState(false);
  const copyOutput = useCallback(async () => {
    if (!span?.output) return;
    await navigator.clipboard.writeText(JSON.stringify(span.output, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [span]);

  if (!span) {
    return (
      <div className="grid min-h-[360px] place-items-center text-[12px] text-[var(--text-muted)]">
        Select a node
      </div>
    );
  }

  return (
    <aside className="min-w-0 bg-[var(--surface)]">
      <div className="flex h-11 items-center justify-between border-b border-[var(--border)] px-4">
        <h2 className="truncate text-[12px] font-semibold">
          {span.node_id.replaceAll("_", " ")}
        </h2>
        <StatusBadge status={span.status} />
      </div>
      <div className="grid grid-cols-3 border-b border-[var(--border)]">
        <InspectorMetric
          label="Latency"
          value={formatDuration(span.latency_ms)}
        />
        <InspectorMetric label="Cost" value={formatCost(span.cost_usd)} />
        <InspectorMetric
          label="Tokens"
          value={`${span.input_tokens + span.output_tokens}`}
        />
      </div>
      <InspectorSection label="Input">
        <JsonBlock value={span.input} />
      </InspectorSection>
      {span.system_prompt ? (
        <InspectorSection label="System prompt">
          <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--text-muted)]">
            {span.system_prompt}
          </p>
        </InspectorSection>
      ) : null}
      <InspectorSection
        label="Output"
        action={
          <button
            onClick={copyOutput}
            className="flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        }
      >
        <JsonBlock value={span.output ?? {}} />
      </InspectorSection>
    </aside>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-[var(--border)] px-3 py-3 last:border-r-0">
      <p className="text-[9px] text-[var(--text-faint)]">{label}</p>
      <p className="mono mt-1 text-[11px] font-semibold">{value}</p>
    </div>
  );
}

function InspectorSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--border)] p-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold text-[var(--text-muted)]">
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="mono max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-[2px] border border-[var(--border)] bg-[var(--canvas)] p-3 text-[10px] leading-5 text-[var(--text-muted)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
