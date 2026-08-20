import { redirect } from "next/navigation";
import { legacyNetworkPublishHref } from "@/features/publication-history/legacy-routes";

export default async function InstagramLegacyPage({ params }: { params: Promise<{ workspaceId: string }> | { workspaceId: string } }) {
  const resolved = await params;
  redirect(legacyNetworkPublishHref(resolved.workspaceId, "instagram"));
}
