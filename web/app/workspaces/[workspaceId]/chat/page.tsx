import { redirect } from "next/navigation";

export default async function ChatIndexPage({ params }: { params: Promise<{ workspaceId: string }> | { workspaceId: string } }) {
  const resolved = await params;
  redirect(`/workspaces/${resolved.workspaceId}/production`);
}
