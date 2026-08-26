"use client";

import { DatabaseIcon, GitBranchIcon, TextTIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { systemByKey } from "@/features/catalog/catalog-options";
import { graphPromptAssociations } from "@/features/systems/graph-prompts";
import { NodeSnapshotBrowser } from "@/features/systems/node-snapshot-browser";
import { VersionEditor } from "@/features/systems/version-editor";
import { api } from "@/lib/api";
import { useApiResource } from "@/lib/use-api-resource";

type ArtifactKind = "graph" | "prompt" | "snapshot";

export function SystemsScreen({
  systemKey,
  initialSnapshotId,
}: {
  systemKey: string;
  initialSnapshotId?: string;
}) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);
  const prompts =
    catalog.data?.prompts.filter(
      (item) => item.agent_system_id === system?.id,
    ) ?? [];
  const [activeKind, setActiveKind] = useState<ArtifactKind>(
    initialSnapshotId ? "snapshot" : "graph",
  );
  const [requestedGraphVersionId, setGraphVersionId] = useState("");
  const [requestedPromptId, setPromptId] = useState("");
  const [requestedPromptVersionId, setPromptVersionId] = useState("");
  const [requestedSnapshotId, setSnapshotId] = useState(
    initialSnapshotId ?? "",
  );
  const prompt =
    prompts.find((item) => item.id === requestedPromptId) ?? prompts[0];
  const graphVersionId =
    requestedGraphVersionId || system?.versions[0]?.id || "";
  const promptVersionId = prompt?.versions.some(
    (version) => version.id === requestedPromptVersionId,
  )
    ? requestedPromptVersionId
    : prompt?.versions[0]?.id || "";

  const graphDetail = useApiResource(
    () =>
      graphVersionId
        ? api.agentVersion(graphVersionId)
        : Promise.reject(new Error("Select a graph version")),
    [graphVersionId],
  );
  const promptDetail = useApiResource(
    () =>
      promptVersionId
        ? api.promptVersion(promptVersionId)
        : Promise.reject(new Error("Select a prompt version")),
    [promptVersionId],
  );
  const snapshots = useApiResource(
    () =>
      system
        ? api.nodeSnapshots({ productKey: system.product_key })
        : Promise.resolve([]),
    [system?.product_key],
  );
  const snapshotId =
    (snapshots.data ?? []).find(
      (snapshot) => snapshot.id === requestedSnapshotId,
    )?.id ??
    snapshots.data?.[0]?.id ??
    "";
  const snapshotDetail = useApiResource(
    () => (snapshotId ? api.nodeSnapshot(snapshotId) : Promise.resolve(null)),
    [snapshotId],
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
      detail: `${system?.versions.length ?? 0} versions`,
      icon: GitBranchIcon,
    },
    {
      kind: "prompt" as const,
      label: "Prompts",
      detail: `${prompts.length} families`,
      icon: TextTIcon,
    },
    ...(hasNodeSnapshots
      ? [
          {
            kind: "snapshot" as const,
            label: "Snapshots",
            detail: `${snapshots.data?.length ?? 0} records`,
            icon: DatabaseIcon,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={`${system?.name ?? "Agent system"} artifacts`} />
      {catalog.loading ? <LoadingState rows={8} /> : null}
      {catalog.error ? (
        <ErrorState message={catalog.error} retry={catalog.reload} />
      ) : null}
      {catalog.data && system ? (
        <section className="grid gap-4 p-4 md:p-7 xl:grid-cols-[220px_minmax(0,1fr)]">
          <nav
            aria-label="Artifact families"
            className="h-fit overflow-hidden border border-[var(--border)] bg-[var(--surface)]"
          >
            <div className="border-b border-[var(--border)] px-4 py-3">
              <p className="mono text-[9px] lowercase tracking-[0.12em] text-[var(--text-faint)]">
                Artifact family
              </p>
            </div>
            {artifactKinds.map(({ kind, label, detail, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                aria-pressed={activeKind === kind}
                onClick={() => setActiveKind(kind)}
                className="flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--surface-muted)] aria-pressed:bg-[var(--accent-soft)]"
              >
                <Icon
                  size={15}
                  className={
                    activeKind === kind
                      ? "text-[var(--accent)]"
                      : "text-[var(--text-muted)]"
                  }
                />
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium">{label}</span>
                  <span className="block text-[9px] text-[var(--text-faint)]">
                    {detail}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          <div className="min-w-0">
            {activeKind === "graph" ? (
              <VersionEditor
                key={`graph-${graphVersionId}-${graphDetail.data?.content_hash ?? "loading"}`}
                kind="graph"
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
                  await catalog.reload();
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
                  await catalog.reload();
                  setPromptVersionId(created.id);
                }}
              />
            ) : activeKind === "prompt" ? (
              <ErrorState message="This system has no prompt artifacts." />
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
      ) : null}
    </>
  );
}
