import { redirect } from "next/navigation";

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ systemKey: string }>;
}) {
  const { systemKey } = await params;
  redirect(`/systems/${encodeURIComponent(systemKey)}/artifacts`);
}
