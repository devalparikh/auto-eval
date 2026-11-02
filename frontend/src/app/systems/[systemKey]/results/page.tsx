import type { Metadata } from "next";
import { ResultsScreen } from "@/features/results/results-screen";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemKey: string }>;
  searchParams: Promise<{ dataset?: string | string[] }>;
}) {
  const { systemKey } = await params;
  const { dataset } = await searchParams;
  return (
    <ResultsScreen
      systemKey={systemKey}
      initialDatasetVersionId={typeof dataset === "string" ? dataset : undefined}
    />
  );
}
