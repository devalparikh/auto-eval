import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CustomModelsScreen } from "@/features/custom-models/custom-models-screen";
import { paneCollapsedFromCookie, paneCookieName } from "@/lib/sidebar";

export const metadata: Metadata = { title: "Custom models" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ model?: string | string[] }>;
}) {
  const { model } = await searchParams;
  const cookieStore = await cookies();
  return (
    <CustomModelsScreen
      initialModelId={typeof model === "string" ? model : null}
      initialPaneCollapsed={paneCollapsedFromCookie(
        cookieStore.get(paneCookieName("custom-models"))?.value,
      )}
    />
  );
}
