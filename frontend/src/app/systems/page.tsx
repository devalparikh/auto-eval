import type { Metadata } from "next";
import { SystemBrowserScreen } from "@/features/systems/system-browser-screen";

export const metadata: Metadata = { title: "Agent systems" };

export default function SystemsPage() {
  return <SystemBrowserScreen />;
}
