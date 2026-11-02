import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ImportScreen } from "@/features/systems/import-screen";
import { paneCollapsedFromCookie, paneCookieName } from "@/lib/sidebar";

export const metadata: Metadata = { title: "Import an agent system" };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ system?: string | string[] }>;
}) {
  const query = await searchParams;
  const cookieStore = await cookies();
  return (
    <ImportScreen
      systemKey={typeof query.system === "string" ? query.system : undefined}
      initialPaneCollapsed={paneCollapsedFromCookie(
        cookieStore.get(paneCookieName("import"))?.value,
      )}
    />
  );
}
