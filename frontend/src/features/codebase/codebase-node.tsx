"use client";

import {
  CubeIcon,
  FileCodeIcon,
  FlowArrowIcon,
  FolderIcon,
  FunctionIcon,
  StackIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CodebaseFlowNodeData } from "@/features/codebase/codebase-layout";

const nodeIcons = {
  area: TreeStructureIcon,
  module: FolderIcon,
  file: FileCodeIcon,
  symbol: FunctionIcon,
  system: StackIcon,
  domain: FolderIcon,
  capability: FlowArrowIcon,
  component: CubeIcon,
};

export function CodebaseMapNode({
  data,
}: NodeProps<Node<CodebaseFlowNodeData>>) {
  const Icon = nodeIcons[data.kind];
  return (
    <div
      className={`codebase-node codebase-node-${data.kind} change-${data.status} ${
        data.selected ? "is-selected" : ""
      } ${data.focused ? "is-focused" : ""} ${
        data.entering ? "is-entering" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="codebase-handle"
      />
      <div className="codebase-node-heading">
        <span className="codebase-node-icon" aria-hidden="true">
          <Icon size={data.detail_level === 3 ? 12 : 14} weight="bold" />
        </span>
        <span className="codebase-node-copy">
          <strong title={data.label}>{data.label}</strong>
          <span>{nodeDescriptor(data)}</span>
        </span>
      </div>
      {data.detail_level !== 3 ? (
        <div className="codebase-node-meta">
          <span>
            {data.childCount
              ? `${data.childCount} contained`
              : (data.language ?? "root")}
          </span>
          <ChangeCount additions={data.additions} deletions={data.deletions} />
        </div>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="codebase-handle"
      />
    </div>
  );
}

function ChangeCount({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (!additions && !deletions) return <span>stable</span>;
  return (
    <span
      className="codebase-change-count"
      aria-label={`${additions} additions, ${deletions} deletions`}
    >
      <span>+{additions}</span>
      <span>-{deletions}</span>
    </span>
  );
}

function nodeDescriptor(data: CodebaseFlowNodeData): string {
  if (data.description) return data.description;
  if (data.kind === "symbol") {
    return `${data.symbol_kind ?? "symbol"} / line ${data.line ?? "?"}`;
  }
  if (data.kind === "file")
    return `${data.language ?? "source"} / ${data.lines} lines`;
  return data.path;
}
