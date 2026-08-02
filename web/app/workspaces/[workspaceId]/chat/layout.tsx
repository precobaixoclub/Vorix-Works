"use client";

import { useParams } from "next/navigation";
import { ConversationList } from "@/features/conversation/components/ConversationList";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceId: string }>();
  return (
    <div className="flex h-[calc(100dvh-3.5rem)]">
      <ConversationList workspaceId={params.workspaceId} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
