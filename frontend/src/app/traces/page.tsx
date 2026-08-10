import type { Metadata } from "next";
import { TracesScreen } from "@/features/traces/traces-screen";

export const metadata: Metadata = { title: "Traces" };

export default function TracesPage() {
  return <TracesScreen />;
}
