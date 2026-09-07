import type { GraphNodeDefinition, TraceSpan } from "@/lib/types";

/** Describe recorded execution evidence, not the graph's intended behavior. */
export function snapshotUse(span: TraceSpan, node: GraphNodeDefinition | null) {
  const snapshotId = span.node_snapshot_id ?? span.runtime_input_snapshot_id;
  const mode = span.snapshot_resolution_mode;
  const metadata = span.snapshot_metadata ?? {};
  if (snapshotId) {
    if (mode === "replayed") return {
      label: "Snapshot replayed", detail: "This node used the exact saved snapshot below.",
    };
    if (mode === "resolved") return {
      label: "Latest snapshot resolved", detail: "The run resolved a saved input to this exact snapshot. Replays use this version.",
    };
    if (mode === "live") return {
      label: "Live data saved as a snapshot", detail: "This node fetched fresh data and saved a snapshot for replay.",
    };
    if (span.snapshot_role === "produced") return {
      label: "Output snapshot saved", detail: "This node saved its output as the snapshot below.",
    };
    return { label: "Snapshot used", detail: "This execution references the saved snapshot below." };
  }
  if (metadata.observation_status === "not_required") return {
    label: "Live data not needed", detail: "This request needed no external observation, so there is no snapshot to save or replay.",
  };
  if (mode === "live") {
    if (span.status === "failed" || metadata.error_code) return {
      label: "Live fetch failed", detail: "No snapshot was saved. Check this node's error and observation details.",
    };
    return {
      label: "Live data not saved", detail: "No snapshot was saved for replay. If this data influenced the result, the trace cannot be added to a dataset. Enable “Save live data for replay” before a new run.",
    };
  }
  if (node?.runtime_input_policy || node?.resource_policy || node?.snapshot_policy || span.node_kind === "external_input") return {
    label: "No snapshot recorded", detail: "This trace has no snapshot reference for this node. It does not establish whether data was fetched or replayed.",
  };
  return null;
}
