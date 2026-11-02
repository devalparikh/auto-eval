"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { HoverGlide } from "@/components/hover-glide";
import { PageHeader } from "@/components/page-header";
import { SplitPane } from "@/components/split-pane";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import type { CustomModel } from "@/lib/types";
import { useApiResource } from "@/lib/use-api-resource";
import { useCatalog } from "@/lib/use-catalog";
import { CreateModelModal } from "./create-model-modal";
import { ModelDetails } from "./model-details";
import styles from "./custom-models.module.css";

export function CustomModelsScreen({
  initialModelId = null,
  initialPaneCollapsed = false,
}: {
  initialModelId?: string | null;
  initialPaneCollapsed?: boolean;
}) {
  const catalog = useCatalog();
  const models = useApiResource(api.customModels, [], {
    cacheKey: "custom-models",
  });
  const runtime = useApiResource(api.trainingRuntime);
  const [requestedId, setSelectedId] = useState(initialModelId);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<CustomModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasActive =
    models.data?.some(
      (model) => model.status === "running" || model.status === "queued",
    ) ?? false;
  const reloadModels = models.reload;
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      void reloadModels();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasActive, reloadModels]);

  function accept(model: CustomModel) {
    models.setData((current) => [
      model,
      ...(current ?? []).filter((item) => item.id !== model.id),
    ]);
    setSelectedId(model.id);
  }

  async function action(operation: () => Promise<CustomModel>) {
    setBusy(true);
    setError(null);
    try {
      accept(await operation());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update model",
      );
    } finally {
      setBusy(false);
    }
  }

  const visible = (models.data ?? []).filter(
    (model) => model.archived === showArchived,
  );
  const selected =
    visible.find((model) => model.id === requestedId) ?? visible[0];
  const trainBlockedReason = !runtime.data
    ? null
    : !runtime.data.available
      ? "Set up local training to start."
      : hasActive
        ? "Another model is training. One job runs at a time."
        : null;

  const list = (
    <>
      <header className="split-pane-head">
        <div className="min-w-0">
          <h1 className="split-pane-title">Custom models</h1>
          <p className="split-pane-subtitle">
            Fine-tune a base model on a finalized dataset.
          </p>
        </div>
        <button
          className="app-button"
          aria-label="New custom model"
          title="New custom model"
          disabled={!catalog.data || !runtime.data}
          onClick={() => {
            setSource(null);
            setCreating(true);
          }}
        >
          <PlusIcon size={13} weight="bold" />
          New
        </button>
      </header>
      <div className="split-pane-tools">
        <div className="segmented" role="group" aria-label="Model visibility">
          <button
            type="button"
            aria-pressed={!showArchived}
            onClick={() => setShowArchived(false)}
          >
            Models
          </button>
          <button
            type="button"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(true)}
          >
            Archived
          </button>
        </div>
        <span className="mono text-[10px] text-[var(--text-faint)]">
          {visible.length}
        </span>
      </div>
      <HoverGlide
        as="nav"
        className="split-pane-list"
        aria-label="Custom models"
        radius={14}
      >
        {visible.map((model) => (
          <button
            key={model.id}
            type="button"
            className={`${styles.modelRow} data-row`}
            aria-current={selected?.id === model.id ? "true" : undefined}
            onClick={() => {
              setSelectedId(model.id);
              setError(null);
            }}
          >
            <span className={styles.modelRowHead}>
              <span>{model.name}</span>
              <StatusBadge status={model.status} />
            </span>
            <small>{model.base_model.split("/").at(-1)}</small>
          </button>
        ))}
      </HoverGlide>
    </>
  );

  const environment = (
    <section className={styles.runtime} aria-label="Training environment">
      <div className={styles.runtimeLine}>
        <StatusBadge
          status={
            runtime.loading
              ? "checking"
              : runtime.data?.available
                ? "ready"
                : "setup required"
          }
        />
        <p>
          {runtime.data?.reason ??
            (runtime.loading
              ? "Checking local training support…"
              : "Could not check local training support.")}
        </p>
        <button
          type="button"
          className="app-button secondary"
          disabled={runtime.loading}
          onClick={() => {
            void runtime.reload();
          }}
        >
          {runtime.loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      {runtime.data && !runtime.data.available && (
        <details className={styles.setup}>
          <summary>Set up local training</summary>
          <p>
            Run this from the project directory on an Apple Silicon Mac, then
            refresh.
          </p>
          <code>{runtime.data.setup_command}</code>
        </details>
      )}
    </section>
  );

  return (
    <SplitPane
      id="custom-models"
      label="Model list"
      initialCollapsed={initialPaneCollapsed}
      pane={list}
    >
      {selected && catalog.data ? (
        <ModelDetails
          key={selected.id}
          model={selected}
          catalog={catalog.data}
          busy={busy}
          trainBlockedReason={trainBlockedReason}
          canTrain={Boolean(runtime.data?.available) && !hasActive}
          environment={environment}
          actionError={error}
          onAction={(operation) => {
            void action(operation);
          }}
          onCopy={() => {
            setSource(selected);
            setCreating(true);
          }}
        />
      ) : (
        <>
          <PageHeader
            title={showArchived ? "Nothing archived" : "Create a custom model"}
          />
          <div className={styles.body}>
            {environment}
            {(!models.data && models.loading) ||
            (!catalog.data && catalog.loading) ? (
              <LoadingState rows={6} />
            ) : (
              <EmptyState
                title={
                  showArchived ? "No archived models" : "No custom models yet"
                }
                message={
                  showArchived
                    ? "Archived models keep their training history and adapters."
                    : "Choose a base model and a finalized dataset, then review the examples before fine-tuning."
                }
              />
            )}
          </div>
        </>
      )}
      {models.error || catalog.error || runtime.error ? (
        <ErrorState
          message={
            models.error ?? catalog.error ?? runtime.error ?? "Request failed"
          }
          retry={() => {
            void models.reload();
            void catalog.reload();
            void runtime.reload();
          }}
        />
      ) : null}
      {creating && catalog.data && runtime.data && (
        <CreateModelModal
          catalog={catalog.data}
          runtime={runtime.data}
          source={source}
          onClose={() => setCreating(false)}
          onCreated={(model) => {
            accept(model);
            setShowArchived(false);
            setCreating(false);
            setError(null);
          }}
        />
      )}
    </SplitPane>
  );
}
