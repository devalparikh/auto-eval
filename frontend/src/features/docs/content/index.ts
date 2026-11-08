import type { ComponentType } from "react";
import { ExistingCodeDoc } from "./existing-code";
import { FineTuningDoc } from "./fine-tuning";
import { ImportDoc } from "./import";
import { ManifestDoc } from "./manifest";
import { ModelsDoc } from "./models";
import { OverviewDoc } from "./overview";
import { ProvenanceDoc } from "./provenance";
import { QuickstartDoc } from "./quickstart";

/** Each docs page's body, keyed by its slug in `docs-pages.ts`. */
export const docsContent: Record<string, ComponentType> = {
  "": OverviewDoc,
  quickstart: QuickstartDoc,
  import: ImportDoc,
  "existing-code": ExistingCodeDoc,
  models: ModelsDoc,
  "fine-tuning": FineTuningDoc,
  manifest: ManifestDoc,
  provenance: ProvenanceDoc,
};
