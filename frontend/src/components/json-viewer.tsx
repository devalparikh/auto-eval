"use client";

import { CaretRightIcon } from "@phosphor-icons/react";
import { useRef } from "react";

export function JsonViewer({
  value,
  label = "Graph definition",
}: {
  value: unknown;
  label?: string;
}) {
  const treeRef = useRef<HTMLDivElement>(null);

  function setAllExpanded(open: boolean) {
    treeRef.current?.querySelectorAll("details").forEach((branch) => {
      branch.open = open;
    });
  }

  return (
    <div className="json-viewer">
      <div className="json-viewer-toolbar">
        <span>Structured JSON</span>
        <div className="json-viewer-actions" aria-label="JSON tree controls">
          <button type="button" onClick={() => setAllExpanded(true)}>
            Expand
          </button>
          <button type="button" onClick={() => setAllExpanded(false)}>
            Collapse
          </button>
        </div>
      </div>
      <div ref={treeRef} className="json-tree">
        <JsonBranch label={label} value={value} depth={0} />
      </div>
    </div>
  );
}

function JsonBranch({
  label,
  value,
  depth,
}: {
  label: string;
  value: unknown;
  depth: number;
}) {
  const array = Array.isArray(value);
  const entries = Object.entries(value as Record<string, unknown>);
  const countLabel = `${entries.length} ${array ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"}`;

  return (
    <details className="json-branch" open={depth < 2}>
      <summary>
        <CaretRightIcon
          className="json-disclosure-icon"
          size={12}
          weight="bold"
          aria-hidden="true"
        />
        <span className="json-key">{label}</span>
        <span className="json-count">{countLabel}</span>
      </summary>
      <div className="json-children">
        {entries.map(([key, child]) =>
          isJsonBranch(child) ? (
            <JsonBranch
              key={key}
              label={array ? `[${key}]` : key}
              value={child}
              depth={depth + 1}
            />
          ) : (
            <JsonLeaf
              key={key}
              label={array ? `[${key}]` : key}
              value={child}
            />
          ),
        )}
      </div>
    </details>
  );
}

function JsonLeaf({ label, value }: { label: string; value: unknown }) {
  const type = value === null ? "null" : typeof value;
  const rendered = type === "string" ? JSON.stringify(value) : String(value);

  return (
    <div className="json-leaf">
      <span className="json-key">{label}</span>
      <span aria-hidden="true" className="json-separator">
        :
      </span>
      <span className="json-value" data-type={type}>
        {rendered}
      </span>
    </div>
  );
}

function isJsonBranch(
  value: unknown,
): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}
