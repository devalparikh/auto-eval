"use client";

import { GitBranchIcon, TextTIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { systemByKey } from "@/features/catalog/catalog-options";
import { VersionEditor } from "@/features/systems/version-editor";
import { api } from "@/lib/api";
import { useApiResource } from "@/lib/use-api-resource";

export function SystemsScreen({ systemKey }: { systemKey: string }) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);
  const prompt = catalog.data?.prompts.find(
    (item) => item.agent_system_id === system?.id,
  );
  const [requestedGraphVersionId, setGraphVersionId] = useState("");
  const [requestedPromptVersionId, setPromptVersionId] = useState("");
  const graphVersionId = requestedGraphVersionId || system?.versions[0]?.id || "";
  const promptVersionId = requestedPromptVersionId || prompt?.versions[0]?.id || "";

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

  return (
    <>
      <PageHeader
        title={`${system?.name ?? "Agent system"} versions`}
        description="Create immutable graph and system prompt revisions."
      />
      {catalog.loading ? <LoadingState rows={8} /> : null}
      {catalog.error ? <ErrorState message={catalog.error} retry={catalog.reload} /> : null}
      {catalog.data ? (
        <section className="grid gap-4 p-4 md:p-7 xl:grid-cols-2">
          <VersionEditor
            key={`graph-${graphVersionId}-${graphDetail.data?.content_hash ?? "loading"}`}
            kind="graph"
            title={system?.name ?? "Agent system"}
            description={system?.description ?? ""}
            icon={<GitBranchIcon size={16} />}
            versions={system?.versions ?? []}
            selectedVersionId={graphVersionId}
            onVersionChange={setGraphVersionId}
            content={graphDetail.data ? JSON.stringify(graphDetail.data.definition, null, 2) : ""}
            loading={graphDetail.loading}
            recordId={system?.id ?? ""}
            onSave={async (recordId, content) => {
              const definition = JSON.parse(content) as Record<string, unknown>;
              const created = await api.createAgentVersion(recordId, definition);
              await catalog.reload();
              setGraphVersionId(created.id);
            }}
          />
          <VersionEditor
            key={`prompt-${promptVersionId}-${promptDetail.data?.content_hash ?? "loading"}`}
            kind="prompt"
            title={prompt?.name ?? "System prompt"}
            description={prompt?.description ?? ""}
            icon={<TextTIcon size={16} />}
            versions={prompt?.versions ?? []}
            selectedVersionId={promptVersionId}
            onVersionChange={setPromptVersionId}
            content={promptDetail.data?.content ?? ""}
            loading={promptDetail.loading}
            recordId={prompt?.id ?? ""}
            onSave={async (recordId, content) => {
              const created = await api.createPromptVersion(recordId, content);
              await catalog.reload();
              setPromptVersionId(created.id);
            }}
          />
        </section>
      ) : null}
    </>
  );
}
