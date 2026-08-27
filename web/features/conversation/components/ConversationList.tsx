"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { formatRelativeTime } from "@/lib/format";
import { createConversation } from "../api";
import { useConversations } from "../hooks";
import { STATE_LABEL } from "../labels";

export function ConversationList({ workspaceId }: { workspaceId: string }) {
  const { data: conversations, isLoading, error, mutate } = useConversations(workspaceId);
  const [creating, setCreating] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function handleNewConversation() {
    setCreating(true);
    try {
      await createConversation(workspaceId);
      await mutate();
      router.push(`/workspaces/${workspaceId}/production`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className="flex max-h-72 w-full shrink-0 flex-col border-b border-border bg-surface-raised md:max-h-none md:w-72 md:border-b-0 md:border-r">
      <div className="border-b border-border p-3">
        <Button className="w-full" onClick={handleNewConversation} disabled={creating}>
          {creating ? "Criando…" : "+ Novo fluxo"}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-ink-muted">
            <Spinner className="h-4 w-4" /> Carregando…
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : (
          conversations?.map((conversation) => {
            const href = `/workspaces/${workspaceId}/production`;
            const isActive = pathname === href;
            return (
              <Link
                key={conversation.id}
                href={href}
                className={`block rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "bg-accent-soft text-primary" : "text-ink hover:bg-surface-sunken"
                }`}
              >
                <p className="truncate font-medium">{conversation.title ?? "Fluxo sem título"}</p>
                <p className="text-xs text-ink-faint">
                  {STATE_LABEL[conversation.state]} · {formatRelativeTime(conversation.updatedAt)}
                </p>
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
}
