import type { Metadata } from "next";
import { DatasetsScreen } from "@/features/datasets/datasets-screen";

export const metadata: Metadata = { title: "Datasets" };

export default async function DatasetsPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  return <DatasetsScreen systemKey={systemKey} />;
}
