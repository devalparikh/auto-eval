import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Datasets" };

export default function DatasetsPage() {
  redirect("/systems/incident-triage/datasets");
}
