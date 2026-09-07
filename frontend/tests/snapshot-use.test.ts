import { describe, expect, it } from "vitest";
import { snapshotUse } from "@/features/traces/snapshot-use";
import type { TraceSpan } from "@/lib/types";

const span = { node_kind: "external_input", status: "complete", snapshot_resolution_mode: "live" } as TraceSpan;

describe("recorded snapshot usage", () => {
  it("distinguishes captured live data from replay and resolution", () => {
    expect(snapshotUse({ ...span, node_snapshot_id: "s1" }, null)?.label).toBe("Live data saved as a snapshot");
    expect(snapshotUse({ ...span, node_snapshot_id: "s1", snapshot_resolution_mode: "replayed" }, null)?.label).toBe("Snapshot replayed");
    expect(snapshotUse({ ...span, node_snapshot_id: "s1", snapshot_resolution_mode: "resolved" }, null)?.label).toBe("Latest snapshot resolved");
  });
  it("does not mistake an unused optional source for uncaptured data", () => {
    expect(snapshotUse({ ...span, snapshot_metadata: { observation_status: "not_required", capture_requested: true } }, null)?.label).toBe("Live data not needed");
    expect(snapshotUse(span, null)?.label).toBe("Live data not saved");
  });
  it("does not infer replay or capture from missing legacy metadata", () => {
    expect(snapshotUse({ ...span, snapshot_resolution_mode: null, runtime_input_snapshot_id: "legacy" }, null)?.label).toBe("Snapshot used");
    expect(snapshotUse({ ...span, snapshot_resolution_mode: null }, null)?.label).toBe("No snapshot recorded");
  });
  it("shows a failed fetch and omits irrelevant snapshot messaging for plain logic", () => {
    expect(snapshotUse({ ...span, status: "failed" }, null)?.label).toBe("Live fetch failed");
    expect(snapshotUse({ ...span, node_kind: "deterministic", snapshot_resolution_mode: null }, null)).toBeNull();
  });
});
