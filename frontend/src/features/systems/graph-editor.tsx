"use client";

import {
  ArrowRightIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/select";
import { GraphNodeCard } from "@/features/graph/graph-node-card";
import { graphNodeView, type GraphNodeView } from "@/features/graph/node-view";
import { graphLevels } from "@/features/graph/layout";
import {
  addGraphEdge,
  addGraphNode,
  removeGraphEdge,
  removeGraphNode,
  updateGraphNode,
  validateGraphDefinition,
  type EditableGraphDefinition,
  type EditableGraphNode,
} from "@/features/systems/graph-editor-model";
import { apiRequest } from "@/lib/api";

type HandlerCatalog = {
  deterministic: string[];
  llm: string[];
};

type EditorNodeData = {
  view: GraphNodeView;
  selected: boolean;
};

type EditorFlowNode = Node<EditorNodeData, "editorNode">;

const nodeTypes = { editorNode: EditorNodeCard };
const fallbackHandlers: HandlerCatalog = {
  deterministic: ["input", "output"],
  llm: ["llm_response"],
};

export function GraphEditor({
  definition,
  onChange,
  systemKey,
}: {
  definition: EditableGraphDefinition;
  onChange: (definition: EditableGraphDefinition) => void;
  systemKey?: string;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(
    definition.entry_point || definition.nodes[0]?.id || "",
  );
  const [handlerCatalog, setHandlerCatalog] =
    useState<HandlerCatalog>(fallbackHandlers);
  const [nodePositions, setNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const flowRef = useRef<ReactFlowInstance<EditorFlowNode> | null>(null);
  const topologyKey = `${definition.nodes.map((node) => node.id).join("|")}:${definition.edges
    .map((edge) => `${edge.source}>${edge.target}`)
    .join("|")}`;

  useEffect(() => {
    if (!systemKey) return;
    let active = true;
    void apiRequest<HandlerCatalog>(
      `/system-imports/handlers?system_key=${encodeURIComponent(systemKey)}`,
    )
      .then((catalog) => {
        if (!active) return;
        setHandlerCatalog({
          deterministic: catalog.deterministic.length
            ? catalog.deterministic
            : fallbackHandlers.deterministic,
          llm: catalog.llm.length ? catalog.llm : fallbackHandlers.llm,
        });
      })
      .catch(() => {
        // The source editor remains the escape hatch if catalog discovery fails.
      });
    return () => {
      active = false;
    };
  }, [systemKey]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.2, maxZoom: 0.95 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [topologyKey]);

  const issues = useMemo(
    () => validateGraphDefinition(definition),
    [definition],
  );
  const effectiveSelectedNodeId = definition.nodes.some(
    (node) => node.id === selectedNodeId,
  )
    ? selectedNodeId
    : definition.entry_point || definition.nodes[0]?.id || "";
  const flowNodes = useMemo(
    () =>
      buildEditorNodes(definition, effectiveSelectedNodeId).map((node) => ({
        ...node,
        position: nodePositions[node.id] ?? node.position,
      })),
    [definition, effectiveSelectedNodeId, nodePositions],
  );
  const selectedNode =
    definition.nodes.find((node) => node.id === effectiveSelectedNodeId) ??
    null;
  const edges = definition.edges.map((edge) => ({
    id: `${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
  }));

  function changeNode(nodeId: string, patch: Partial<EditableGraphNode>) {
    const nextId = patch.id ?? nodeId;
    if (nextId !== nodeId) setSelectedNodeId(nextId);
    onChange(updateGraphNode(definition, nodeId, patch));
  }

  function createNode(kind: EditableGraphNode["kind"]) {
    const handler = handlerCatalog[kind][0] ?? fallbackHandlers[kind][0];
    const added = addGraphNode(definition, kind, handler);
    setSelectedNodeId(added.nodeId);
    onChange(added.definition);
  }

  function connect({ source, target }: Connection) {
    if (!source || !target) return;
    onChange(addGraphEdge(definition, source, target));
  }

  return (
    <section aria-label="Graph editor" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Edit node"
            value={effectiveSelectedNodeId}
            onChange={(event) => setSelectedNodeId(event.target.value)}
          >
            {definition.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="app-button secondary"
            onClick={() => createNode("deterministic")}
          >
            <PlusIcon size={12} aria-hidden />
            Logic node
          </button>
          <button
            type="button"
            className="app-button secondary"
            onClick={() => createNode("llm")}
          >
            <PlusIcon size={12} aria-hidden />
            Model node
          </button>
        </div>
        <p className="text-[9px] text-[var(--text-faint)]">
          Drag nodes to arrange. Drag between handles to connect.
        </p>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="min-w-0 overflow-hidden border border-[var(--border-strong)] bg-[var(--canvas)]">
          <div className="h-[420px] min-w-0">
            <ReactFlow<EditorFlowNode>
              aria-label="Editable agent graph"
              nodes={flowNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes: NodeChange<EditorFlowNode>[]) => {
                const changed = applyNodeChanges(changes, flowNodes);
                setNodePositions(
                  Object.fromEntries(
                    changed.map((node) => [node.id, node.position]),
                  ),
                );
              }}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onConnect={connect}
              onInit={(instance) => {
                flowRef.current = instance;
              }}
              nodesDraggable
              nodesConnectable
              elementsSelectable
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.2, minZoom: 0.15, maxZoom: 0.95 }}
              minZoom={0.1}
              maxZoom={1.5}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1}
                color="var(--border-strong)"
              />
              <Controls
                showInteractive={false}
                fitViewOptions={{ padding: 0.2, maxZoom: 0.95 }}
                aria-label="Graph viewport controls"
                className="!overflow-hidden !rounded-[8px] !border-[var(--border-strong)] !bg-[var(--surface-raised)] !shadow-none"
              />
            </ReactFlow>
          </div>
        </div>

        <div className="min-w-0 border border-[var(--border-strong)] bg-[var(--surface)]">
          {selectedNode ? (
            <NodeInspector
              key={selectedNode.id}
              node={selectedNode}
              issues={issues.filter((issue) => {
                const index = definition.nodes.findIndex(
                  (candidate) => candidate.id === selectedNode.id,
                );
                return issue.path.startsWith(`nodes[${index}]`);
              })}
              handlers={handlerCatalog[selectedNode.kind]}
              canRemove={definition.nodes.length > 1}
              onChange={(patch) => changeNode(selectedNode.id, patch)}
              onRemove={() => {
                const next = removeGraphNode(definition, selectedNode.id);
                setSelectedNodeId(next.entry_point || next.nodes[0]?.id || "");
                onChange(next);
              }}
            />
          ) : (
            <p className="grid min-h-[180px] place-items-center px-4 text-center text-[11px] text-[var(--text-muted)]">
              Add a node to start the graph.
            </p>
          )}
        </div>
      </div>

      <GraphTopology definition={definition} onChange={onChange} />

      {issues.length ? (
        <div
          role="alert"
          className="flex items-start gap-2 border border-[color-mix(in_srgb,var(--danger)_48%,var(--border))] bg-[var(--danger-soft)] px-3 py-2.5 text-[10px] text-[var(--danger)]"
        >
          <WarningCircleIcon size={14} className="mt-px shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">
              Fix {issues.length} {issues.length === 1 ? "issue" : "issues"}{" "}
              before saving
            </p>
            <ul className="mt-1 grid gap-1 text-[var(--text-muted)]">
              {issues.map((issue) => (
                <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function NodeInspector({
  node,
  issues,
  handlers,
  canRemove,
  onChange,
  onRemove,
}: {
  node: EditableGraphNode;
  issues: Array<{ path: string; message: string }>;
  handlers: string[];
  canRemove: boolean;
  onChange: (patch: Partial<EditableGraphNode>) => void;
  onRemove: () => void;
}) {
  const [nodeId, setNodeId] = useState(node.id);
  const availableHandlers = [...new Set([...handlers, node.handler])].sort();
  const hasAdvancedConfiguration = Boolean(
    node.runtime_input_policy ||
    node.snapshot_policy ||
    node.resource_policy ||
    node.response_schema,
  );

  function commitNodeId() {
    const trimmed = nodeId.trim();
    if (trimmed && trimmed !== node.id) onChange({ id: trimmed });
    else setNodeId(node.id);
  }

  return (
    <section aria-label={`${node.label} editor`} className="min-w-0">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold">Node inspector</h3>
          <p className="mono mt-0.5 truncate text-[9px] text-[var(--text-faint)]">
            {node.id}
          </p>
        </div>
        <button
          type="button"
          className="app-button danger"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={`Remove ${node.label}`}
        >
          <TrashIcon size={12} aria-hidden />
          Remove
        </button>
      </header>
      <div className="grid gap-3 p-4">
        <EditorField label="Node ID" htmlFor="graph-node-id">
          <input
            id="graph-node-id"
            className="app-input mono"
            value={nodeId}
            onChange={(event) => setNodeId(event.target.value)}
            onBlur={commitNodeId}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setNodeId(node.id);
                event.currentTarget.blur();
              }
            }}
            spellCheck={false}
          />
        </EditorField>
        <EditorField label="Label" htmlFor="graph-node-label">
          <input
            id="graph-node-label"
            className="app-input"
            value={node.label}
            maxLength={120}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </EditorField>
        <EditorField label="Type" htmlFor="graph-node-kind">
          <Select
            id="graph-node-kind"
            value={node.kind}
            onChange={(event) => {
              const kind = event.target.value as EditableGraphNode["kind"];
              onChange({
                kind,
                handler:
                  (kind === "llm"
                    ? fallbackHandlers.llm[0]
                    : fallbackHandlers.deterministic[0]) ?? node.handler,
                ...(kind === "deterministic" ? { prompt_key: null } : {}),
              });
            }}
          >
            <option value="deterministic">Logic</option>
            <option value="llm">Model</option>
          </Select>
        </EditorField>
        <EditorField label="Handler" htmlFor="graph-node-handler">
          <Select
            id="graph-node-handler"
            value={node.handler}
            onChange={(event) => onChange({ handler: event.target.value })}
          >
            {availableHandlers.map((handler) => (
              <option key={handler} value={handler}>
                {handler}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[9px] text-[var(--text-faint)]">
            The backend checks that this handler is registered.
          </p>
        </EditorField>
        <EditorField label="Task" htmlFor="graph-node-task">
          <textarea
            id="graph-node-task"
            className="app-textarea min-h-[72px]"
            value={node.task ?? ""}
            maxLength={240}
            onChange={(event) => onChange({ task: event.target.value || null })}
          />
        </EditorField>
        {node.kind === "llm" ? (
          <EditorField label="Prompt" htmlFor="graph-node-prompt">
            <input
              id="graph-node-prompt"
              className="app-input mono"
              value={node.prompt_key ?? ""}
              onChange={(event) =>
                onChange({ prompt_key: event.target.value || null })
              }
              spellCheck={false}
            />
          </EditorField>
        ) : null}
        {hasAdvancedConfiguration ? (
          <p className="border-t border-[var(--border)] pt-3 text-[9px] leading-4 text-[var(--text-muted)]">
            Runtime, snapshot, resource, and response schema settings are
            preserved. Edit them in Source.
          </p>
        ) : null}
        {issues.length ? (
          <ul className="grid gap-1 text-[9px] text-[var(--danger)]">
            {issues.map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function GraphTopology({
  definition,
  onChange,
}: {
  definition: EditableGraphDefinition;
  onChange: (definition: EditableGraphDefinition) => void;
}) {
  const firstId = definition.nodes[0]?.id ?? "";
  const [source, setSource] = useState(firstId);
  const [target, setTarget] = useState(definition.nodes[1]?.id ?? firstId);
  const effectiveSource = definition.nodes.some((node) => node.id === source)
    ? source
    : firstId;
  const effectiveTarget = definition.nodes.some((node) => node.id === target)
    ? target
    : (definition.nodes[1]?.id ?? firstId);

  return (
    <div className="grid min-w-0 border border-[var(--border-strong)] bg-[var(--surface)] lg:grid-cols-[240px_240px_minmax(0,1fr)]">
      <TopologySelect
        label="Start"
        value={definition.entry_point}
        nodes={definition.nodes}
        disabled={!definition.nodes.length}
        onChange={(entry_point) => onChange({ ...definition, entry_point })}
      />
      <TopologySelect
        label="Result"
        value={definition.output_node}
        nodes={definition.nodes}
        disabled={!definition.nodes.length}
        onChange={(output_node) => onChange({ ...definition, output_node })}
      />
      <section
        aria-label="Edges"
        className="min-w-0 border-t border-[var(--border)] p-3 lg:border-l lg:border-t-0"
      >
        <div className="flex flex-wrap items-end gap-2">
          <TopologySelectControl
            label="From"
            value={effectiveSource}
            nodes={definition.nodes}
            onChange={setSource}
          />
          <ArrowRightIcon
            size={13}
            className="mb-2.5 text-[var(--text-faint)]"
            aria-hidden
          />
          <TopologySelectControl
            label="To"
            value={effectiveTarget}
            nodes={definition.nodes}
            onChange={setTarget}
          />
          <button
            type="button"
            className="app-button secondary"
            disabled={
              !effectiveSource ||
              !effectiveTarget ||
              effectiveSource === effectiveTarget
            }
            onClick={() =>
              onChange(
                addGraphEdge(definition, effectiveSource, effectiveTarget),
              )
            }
          >
            Add edge
          </button>
        </div>
        {definition.edges.length ? (
          <ul className="mt-3 grid gap-1.5">
            {definition.edges.map((edge) => (
              <li
                key={`${edge.source}-${edge.target}`}
                className="flex min-w-0 items-center justify-between gap-3 border-t border-[var(--border)] pt-1.5"
              >
                <span className="mono min-w-0 truncate text-[9px] text-[var(--text-muted)]">
                  {edge.source} → {edge.target}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-[4px] px-1.5 py-1 text-[9px] text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                  onClick={() =>
                    onChange(
                      removeGraphEdge(definition, edge.source, edge.target),
                    )
                  }
                  aria-label={`Remove edge ${edge.source} to ${edge.target}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[9px] text-[var(--text-faint)]">No edges.</p>
        )}
      </section>
    </div>
  );
}

function TopologySelect({
  label,
  value,
  nodes,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  nodes: EditableGraphNode[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `graph-${label.toLowerCase()}`;
  return (
    <div className="min-w-0 border-t border-[var(--border)] p-3 first:border-t-0 lg:border-t-0 lg:border-r">
      <EditorField label={label} htmlFor={id}>
        <Select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label}
            </option>
          ))}
        </Select>
      </EditorField>
    </div>
  );
}

function TopologySelectControl({
  label,
  value,
  nodes,
  onChange,
}: {
  label: string;
  value: string;
  nodes: EditableGraphNode[];
  onChange: (value: string) => void;
}) {
  const id = `graph-edge-${label.toLowerCase()}`;
  return (
    <div className="min-w-[120px] flex-1">
      <EditorField label={label} htmlFor={id}>
        <Select
          id={id}
          value={value}
          disabled={!nodes.length}
          onChange={(event) => onChange(event.target.value)}
        >
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label}
            </option>
          ))}
        </Select>
      </EditorField>
    </div>
  );
}

function EditorField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[9px] font-medium text-[var(--text-muted)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function buildEditorNodes(
  definition: EditableGraphDefinition,
  selectedNodeId: string,
): EditorFlowNode[] {
  const levels = graphLevels(definition.nodes, definition.edges);
  const levelCounts = new Map<number, number>();
  return definition.nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const index = levelCounts.get(level) ?? 0;
    levelCounts.set(level, index + 1);
    const view = graphNodeView(node, {
      entry: node.id === definition.entry_point,
      output: node.id === definition.output_node,
    });
    return {
      id: node.id,
      type: "editorNode",
      position: { x: level * 286, y: index * 172 },
      initialWidth: 216,
      initialHeight: 100,
      ariaLabel: `${view.ariaLabel}. Select to edit.`,
      data: { view, selected: node.id === selectedNodeId },
    };
  });
}

function EditorNodeCard({ data }: NodeProps<EditorFlowNode>) {
  return (
    <GraphNodeCard view={data.view} selected={data.selected} width={212} />
  );
}
