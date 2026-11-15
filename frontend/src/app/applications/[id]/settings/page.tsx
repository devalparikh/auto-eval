import { ApplicationSettings } from "@/features/applications/application-settings";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ApplicationSettings key={id} appId={id} />;
}
