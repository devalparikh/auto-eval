import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Trace detail" };

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ traceId: string }>;
}) {
  const { traceId } = await params;
  redirect(`/systems/incident-triage/traces/${traceId}`);
}
