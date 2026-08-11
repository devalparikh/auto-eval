"use client";

import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/states";
import { CodebaseControls } from "@/features/codebase/codebase-controls";
import { CodebaseInspector } from "@/features/codebase/codebase-inspector";
import { CodebaseMap } from "@/features/codebase/codebase-map";
import { api } from "@/lib/api";
import type { CodebaseMode, CodebaseSource } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

type ComparisonQuery = {
  mode: CodebaseMode;
  source: CodebaseSource;
  ref: string;
};

export function CodebaseScreen() {
  const revisions = useApiResource(api.codebaseRevisions);
  const [mode, setMode] = useState<CodebaseMode>("files");
  const [draftSource, setDraftSource] = useState<CodebaseSource>("working");
  const [draftRef, setDraftRef] = useState("");
  const [query, setQuery] = useState<ComparisonQuery>({
    mode: "files",
    source: "working",
    ref: "",
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const graph = useApiResource(
    () => api.codebaseGraph(query.mode, query.source, query.ref || undefined),
    [query.mode, query.source, query.ref],
  );

  const defaultCommit = revisions.data?.commits[0]?.oid ?? "";
  const effectiveRef =
    draftSource === "commit" ? draftRef || defaultCommit : draftRef;
  const fallbackNode =
    graph.data?.nodes.find(
      (node) => node.detail_level === 0 && node.status !== "unchanged",
    ) ?? graph.data?.nodes.find((node) => node.detail_level === 0);
  const selectedNode =
    graph.data?.nodes.find((node) => node.id === selectedNodeId) ??
    fallbackNode;

  function changeSource(source: CodebaseSource) {
    setDraftSource(source);
    if (source === "commit") {
      setDraftRef(defaultCommit);
      return;
    }
    if (source === "pr") {
      setDraftRef("");
      return;
    }
    setDraftRef("");
    setQuery({ mode, source, ref: "" });
    setSelectedNodeId(null);
  }

  function applyComparison() {
    setDraftRef(effectiveRef);
    setQuery({ mode, source: draftSource, ref: effectiveRef });
    setSelectedNodeId(null);
  }

  function changeMode(nextMode: CodebaseMode) {
    setMode(nextMode);
    setQuery((current) => ({ ...current, mode: nextMode }));
    setSelectedNodeId(null);
  }

  return (
    <div className="codebase-page">
      <header className="codebase-page-header">
        <div>
          <p className="page-header-kicker">AutoEval / repository</p>
          <h1>Code map</h1>
          <p>
            {mode === "files"
              ? "Explore exact repository structure from areas to symbols."
              : "Explore agent-maintained systems, capabilities, and relationships."}{" "}
            Git changes stay in place.
          </p>
        </div>
        {revisions.data ? (
          <div className="codebase-repository-meta">
            <strong>{revisions.data.repository.name}</strong>
            <span className="mono">
              {revisions.data.repository.branch} /{" "}
              {revisions.data.repository.short_head}
            </span>
          </div>
        ) : null}
      </header>

      <CodebaseControls
        mode={mode}
        source={draftSource}
        comparisonRef={effectiveRef}
        commits={revisions.data?.commits ?? []}
        pullRequestsAvailable={revisions.data?.pull_requests_available ?? true}
        loading={graph.loading}
        onModeChange={changeMode}
        onSourceChange={changeSource}
        onRefChange={setDraftRef}
        onApply={applyComparison}
        onRefresh={() => void graph.reload()}
      />

      <div className="codebase-summary" aria-live="polite">
        {graph.data ? (
          <>
            <strong>{graph.data.comparison.label}</strong>
            {graph.data.mode === "logic" ? (
              <>
                <span>{graph.data.summary.areas} systems</span>
                <span>{graph.data.summary.modules} domains</span>
                <span>{graph.data.summary.files} capabilities</span>
                <span>{graph.data.summary.symbols} components</span>
                <span className="codebase-model-source">
                  agent-maintained · {graph.data.model_path}
                </span>
              </>
            ) : (
              <>
                <span>{graph.data.summary.files} files</span>
                <span>{graph.data.summary.symbols} symbols</span>
              </>
            )}
            <span>{graph.data.summary.changed_files} changed</span>
            <span className="change-text-added">
              +{graph.data.summary.additions}
            </span>
            <span className="change-text-removed">
              -{graph.data.summary.deletions}
            </span>
            {graph.data.summary.truncated ? (
              <span>display limit reached</span>
            ) : null}
          </>
        ) : (
          <span>Reading repository structure</span>
        )}
      </div>

      <div className="codebase-workspace">
        <div className="codebase-canvas-region">
          {graph.data ? (
            <CodebaseMap
              key={`${graph.data.repository.root}:${graph.data.mode}`}
              graph={graph.data}
              selectedNodeId={selectedNode?.id ?? null}
              onSelect={setSelectedNodeId}
            />
          ) : graph.error ? (
            <ErrorState
              message={graph.error}
              retry={() => void graph.reload()}
            />
          ) : (
            <LoadingState rows={7} />
          )}
          {graph.loading && graph.data ? (
            <div className="codebase-scanning mono">updating graph</div>
          ) : null}
        </div>
        {graph.data && selectedNode ? (
          <CodebaseInspector
            graph={graph.data}
            node={selectedNode}
            onSelect={setSelectedNodeId}
          />
        ) : null}
      </div>

      {revisions.error ? (
        <div className="codebase-revisions-error mono">
          Revision list: {revisions.error}
        </div>
      ) : null}
    </div>
  );
}
