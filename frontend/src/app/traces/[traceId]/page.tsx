import type { Metadata } from "next";
import { TraceDetailScreen } from "@/features/traces/trace-detail-screen";

export const metadata: Metadata = { title: "Trace detail" };

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ traceId: string }>;
}) {
  const { traceId } = await params;
  return <TraceDetailScreen traceId={traceId} />;
}
