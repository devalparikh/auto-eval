"use client";

import { LockIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { systemByKey } from "@/features/catalog/catalog-options";
import { EditDatasetItemModal } from "@/features/datasets/edit-dataset-item-modal";
import { api } from "@/lib/api";
import { formatDate, shortId, textPreview } from "@/lib/format";
import { playPreferredUiSound } from "@/lib/sound";
import type { DatasetItem } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function DatasetsScreen({ systemKey }: { systemKey: string }) {
  const catalog = useApiResource(api.catalog, []);
  const system = systemByKey(catalog.data, systemKey);
  const datasets =
    catalog.data?.datasets.filter(
      (item) => item.agent_system_id === system?.id,
    ) ?? [];
  const [requestedDatasetId, setDatasetId] = useState("");
  const datasetId = requestedDatasetId || datasets[0]?.id || "";
  const dataset = datasets.find((item) => item.id === datasetId) ?? null;
  const [requestedVersionId, setVersionId] = useState("");
  const [editingItem, setEditingItem] = useState<DatasetItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const selectedVersionId =
    (dataset?.versions.some((item) => item.id === requestedVersionId)
      ? requestedVersionId
      : "") ||
    dataset?.versions[0]?.id ||
    "";
  const detail = useApiResource(
    () =>
      selectedVersionId
        ? api.datasetVersion(selectedVersionId)
        : Promise.resolve(null),
    [selectedVersionId],
  );
  const selectedVersion = dataset?.versions.find(
    (item) => item.id === selectedVersionId,
  );

  async function finalize() {
    if (!selectedVersionId) return;
    setWorking(true);
    setActionError(null);
    try {
      await api.finalizeDataset(selectedVersionId);
      await Promise.all([catalog.reload(), detail.reload()]);
      playPreferredUiSound("success");
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not finalize dataset",
      );
    } finally {
      setWorking(false);
    }
  }

  async function createDraft() {
    if (!dataset) return;
    setWorking(true);
    setActionError(null);
    const source = dataset.versions.find(
      (version) => version.status === "final",
    );
    try {
      const created = await api.createDatasetVersion(dataset.id, source?.id);
      await catalog.reload();
      setVersionId(created.id);
      playPreferredUiSound("success");
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not create draft",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${system?.name ?? "Agent system"} datasets`}
        description="Build and finalize the examples used in evaluations."
        action={
          <button
            className="app-button secondary"
            onClick={createDraft}
            disabled={working || !dataset}
          >
            <PlusIcon size={14} />
            New draft
          </button>
        }
      />
      <section className="grid gap-4 p-4 md:p-7">
        <div className="dataset-overview">
          <div className="dataset-overview-main">
            <div className="min-w-0">
              <h2>{dataset?.name ?? "Dataset"}</h2>
              <p>{dataset?.description}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {datasets.length > 1 ? (
                <label className="field dataset-version-field">
                  <span>Dataset</span>
                  <Select
                    value={datasetId}
                    onChange={(event) => {
                      setDatasetId(event.target.value);
                      setVersionId("");
                    }}
                  >
                    {datasets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <label className="field dataset-version-field">
                <span>Viewing version</span>
                <Select
                  aria-label="Dataset version"
                  value={selectedVersionId}
                  onChange={(event) => setVersionId(event.target.value)}
                >
                  {dataset?.versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      Version {version.version} ({version.status})
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>
          <div className="dataset-version-state">
            <div className="dataset-state-copy">
              <StatusBadge status={selectedVersion?.status ?? "final"} />
              <span>
                {selectedVersion?.status === "draft"
                  ? `${selectedVersion.item_count} examples · Finalizing locks this version.`
                  : "Locked. Every example uses the exact snapshot pinned to it."}
              </span>
            </div>
            {selectedVersion?.status === "draft" ? (
              <button
                className="app-button"
                onClick={finalize}
                disabled={working}
              >
                <LockIcon size={14} />
                {working ? "Finalizing..." : "Finalize version"}
              </button>
            ) : null}
          </div>
        </div>
        {actionError ? <ErrorState message={actionError} /> : null}
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_90px_34px] gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-muted)] max-md:grid-cols-[minmax(0,1fr)_76px_30px]">
            <span>Input</span>
            <span className="max-md:hidden">Expected</span>
            <span>Source</span>
            <span aria-hidden="true" />
          </div>
          {detail.loading ? <LoadingState rows={7} /> : null}
          {detail.error && selectedVersionId ? (
            <ErrorState message={detail.error} retry={detail.reload} />
          ) : null}
          {!detail.loading && detail.data?.items.length === 0 ? (
            <EmptyState
              title="No examples in this draft"
              message="Open a trace and add it here once you have checked the expected output."
            />
          ) : null}
          {detail.data?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                detail.data?.status === "draft" && setEditingItem(item)
              }
              className="data-row grid min-h-[62px] w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_90px_34px] items-center gap-3 border-b border-[var(--border)] px-4 text-left last:border-b-0 max-md:grid-cols-[minmax(0,1fr)_76px_30px]"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium">
                  {textPreview(item.input)}
                </p>
                <p className="mono mt-1 text-[9px] text-[var(--text-faint)]">
                  {shortId(item.id)} · {formatDate(item.updated_at)}
                </p>
                {Object.keys(item.runtime_input_snapshot_ids ?? {}).length ? (
                  <p className="mono mt-1 truncate text-[9px] text-[var(--accent)]">
                    {Object.keys(item.runtime_input_snapshot_ids ?? {}).length}{" "}
                    live data snapshot
                    {Object.keys(item.runtime_input_snapshot_ids ?? {})
                      .length === 1
                      ? ""
                      : "s"}
                  </p>
                ) : null}
                {Object.keys(item.node_resource_selections ?? {}).length ? (
                  <p className="mono mt-1 truncate text-[9px] text-[var(--accent)]">
                    {Object.keys(item.node_resource_selections ?? {}).length}{" "}
                    saved data snapshot
                    {Object.keys(item.node_resource_selections ?? {}).length ===
                    1
                      ? ""
                      : "s"}
                  </p>
                ) : null}
              </div>
              <p className="truncate text-[10px] text-[var(--text-muted)] max-md:hidden">
                {textPreview(item.expected)}
              </p>
              <span className="mono text-[9px] text-[var(--text-faint)]">
                {item.source_trace_id
                  ? `trace ${shortId(item.source_trace_id)}`
                  : "manual"}
              </span>
              {detail.data?.status === "draft" ? (
                <PencilSimpleIcon
                  size={14}
                  className="data-row-affordance text-[var(--text-faint)]"
                />
              ) : (
                <LockIcon
                  size={13}
                  className="data-row-affordance text-[var(--text-faint)]"
                />
              )}
            </button>
          ))}
        </div>
      </section>
      <EditDatasetItemModal
        item={editingItem}
        systemKey={systemKey}
        onClose={() => setEditingItem(null)}
        onSaved={async () => {
          setEditingItem(null);
          await detail.reload();
        }}
      />
    </>
  );
}
