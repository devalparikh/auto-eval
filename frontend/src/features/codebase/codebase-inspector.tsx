"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import type {
  CodebaseEdge,
  CodebaseGraph,
  CodebaseNode,
} from "@/lib/types";

export function CodebaseInspector({
  graph,
  node,
  onSelect,
}: {
  graph: CodebaseGraph;
  node: CodebaseNode;
  onSelect: (nodeId: string) => void;
}) {
  const nodesById = new Map(graph.nodes.map((item) => [item.id, item]));
  const parent = node.parent_id ? nodesById.get(node.parent_id) : null;
  const children = graph.nodes.filter((item) => item.parent_id === node.id);
  const outgoing = relatedNodes(graph, node.id, "outgoing", nodesById);
  const incoming = relatedNodes(graph, node.id, "incoming", nodesById);

  return (
    <aside
      className="codebase-inspector"
      aria-label="Selected component details"
    >
      <header className={`codebase-inspector-header change-${node.status}`}>
        <span className="mono">{node.kind}</span>
        <h2>{node.label}</h2>
        {node.description ? (
          <p className="codebase-inspector-description">{node.description}</p>
        ) : null}
        <p>{node.path}</p>
      </header>

      <dl className="codebase-inspector-stats">
        <Stat label="State" value={node.status} />
        <Stat label="Lines" value={node.lines ? String(node.lines) : "-"} />
        <Stat label="Added" value={`+${node.additions}`} tone="added" />
        <Stat label="Removed" value={`-${node.deletions}`} tone="removed" />
      </dl>

      {node.before_path ? (
        <InspectorSection title="Previous path">
          <p className="codebase-inspector-path mono">{node.before_path}</p>
        </InspectorSection>
      ) : null}

      {node.responsibilities.length ? (
        <InspectorSection title="Responsibilities">
          <ul className="codebase-inspector-points">
            {node.responsibilities.map((responsibility) => (
              <li key={responsibility}>{responsibility}</li>
            ))}
          </ul>
        </InspectorSection>
      ) : null}

      {node.source_paths.length ? (
        <InspectorSection title="Source ownership">
          <div className="codebase-inspector-paths mono">
            {node.source_paths.map((path) => (
              <p key={path}>{path}</p>
            ))}
          </div>
        </InspectorSection>
      ) : null}

      {parent ? (
        <InspectorSection title="Contained by">
          <NodeLink node={parent} onSelect={onSelect} />
        </InspectorSection>
      ) : null}

      {children.length ? (
        <InspectorSection title={childSectionTitle(node, children.length)}>
          <NodeList nodes={children} onSelect={onSelect} />
        </InspectorSection>
      ) : null}

      {outgoing.length ? (
        <InspectorSection title={graph.mode === "logic" ? "Relationships" : "Imports"}>
          <RelationList relations={outgoing} onSelect={onSelect} />
        </InspectorSection>
      ) : null}

      {incoming.length ? (
        <InspectorSection title={graph.mode === "logic" ? "Referenced by" : "Imported by"}>
          <RelationList relations={incoming} onSelect={onSelect} />
        </InspectorSection>
      ) : null}
    </aside>
  );
}

function RelationList({
  relations,
  onSelect,
}: {
  relations: RelatedNode[];
  onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="codebase-inspector-list">
      {relations.slice(0, 12).map(({ node, edge }) => (
        <button
          key={`${edge.id}:${node.id}`}
          type="button"
          className="data-row"
          onClick={() => onSelect(node.id)}
        >
          <span>
            <strong>{node.label}</strong>
            <small>
              {edge.kind.replace("_", " ")}
              {edge.label ? ` · ${edge.label}` : ""}
            </small>
          </span>
          <ArrowRightIcon
            className="data-row-affordance"
            size={12}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="codebase-inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function NodeList({
  nodes,
  onSelect,
}: {
  nodes: CodebaseNode[];
  onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="codebase-inspector-list">
      {nodes.slice(0, 12).map((node) => (
        <NodeLink key={node.id} node={node} onSelect={onSelect} />
      ))}
      {nodes.length > 12 ? (
        <p className="mono">+{nodes.length - 12} more</p>
      ) : null}
    </div>
  );
}

function NodeLink({
  node,
  onSelect,
}: {
  node: CodebaseNode;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      className="data-row"
      onClick={() => onSelect(node.id)}
    >
      <span>
        <strong>{node.label}</strong>
        <small>{node.kind}</small>
      </span>
      <ArrowRightIcon
        className="data-row-affordance"
        size={12}
        aria-hidden="true"
      />
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "added" | "removed";
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone ? `change-text-${tone}` : undefined}>{value}</dd>
    </div>
  );
}

function relatedNodes(
  graph: CodebaseGraph,
  nodeId: string,
  direction: "incoming" | "outgoing",
  nodesById: Map<string, CodebaseNode>,
): RelatedNode[] {
  return graph.edges
    .filter(
      (edge) =>
        edge.kind !== "contains" &&
        (direction === "outgoing"
          ? edge.source === nodeId
          : edge.target === nodeId),
    )
    .flatMap((edge) => {
    const id = direction === "outgoing" ? edge.target : edge.source;
    const related = nodesById.get(id);
    return related ? [{ node: related, edge }] : [];
  });
}

type RelatedNode = { node: CodebaseNode; edge: CodebaseEdge };

function childSectionTitle(node: CodebaseNode, count: number): string {
  if (node.kind === "system") return `${count} domains`;
  if (node.kind === "domain") return `${count} capabilities`;
  if (node.kind === "capability") return `${count} components`;
  if (node.kind === "file") return `${count} symbols`;
  if (node.kind === "module") return `${count} files`;
  return `${count} modules`;
}
