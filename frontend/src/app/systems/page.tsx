import type { Metadata } from "next";
import { SystemsScreen } from "@/features/systems/systems-screen";

export const metadata: Metadata = { title: "Versions" };

export default function SystemsPage() {
  return <SystemsScreen />;
}
