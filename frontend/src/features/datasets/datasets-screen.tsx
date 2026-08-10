"use client";

import { LockIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { EditDatasetItemModal } from "@/features/datasets/edit-dataset-item-modal";
import { groundTruthFromRecord } from "@/features/datasets/ground-truth";
import { api } from "@/lib/api";
import { formatDate, shortId, textPreview } from "@/lib/format";
import type { DatasetItem } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";

export function DatasetsScreen() {
  const catalog = useApiResource(api.catalog, []);
  const dataset = catalog.data?.datasets[0] ?? null;
  const [requestedVersionId, setSelectedVersionId] = useState("");
  const [editingItem, setEditingItem] = useState<DatasetItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const selectedVersionId = requestedVersionId || dataset?.versions[0]?.id || "";

  const detail = useApiResource(
    () =>
      selectedVersionId
        ? api.datasetVersion(selectedVersionId)
        : Promise.reject(new Error("Select a dataset version")),
    [selectedVersionId],
  );
  const selectedVersion = dataset?.versions.find((item) => item.id === selectedVersionId);

  async function finalize() {
    if (!selectedVersionId) return;
    setWorking(true);
    setActionError(null);
    try {
      await api.finalizeDataset(selectedVersionId);
      await Promise.all([catalog.reload(), detail.reload()]);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not finalize dataset");
    } finally {
      setWorking(false);
    }
  }

  async function createDraft() {
    if (!dataset) return;
    setWorking(true);
    setActionError(null);
    const source = dataset.versions.find((version) => version.status === "final");
    try {
      const created = await api.createDatasetVersion(dataset.id, source?.id);
      await catalog.reload();
      setSelectedVersionId(created.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not create draft");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Review trace examples, then freeze a version for evaluation."
        action={
          <button className="app-button secondary" onClick={createDraft} disabled={working || !dataset}>
            <PlusIcon size={14} />
            New draft
          </button>
        }
      />
      <section className="grid gap-4 p-4 md:p-7">
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold">{dataset?.name ?? "Dataset"}</h2>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">{dataset?.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Dataset version"
              className="app-select min-w-[170px]"
              value={selectedVersionId}
              onChange={(event) => setSelectedVersionId(event.target.value)}
            >
              {dataset?.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.version} ({version.status})
                </option>
              ))}
            </select>
            {selectedVersion?.status === "draft" ? (
              <button className="app-button" onClick={finalize} disabled={working}>
                <LockIcon size={14} />
                {working ? "Finalizing..." : "Finalize"}
              </button>
            ) : (
              <StatusBadge status={selectedVersion?.status ?? "final"} />
            )}
          </div>
        </div>
        {actionError ? <ErrorState message={actionError} /> : null}
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid grid-cols-[minmax(0,1.5fr)_92px_100px_80px_34px] gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-muted)] max-md:grid-cols-[minmax(0,1fr)_80px_30px]">
            <span>Input</span>
            <span>Severity</span>
            <span className="max-md:hidden">Route</span>
            <span className="max-md:hidden">Review</span>
            <span aria-hidden="true" />
          </div>
          {detail.loading ? <LoadingState rows={7} /> : null}
          {detail.error && selectedVersionId ? (
            <ErrorState message={detail.error} retry={detail.reload} />
          ) : null}
          {!detail.loading && detail.data?.items.length === 0 ? (
            <EmptyState
              title="No examples in this draft"
              message="Open a trace and add it after confirming the expected labels."
            />
          ) : null}
          {detail.data?.items.map((item) => {
            const expected = groundTruthFromRecord(item.expected);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => detail.data?.status === "draft" && setEditingItem(item)}
                className="data-row grid min-h-[62px] w-full grid-cols-[minmax(0,1.5fr)_92px_100px_80px_34px] items-center gap-3 border-b border-[var(--border)] px-4 text-left last:border-b-0 max-md:grid-cols-[minmax(0,1fr)_80px_30px]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">{textPreview(item.input)}</p>
                  <p className="mono mt-1 text-[9px] text-[var(--text-faint)]">
                    {shortId(item.id)} · {formatDate(item.updated_at)}
                  </p>
                </div>
                <span className="mono text-[10px]">{expected.severity}</span>
                <span className="mono text-[10px] max-md:hidden">{expected.route}</span>
                <span className="text-[10px] text-[var(--text-muted)] max-md:hidden">
                  {expected.requires_human ? "Required" : "No"}
                </span>
                {detail.data?.status === "draft" ? (
                  <PencilSimpleIcon size={14} className="text-[var(--text-faint)]" />
                ) : (
                  <LockIcon size={13} className="text-[var(--text-faint)]" />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          Final versions are immutable and are the only versions available to evaluation runs.
        </p>
      </section>
      <EditDatasetItemModal
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSaved={async () => {
          setEditingItem(null);
          await detail.reload();
        }}
      />
    </>
  );
}
