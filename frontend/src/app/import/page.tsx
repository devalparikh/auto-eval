import type { Metadata } from "next";
import { ImportScreen } from "@/features/systems/import-screen";

export const metadata: Metadata = { title: "Import an agent system" };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ system?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <ImportScreen
      systemKey={typeof query.system === "string" ? query.system : undefined}
    />
  );
}
