"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { HoverGlide } from "@/components/hover-glide";
import { SegmentedControl } from "@/components/segmented-control";
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

type Visibility = "active" | "archived";

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
  const [visibility, setVisibility] = useState<Visibility>("active");
  const showArchived = visibility === "archived";
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

  function startCreating() {
    setSource(null);
    setCreating(true);
  }

  function retryAll() {
    void models.reload();
    void catalog.reload();
    void runtime.reload();
  }

  const visible = (models.data ?? []).filter(
    (model) => model.archived === showArchived,
  );
  const selected =
    visible.find((model) => model.id === requestedId) ?? visible[0];
  const canCreate = Boolean(catalog.data && runtime.data);
  // One failure, one message. Without the models or the catalog there is
  // nothing true to say about this screen, so the error stands in for it
  // rather than sitting beside an empty state that claims there are no models.
  const loadError = models.error ?? catalog.error;
  const settling =
    (!models.data && models.loading) || (!catalog.data && catalog.loading);
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
          disabled={!canCreate}
          onClick={startCreating}
        >
          <PlusIcon size={13} weight="bold" />
          New
        </button>
      </header>
      <div className="split-pane-tools">
        <SegmentedControl
          aria-label="Model visibility"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "active", label: "Models" },
            { value: "archived", label: "Archived" },
          ]}
        />
        {models.data ? (
          <span className="mono text-[10px] text-[var(--text-faint)]">
            {visible.length}
          </span>
        ) : null}
      </div>
      {!models.data && models.loading ? (
        <LoadingState rows={4} />
      ) : (
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
      )}
    </>
  );

  const runtimeStatus = runtime.data
    ? runtime.data.available
      ? "ready"
      : "setup required"
    : runtime.loading
      ? "checking"
      : "check failed";

  const environment = (
    <section className={styles.runtime} aria-label="Training environment">
      <div className={styles.runtimeLine}>
        <StatusBadge status={runtimeStatus} />
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

  let detail: ReactNode;
  if (selected && catalog.data) {
    detail = (
      <>
        <ModelDetails
          key={selected.id}
          model={selected}
          catalog={catalog.data}
          busy={busy}
          trainBlockedReason={trainBlockedReason}
          // A missing runtime is already explained, with its setup steps, by
          // the environment bar above the details; saying it again there
          // made one fact read four times.
          trainBlockedHint={runtime.data?.available ? trainBlockedReason : null}
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
        {/* The details above are real but may be stale. */}
        {loadError ? (
          <ErrorState
            title="Could not refresh"
            message={loadError}
            retry={retryAll}
            className={styles.refreshError}
          />
        ) : null}
      </>
    );
  } else if (loadError) {
    detail = (
      <div className={styles.prompt}>
        <ErrorState message={loadError} retry={retryAll} className="w-full" />
      </div>
    );
  } else if (settling) {
    // The list pane shows the skeleton; the detail has nothing to stand for.
    detail = null;
  } else if (showArchived) {
    detail = (
      <div className={styles.prompt}>
        <EmptyState
          title="No archived models"
          message="Archived models keep their training history and adapters."
        />
      </div>
    );
  } else {
    detail = (
      <div className={styles.prompt}>
        <EmptyState
          title="No custom models yet"
          message="Choose a base model and a finalized dataset, then review the examples before fine-tuning."
          action={
            <button
              type="button"
              className="app-button secondary"
              disabled={!canCreate}
              onClick={startCreating}
            >
              <PlusIcon size={13} weight="bold" aria-hidden="true" />
              Create a custom model
            </button>
          }
        />
        {environment}
      </div>
    );
  }

  return (
    <SplitPane
      id="custom-models"
      label="Model list"
      initialCollapsed={initialPaneCollapsed}
      pane={list}
    >
      {detail}
      {creating && catalog.data && runtime.data && (
        <CreateModelModal
          catalog={catalog.data}
          runtime={runtime.data}
          source={source}
          onClose={() => setCreating(false)}
          onCreated={(model) => {
            accept(model);
            setVisibility("active");
            setCreating(false);
            setError(null);
          }}
        />
      )}
    </SplitPane>
  );
}
