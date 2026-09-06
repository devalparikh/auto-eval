"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { systemByKey } from "@/features/catalog/catalog-options";
import type { AgentSystemSummary, Catalog } from "@/lib/types";
import { useCatalog } from "@/lib/use-catalog";

/**
 * Renders the loading / error / not-found ladder every screen needs before
 * it can look up its agent system in the catalog, once. Screens that show a
 * fixed title while the catalog is still loading can pass `title`; screens
 * whose title depends on the loaded system should leave it out.
 */
export function CatalogGate({
  systemKey,
  title,
  children,
}: {
  systemKey: string;
  title?: string;
  children: (ctx: { catalog: Catalog; system: AgentSystemSummary }) => ReactNode;
}) {
  const catalog = useCatalog();
  const system = systemByKey(catalog.data, systemKey);

  if (catalog.loading) {
    return (
      <>
        {title ? <PageHeader title={title} /> : null}
        <LoadingState rows={9} />
      </>
    );
  }
  if (catalog.error) {
    return (
      <>
        {title ? <PageHeader title={title} /> : null}
        <ErrorState message={catalog.error} retry={catalog.reload} />
      </>
    );
  }
  if (!catalog.data || !system) {
    return (
      <>
        {title ? <PageHeader title={title} /> : null}
        <ErrorState message="Agent system not found" />
      </>
    );
  }

  return <>{children({ catalog: catalog.data, system })}</>;
}
