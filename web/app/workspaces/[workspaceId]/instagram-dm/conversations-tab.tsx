"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { Spinner } from "@/components/Spinner";
import { formatDateTime } from "@/lib/format";
import { markInstagramDmConversationRead, sendInstagramDmMessage, setInstagramDmConversationMuted } from "@/features/instagram-dm/api";
import { useInstagramDmConversations, useInstagramDmMessages } from "@/features/instagram-dm/hooks";
import type { InstagramDmConversation } from "@/features/instagram-dm/types";

function senderLabel(conversation: InstagramDmConversation): string {
  if (conversation.lastMessageFrom === "user") return "";
  return conversation.lastMessageFrom === "automation" ? "Automação: " : "Você: ";
}

export function ConversationsTab({ workspaceId, instagramBusinessAccountId }: { workspaceId: string; instagramBusinessAccountId: string }) {
  const { data, isLoading, error, mutate } = useInstagramDmConversations(workspaceId, instagramBusinessAccountId);
  const conversations = data?.conversations ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = conversations.find((conversation) => conversation.id === selectedId);

  async function handleSelect(conversation: InstagramDmConversation) {
    setSelectedId(conversation.id);
    if (conversation.unread) {
      await markInstagramDmConversationRead(workspaceId, conversation.id);
      await mutate();
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => mutate()} />;
  }
  if (conversations.length === 0) {
    return <EmptyState title="Nenhuma conversa ainda" description="Mensagens diretas recebidas nesta conta do Instagram aparecem aqui." />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,280px)_1fr]">
      <div className="grid gap-1.5">
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            onClick={() => handleSelect(conversation)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              conversation.id === selectedId ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className={`truncate text-sm ${conversation.unread ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                {conversation.participantUsername ? `@${conversation.participantUsername}` : conversation.participantId}
              </p>
              {conversation.unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {senderLabel(conversation)}{conversation.lastMessagePreview ?? "—"}
            </p>
            {conversation.automationMuted ? <p className="mt-1 text-[11px] text-muted-foreground/70">Automação pausada nesta conversa</p> : null}
          </button>
        ))}
      </div>

      <Card className="flex min-h-[420px] flex-col overflow-hidden p-0">
        {selected ? (
          <ConversationThread workspaceId={workspaceId} conversation={selected} onMutedChange={() => mutate()} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">Selecione uma conversa pra ver as mensagens.</div>
        )}
      </Card>
    </div>
  );
}

function ConversationThread({ workspaceId, conversation, onMutedChange }: { workspaceId: string; conversation: InstagramDmConversation; onMutedChange: () => void }) {
  const { data, isLoading, mutate } = useInstagramDmMessages(workspaceId, conversation.id);
  const messages = [...(data?.messages ?? [])].reverse();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setText("");
    setError(undefined);
  }, [conversation.id]);

  async function handleSend() {
    if (!text.trim()) return;
    setSending(true);
    setError(undefined);
    try {
      await sendInstagramDmMessage(workspaceId, conversation.id, text.trim());
      setText("");
      await mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function handleToggleMute() {
    await setInstagramDmConversationMuted(workspaceId, conversation.id, !conversation.automationMuted);
    onMutedChange();
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <p className="text-sm font-medium text-foreground">{conversation.participantUsername ? `@${conversation.participantUsername}` : conversation.participantId}</p>
        <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={handleToggleMute}>
          {conversation.automationMuted ? "Reativar automação" : "Assumir conversa (pausar automação)"}
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner className="h-5 w-5 text-primary" /></div>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">Nenhuma mensagem ainda.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${message.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                <p>{message.messageText}</p>
                <p className={`mt-1 text-[10px] ${message.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground/70"}`}>
                  {message.sender === "automation" ? "Automação · " : ""}{formatDateTime(message.sentAt)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3">
        {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleSend()} placeholder="Escreva uma resposta..." />
          <Button disabled={sending || !text.trim()} onClick={handleSend}>{sending ? "Enviando..." : "Enviar"}</Button>
        </div>
      </div>
    </div>
  );
}
