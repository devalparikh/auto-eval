"use client";

import {
  ArrowRightIcon,
  BracketsCurlyIcon,
  CloudArrowDownIcon,
  DatabaseIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { graphLevels } from "@/features/traces/graph-layout";
import type {
  GraphDefinition,
  GraphNodeDefinition,
  NodeResourceSelection,
} from "@/lib/types";

export type RunNodeClassification =
  | "calculation"
  | "saved input: latest"
  | "live external input"
  | "saved input: exact version"
  | "model call";

export function classifyRunNode(
  node: GraphNodeDefinition,
  resourceSelection?: NodeResourceSelection,
): RunNodeClassification {
  if (node.kind === "llm") return "model call";
  if (node.resource_policy) {
    const mode = resourceSelection?.mode ?? node.resource_policy.runtime_mode;
    return mode === "locked"
      ? "saved input: exact version"
      : "saved input: latest";
  }
  if (node.runtime_input_policy) {
    return node.runtime_input_policy.runtime_mode === "locked"
      ? "saved input: exact version"
      : "live external input";
  }
  if (node.snapshot_policy?.binding_mode === "consume") {
    return "saved input: exact version";
  }
  return "calculation";
}

export function RunGraphPreview({
  definition,
  resourceSelections,
  captureNodeOutputs,
}: {
  definition: GraphDefinition;
  resourceSelections: Record<string, NodeResourceSelection>;
  captureNodeOutputs: boolean;
}) {
  const levels = graphLevels(definition.nodes, definition.edges);
  const levelGroups = [...new Set(levels.values())]
    .sort((left, right) => left - right)
    .map((level) => ({
      level,
      nodes: definition.nodes.filter((node) => levels.get(node.id) === level),
    }));

  return (
    <div
      className="overflow-x-auto border border-[var(--border)] bg-[var(--canvas)] p-3"
      aria-label="Selected graph execution preview"
    >
      <div className="flex min-w-max items-center gap-3">
        {levelGroups.map((group, index) => (
          <div key={group.level} className="flex items-center gap-3">
            <ol
              className="grid w-[214px] gap-2"
              aria-label={`Graph stage ${index + 1}`}
            >
              {group.nodes.map((node) => (
                <li key={node.id}>
                  <RunPreviewNode
                    node={node}
                    selection={resourceSelections[node.id]}
                    captureNodeOutputs={captureNodeOutputs}
                    entry={node.id === definition.entry_point}
                    output={node.id === definition.output_node}
                    targets={definition.edges
                      .filter((edge) => edge.source === node.id)
                      .map((edge) => edge.target)}
                  />
                </li>
              ))}
            </ol>
            {index < levelGroups.length - 1 ? (
              <ArrowRightIcon
                aria-hidden="true"
                size={13}
                className="shrink-0 text-[var(--text-faint)]"
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunPreviewNode({
  node,
  selection,
  captureNodeOutputs,
  entry,
  output,
  targets,
}: {
  node: GraphNodeDefinition;
  selection?: NodeResourceSelection;
  captureNodeOutputs: boolean;
  entry: boolean;
  output: boolean;
  targets: string[];
}) {
  const classification = classifyRunNode(node, selection);
  const requiredCapture =
    node.snapshot_policy?.required &&
    node.snapshot_policy.binding_mode === "produce";
  const optionalRefresh =
    node.runtime_input_policy?.runtime_mode === "refresh" &&
    node.snapshot_policy?.binding_mode !== "consume" &&
    !node.snapshot_policy?.required;
  return (
    <article className="min-h-[106px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3">
      <div className="flex items-start gap-2">
        <span className="grid size-7 shrink-0 place-items-center border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--accent)]">
          {iconForClassification(classification)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-semibold">
            {node.label}
          </span>
          <span className="mono mt-1 block text-[8px] leading-4 text-[var(--text-muted)]">
            {classification}
          </span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 border-t border-[var(--border)] pt-2">
        {entry ? <PreviewTag>entry</PreviewTag> : null}
        {output ? <PreviewTag>output</PreviewTag> : null}
        {selection?.mode === "current" ? (
          <PreviewTag>Latest: {selection.identity}</PreviewTag>
        ) : null}
        {selection?.mode === "locked" ? (
          <PreviewTag>Exact saved version</PreviewTag>
        ) : null}
        {node.runtime_input_policy?.runtime_mode === "refresh" ? (
          <PreviewTag>run refresh</PreviewTag>
        ) : null}
        {requiredCapture ? <PreviewTag>required capture</PreviewTag> : null}
        {optionalRefresh ? (
          <PreviewTag>
            {captureNodeOutputs
              ? "Save refreshed output"
              : "Live output: not saved"}
          </PreviewTag>
        ) : null}
        {targets.length ? (
          <PreviewTag>Next: {targets.join(", ")}</PreviewTag>
        ) : null}
      </div>
    </article>
  );
}

function iconForClassification(classification: RunNodeClassification) {
  const properties = { size: 14, weight: "bold" as const, "aria-hidden": true };
  if (classification === "model call") return <WaveformIcon {...properties} />;
  if (
    classification === "saved input: exact version" ||
    classification === "saved input: latest"
  ) {
    return <DatabaseIcon {...properties} />;
  }
  if (classification === "live external input") {
    return <CloudArrowDownIcon {...properties} />;
  }
  return <BracketsCurlyIcon {...properties} />;
}

function PreviewTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono bg-[var(--accent-soft)] px-1.5 py-1 text-[8px] text-[var(--accent)]">
      {children}
    </span>
  );
}
