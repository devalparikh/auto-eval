/**
 * Compile-time drift check between the hand-written API types in
 * `@/lib/types` and the backend's OpenAPI schema in `@/lib/api-schema`.
 *
 * `api-schema.ts` is generated from the running FastAPI app (see
 * `make api-types`), so it is the source of truth for the HTTP contract. This
 * file contains no runtime code — it fails `npm run typecheck` when a
 * hand-written type claims a field the backend does not send, or claims a type
 * the backend cannot produce.
 *
 * Two differences are deliberately allowed, because both are safe:
 *   - Narrowing: the backend types a field as `str` while the frontend uses a
 *     literal union (e.g. `status: "draft" | "final"`).
 *   - Omission: the frontend leaves out fields it does not consume, or marks a
 *     field the backend always sends as optional.
 * Everything else — a renamed field, a removed field, a changed value type — is
 * a compile error. Fix `types.ts` (or the backend) rather than this file.
 */

import type { components } from "@/lib/api-schema";
import type {
  AgentSystemSummary,
  AgentVersionDetail,
  Catalog,
  CodebaseCommit,
  CodebaseComparison,
  CodebaseEdge,
  CodebaseGraph,
  CodebaseNode,
  CodebaseRepository,
  CodebaseRevisions,
  DatasetItem,
  DatasetMembership,
  DatasetSummary,
  DatasetTarget,
  DatasetVersionDetail,
  DatasetVersionSummary,
  EvalItemResult,
  EvalModelResult,
  EvalRun,
  GraphDefinition,
  GraphNodeDefinition,
  ModelOption,
  NodeResourcePolicy,
  NodeResourceSelection,
  NodeSnapshotDetail,
  NodeSnapshotPolicy,
  NodeSnapshotSummary,
  NodeSnapshotUsage,
  PortfolioSnapshotDetail,
  PortfolioSnapshotSummary,
  PromptSummary,
  PromptVersionDetail,
  RuntimeInputPolicy,
  RuntimeInputSnapshotDetail,
  RuntimeInputSnapshotSummary,
  Trace,
  TraceDatasetTargets,
  TraceSpan,
  VersionSummary,
} from "@/lib/types";

type Schemas = components["schemas"];

/**
 * What the wire actually carries: fields that Pydantic defaults (and that
 * openapi-typescript therefore marks optional) are always serialized, and a
 * frontend type is free to mark a field it barely uses as optional. Normalizing
 * both sides removes that noise so only real shape differences remain.
 */
type Sent<T> = T extends (infer Item)[]
  ? Sent<Item>[]
  : T extends object
    ? { [Key in keyof T]-?: Sent<Exclude<T[Key], undefined>> }
    : T;

/**
 * The schema side, with every nested field optional: a frontend type may leave
 * out backend fields it does not use. Nested shapes are not let off the hook —
 * each one is registered as its own check below.
 */
type Accepted<T> = T extends (infer Item)[]
  ? Accepted<Item>[]
  : T extends object
    ? { [Key in keyof T]?: Accepted<T[Key]> }
    : T;

/** Compares whole unions rather than distributing over them. */
type Compatible<Local, Schema> = [Sent<Exclude<Local, undefined>>] extends [
  Accepted<Schema>,
]
  ? true
  : false;

type MismatchedFields<Local, Schema> = {
  [Key in Extract<keyof Local, keyof Schema>]: Compatible<
    Local[Key],
    Schema[Key]
  > extends true
    ? never
    : Key;
}[Extract<keyof Local, keyof Schema>];

type UnknownFields<Local, Schema> = Exclude<keyof Local, keyof Schema>;

/**
 * Resolves to `true` when `Local` is a valid view of `Schema`, otherwise to an
 * object type naming the offending fields — which then fails `Assert`.
 */
type Matches<Local, Schema> = [UnknownFields<Local, Schema>] extends [never]
  ? [MismatchedFields<Local, Schema>] extends [never]
    ? true
    : { FIELD_TYPE_DIFFERS_FROM_BACKEND: MismatchedFields<Local, Schema> }
  : { FIELD_MISSING_FROM_BACKEND: UnknownFields<Local, Schema> };

type Assert<Check extends true> = Check;

// --- Catalog -----------------------------------------------------------------

export type VersionSummaryMatches = Assert<
  Matches<VersionSummary, Schemas["VersionSummary"]>
>;
export type AgentSystemSummaryMatches = Assert<
  Matches<AgentSystemSummary, Schemas["AgentSystemSummary"]>
>;
export type PromptSummaryMatches = Assert<
  Matches<PromptSummary, Schemas["PromptSummary"]>
>;
export type DatasetSummaryMatches = Assert<
  Matches<DatasetSummary, Schemas["DatasetSummary"]>
>;
export type DatasetVersionSummaryMatches = Assert<
  Matches<DatasetVersionSummary, Schemas["DatasetVersionSummary"]>
>;
export type ModelOptionMatches = Assert<
  Matches<ModelOption, Schemas["ModelOption"]>
>;
export type CatalogMatches = Assert<Matches<Catalog, Schemas["CatalogResponse"]>>;

// --- Graph definitions -------------------------------------------------------

export type RuntimeInputPolicyMatches = Assert<
  Matches<RuntimeInputPolicy, Schemas["RuntimeInputPolicy"]>
>;
export type NodeSnapshotPolicyMatches = Assert<
  Matches<NodeSnapshotPolicy, Schemas["NodeSnapshotPolicy"]>
>;
export type NodeResourcePolicyMatches = Assert<
  Matches<NodeResourcePolicy, Schemas["NodeResourcePolicy"]>
>;
export type NodeResourceSelectionMatches = Assert<
  Matches<NodeResourceSelection, Schemas["NodeResourceSelection-Output"]>
>;
export type GraphNodeDefinitionMatches = Assert<
  Matches<GraphNodeDefinition, Schemas["AgentNodeDefinition"]>
>;
export type GraphDefinitionMatches = Assert<
  Matches<GraphDefinition, Schemas["AgentGraphDefinition"]>
>;
export type AgentVersionDetailMatches = Assert<
  Matches<AgentVersionDetail, Schemas["AgentVersionDetail"]>
>;
export type PromptVersionDetailMatches = Assert<
  Matches<PromptVersionDetail, Schemas["PromptVersionDetail"]>
>;

// --- Snapshots ---------------------------------------------------------------

export type PortfolioSnapshotSummaryMatches = Assert<
  Matches<PortfolioSnapshotSummary, Schemas["PortfolioSnapshotSummary"]>
>;
export type PortfolioSnapshotDetailMatches = Assert<
  Matches<PortfolioSnapshotDetail, Schemas["PortfolioSnapshotDetail"]>
>;
export type RuntimeInputSnapshotSummaryMatches = Assert<
  Matches<RuntimeInputSnapshotSummary, Schemas["RuntimeInputSnapshotSummary"]>
>;
export type RuntimeInputSnapshotDetailMatches = Assert<
  Matches<RuntimeInputSnapshotDetail, Schemas["RuntimeInputSnapshotDetail"]>
>;
export type NodeSnapshotUsageMatches = Assert<
  Matches<NodeSnapshotUsage, Schemas["NodeSnapshotUsage"]>
>;
export type NodeSnapshotSummaryMatches = Assert<
  Matches<NodeSnapshotSummary, Schemas["NodeSnapshotSummary"]>
>;
export type NodeSnapshotDetailMatches = Assert<
  Matches<NodeSnapshotDetail, Schemas["NodeSnapshotDetail"]>
>;

// --- Traces ------------------------------------------------------------------

export type TraceSpanMatches = Assert<
  Matches<TraceSpan, Schemas["TraceSpanResponse"]>
>;
export type TraceMatches = Assert<Matches<Trace, Schemas["TraceResponse"]>>;
export type DatasetMembershipMatches = Assert<
  Matches<DatasetMembership, Schemas["DatasetMembershipResponse"]>
>;
export type DatasetTargetMatches = Assert<
  Matches<DatasetTarget, Schemas["DatasetTargetResponse"]>
>;
export type TraceDatasetTargetsMatches = Assert<
  Matches<TraceDatasetTargets, Schemas["TraceDatasetTargetsResponse"]>
>;

// --- Datasets ----------------------------------------------------------------

export type DatasetItemMatches = Assert<
  Matches<DatasetItem, Schemas["DatasetItemResponse"]>
>;
export type DatasetVersionDetailMatches = Assert<
  Matches<DatasetVersionDetail, Schemas["DatasetVersionDetail"]>
>;

// --- Evaluations -------------------------------------------------------------

export type EvalModelResultMatches = Assert<
  Matches<EvalModelResult, Schemas["EvalModelResultResponse"]>
>;
export type EvalItemResultMatches = Assert<
  Matches<EvalItemResult, Schemas["EvalItemResultResponse"]>
>;
export type EvalRunMatches = Assert<Matches<EvalRun, Schemas["EvalRunResponse"]>>;

// --- Codebase graph ----------------------------------------------------------

export type CodebaseRepositoryMatches = Assert<
  Matches<CodebaseRepository, Schemas["RepositoryInfo"]>
>;
export type CodebaseComparisonMatches = Assert<
  Matches<CodebaseComparison, Schemas["ComparisonInfo"]>
>;
export type CodebaseNodeMatches = Assert<
  Matches<CodebaseNode, Schemas["CodebaseNode"]>
>;
export type CodebaseEdgeMatches = Assert<
  Matches<CodebaseEdge, Schemas["CodebaseEdge"]>
>;
export type CodebaseGraphMatches = Assert<
  Matches<CodebaseGraph, Schemas["CodebaseGraphResponse"]>
>;
export type CodebaseCommitMatches = Assert<
  Matches<CodebaseCommit, Schemas["CommitSummary"]>
>;
export type CodebaseRevisionsMatches = Assert<
  Matches<CodebaseRevisions, Schemas["CodebaseRevisionsResponse"]>
>;
