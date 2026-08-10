import type { Metadata } from "next";
import { DatasetsScreen } from "@/features/datasets/datasets-screen";

export const metadata: Metadata = { title: "Datasets" };

export default function DatasetsPage() {
  return <DatasetsScreen />;
}
