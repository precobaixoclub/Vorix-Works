"use client";

import { useParams } from "next/navigation";
import { ConversationList } from "@/features/conversation/components/ConversationList";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceId: string }>();
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col overflow-hidden md:h-[calc(100dvh-3.5rem)] md:flex-row">
      <ConversationList workspaceId={params.workspaceId} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
