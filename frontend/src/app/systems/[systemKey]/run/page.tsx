import type { Metadata } from "next";
import { RunScreen } from "@/features/run/run-screen";

export const metadata: Metadata = { title: "Run inference" };

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ systemKey: string }>;
  searchParams: Promise<{
    graphVersion?: string | string[];
    promptVersion?: string | string[];
  }>;
}) {
  const { systemKey } = await params;
  const query = await searchParams;
  return (
    <RunScreen
      systemKey={systemKey}
      initialGraphVersionId={
        typeof query.graphVersion === "string" ? query.graphVersion : undefined
      }
      initialPromptVersionId={
        typeof query.promptVersion === "string"
          ? query.promptVersion
          : undefined
      }
    />
  );
}
