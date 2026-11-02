import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { TracesWorkspace } from "@/features/traces/traces-workspace";
import { paneCollapsedFromCookie, paneCookieName } from "@/lib/sidebar";

export default async function TracesLayout({
  params,
  children,
}: {
  params: Promise<{ systemKey: string }>;
  children: ReactNode;
}) {
  const { systemKey } = await params;
  const cookieStore = await cookies();
  return (
    <TracesWorkspace
      systemKey={systemKey}
      initialCollapsed={paneCollapsedFromCookie(
        cookieStore.get(paneCookieName("traces"))?.value,
      )}
    >
      {children}
    </TracesWorkspace>
  );
}
