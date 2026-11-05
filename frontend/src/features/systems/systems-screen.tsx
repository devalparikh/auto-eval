"use client";

import { DatabaseIcon, GitBranchIcon, TextTIcon } from "@phosphor-icons/react";
import { useState } from "react";
import Link from "next/link";
import { CatalogGate } from "@/components/catalog-gate";
import { HoverGlide } from "@/components/hover-glide";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { graphPromptAssociations } from "@/features/systems/graph-prompts";
import { NodeSnapshotBrowser } from "@/features/systems/node-snapshot-browser";
import { VersionEditor } from "@/features/systems/version-editor";
import { api } from "@/lib/api";
import { countOf } from "@/lib/format";
import type { AgentSystemSummary, Catalog } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";
import { useCatalog } from "@/lib/use-catalog";

type ArtifactKind = "graph" | "prompt" | "snapshot";

export function SystemsScreen({
  systemKey,
  initialSnapshotId,
  initialGraphVersionId,
  initialPromptVersionId,
}: {
  systemKey: string;
  initialSnapshotId?: string;
  initialGraphVersionId?: string;
  initialPromptVersionId?: string;
}) {
  return (
    <CatalogGate systemKey={systemKey}>
      {({ catalog, system }) => (
        <SystemsWorkbench
          key={`${system.id}:${initialGraphVersionId ?? ""}:${initialPromptVersionId ?? ""}`}
          catalog={catalog}
          system={system}
          systemKey={systemKey}
          initialSnapshotId={initialSnapshotId}
          initialGraphVersionId={initialGraphVersionId}
          initialPromptVersionId={initialPromptVersionId}
        />
      )}
    </CatalogGate>
  );
}

function SystemsWorkbench({
  catalog,
  system,
  systemKey,
  initialSnapshotId,
  initialGraphVersionId,
  initialPromptVersionId,
}: {
  catalog: Catalog;
  system: AgentSystemSummary;
  systemKey: string;
  initialSnapshotId?: string;
  initialGraphVersionId?: string;
  initialPromptVersionId?: string;
}) {
  const { reload: reloadCatalog } = useCatalog();
  const prompts = catalog.prompts.filter(
    (item) => item.agent_system_id === system.id,
  );
  const [activeKind, setActiveKind] = useState<ArtifactKind>(
    initialSnapshotId ? "snapshot" : "graph",
  );
  const [requestedGraphVersionId, setGraphVersionId] = useState(
    system.versions.find((version) => version.id === initialGraphVersionId)
      ?.id ?? "",
  );
  const [requestedPromptId, setPromptId] = useState(
    prompts.find((prompt) =>
      prompt.versions.some((version) => version.id === initialPromptVersionId),
    )?.id ?? "",
  );
  const [requestedPromptVersionId, setPromptVersionId] = useState(
    initialPromptVersionId ?? "",
  );
  const [requestedSnapshotId, setSnapshotId] = useState(
    initialSnapshotId ?? "",
  );
  const prompt =
    prompts.find((item) => item.id === requestedPromptId) ?? prompts[0];
  const graphVersionId =
    requestedGraphVersionId || system.versions[0]?.id || "";
  const promptVersionId = prompt?.versions.some(
    (version) => version.id === requestedPromptVersionId,
  )
    ? requestedPromptVersionId
    : prompt?.versions[0]?.id || "";

  const graphDetail = useApiResource(
    graphVersionId ? () => api.agentVersion(graphVersionId) : null,
    [graphVersionId],
    { cacheKey: `graph-version:${graphVersionId}` },
  );
  const promptDetail = useApiResource(
    promptVersionId ? () => api.promptVersion(promptVersionId) : null,
    [promptVersionId],
    { cacheKey: `prompt-version:${promptVersionId}` },
  );
  const snapshots = useApiResource(
    () => api.nodeSnapshots({ productKey: system.product_key }),
    [system.product_key],
    { cacheKey: `node-snapshots:${system.product_key}` },
  );
  const snapshotId =
    (snapshots.data ?? []).find(
      (snapshot) => snapshot.id === requestedSnapshotId,
    )?.id ??
    snapshots.data?.[0]?.id ??
    "";
  const snapshotDetail = useApiResource(
    snapshotId ? () => api.nodeSnapshot(snapshotId) : null,
    [snapshotId],
    { cacheKey: `node-snapshot:${snapshotId}` },
  );
  const promptAssociations = graphPromptAssociations(
    graphDetail.data?.definition ?? null,
    prompt?.key ?? "",
  );
  const hasNodeSnapshots = Boolean(
    graphDetail.data?.definition.nodes.some(
      (node) =>
        node.snapshot_policy ||
        node.runtime_input_policy ||
        node.resource_policy,
    ) || snapshots.data?.length,
  );

  const artifactKinds = [
    {
      kind: "graph" as const,
      label: "Graph",
      detail: countOf(system.versions.length, "version"),
      icon: GitBranchIcon,
    },
    {
      kind: "prompt" as const,
      label: "Prompts",
      detail: countOf(prompts.length, "prompt"),
      icon: TextTIcon,
    },
    ...(hasNodeSnapshots
      ? [
          {
            kind: "snapshot" as const,
            label: "Snapshots",
            detail: countOf(snapshots.data?.length ?? 0, "snapshot"),
            icon: DatabaseIcon,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={`${system.name} artifacts`}
        action={
          <Link
            className="app-button secondary"
            href={`/import?system=${encodeURIComponent(system.key)}`}
          >
            Import version
          </Link>
        }
      />
      <section className="grid gap-4 p-4 md:p-7 xl:grid-cols-[220px_minmax(0,1fr)]">
        {/* 10px of padding inside the 24px card makes 14px the concentric row radius.
            overflow-hidden keeps the idle glide pill, still sized for a wider
            layout after a resize, from widening the page. */}
        <HoverGlide
          as="nav"
          aria-label="What to view"
          className="surface-card grid h-fit grid-cols-[minmax(0,1fr)] gap-0.5 overflow-hidden p-2.5"
          rowSelector="button"
          radius={14}
        >
          <p className="mono px-3 pt-2.5 pb-2 text-[11px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
            Show
          </p>
          {artifactKinds.map(({ kind, label, detail, icon: Icon }) => (
            <button
              key={kind}
              type="button"
              aria-pressed={activeKind === kind}
              onClick={() => setActiveKind(kind)}
              className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-[var(--text-muted)] transition-colors duration-[var(--hover-out)] hover:text-[var(--text)] hover:duration-[var(--hover-in)] aria-pressed:bg-[var(--shell-active)] aria-pressed:text-[var(--text)]"
            >
              <Icon
                size={15}
                className={`shrink-0 ${
                  activeKind === kind
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-muted)]"
                }`}
              />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium">
                  {label}
                </span>
                <span className="mono mt-0.5 block truncate text-[10px] text-[var(--text-faint)]">
                  {detail}
                </span>
              </span>
            </button>
          ))}
        </HoverGlide>
        <div className="min-w-0">
          {activeKind === "graph" ? (
            <VersionEditor
              key={`graph-${graphVersionId}-${graphDetail.data?.content_hash ?? "loading"}`}
              kind="graph"
              systemKey={systemKey}
              title={system.name}
              description={system.description}
              icon={<GitBranchIcon size={16} />}
              versions={system.versions}
              selectedVersionId={graphVersionId}
              onVersionChange={setGraphVersionId}
              content={
                graphDetail.data
                  ? JSON.stringify(graphDetail.data.definition, null, 2)
                  : ""
              }
              loading={graphDetail.loading}
              recordId={system.id}
              onSave={async (recordId, content) => {
                const definition = JSON.parse(content) as Record<
                  string,
                  unknown
                >;
                const created = await api.createAgentVersion(
                  recordId,
                  definition,
                );
                await reloadCatalog();
                setGraphVersionId(created.id);
              }}
            />
          ) : activeKind === "prompt" && prompt ? (
            <VersionEditor
              key={`prompt-${prompt.id}-${promptVersionId}-${promptDetail.data?.content_hash ?? "loading"}`}
              kind="prompt"
              title={prompt.name}
              description={prompt.description}
              icon={<TextTIcon size={16} />}
              records={prompts.map(({ id, name }) => ({ id, name }))}
              selectedRecordId={prompt.id}
              onRecordChange={(id) => {
                setPromptId(id);
                setPromptVersionId("");
              }}
              associations={promptAssociations}
              versions={prompt.versions}
              selectedVersionId={promptVersionId}
              onVersionChange={setPromptVersionId}
              content={promptDetail.data?.content ?? ""}
              loading={promptDetail.loading}
              recordId={prompt.id}
              onSave={async (recordId, content) => {
                const created = await api.createPromptVersion(
                  recordId,
                  content,
                );
                await reloadCatalog();
                setPromptVersionId(created.id);
              }}
            />
          ) : activeKind === "prompt" ? (
            <div className="surface-card">
              <EmptyState
                title="No prompts yet"
                message="Importing a version adds its prompt."
              />
            </div>
          ) : (
            <NodeSnapshotBrowser
              systemKey={systemKey}
              snapshots={snapshots.data ?? []}
              selectedSnapshotId={snapshotId}
              onSnapshotChange={setSnapshotId}
              detail={snapshotDetail.data}
              loading={snapshots.loading || snapshotDetail.loading}
              error={snapshots.error || snapshotDetail.error}
              retry={() => {
                void snapshots.reload();
                void snapshotDetail.reload();
              }}
            />
          )}
        </div>
      </section>
    </>
  );
}
