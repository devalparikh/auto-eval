import { createHash } from "node:crypto";
import {
  canonical,
  requireValue,
  validateDataset,
  validateExperiment,
  validateTrace,
} from "./contract.js";

// No inference or aggregate quality claim: pair named boolean checks on complete frozen case sets.
export function compareRuns(dataset, left, right, policy) {
  validateDataset(dataset);
  const datasetHash = createHash("sha256")
    .update(canonical(dataset))
    .digest("hex");
  const indexed = [left, right].map(({ experiment, traces }) => {
    validateExperiment(experiment);
    requireValue(
      experiment.datasetHash === datasetHash && experiment.mode !== "observed",
    );
    requireValue(traces.length === dataset.caseIds.length);
    const byCase = new Map();
    for (const trace of traces) {
      validateTrace(trace, policy);
      requireValue(
        trace.experimentId === experiment.id &&
          trace.source === "synthetic" &&
          dataset.caseIds.includes(trace.caseId) &&
          !byCase.has(trace.caseId),
      );
      byCase.set(trace.caseId, trace);
    }
    return byCase;
  });
  requireValue(left.experiment.mode === right.experiment.mode);
  return {
    datasetHash,
    mode: left.experiment.mode,
    cases: dataset.caseIds.map((id) => {
      const before = indexed[0].get(id),
        after = indexed[1].get(id);
      return {
        id,
        beforeStatus: before.status,
        afterStatus: after.status,
        checks: policy.checks.map((name) => ({
          name,
          before: before.checks[name],
          after: after.checks[name],
        })),
      };
    }),
  };
}
