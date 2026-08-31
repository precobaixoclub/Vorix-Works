"use client";

import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
  assignInboxConversation,
  markInboxConversationRead,
  sendInboxMessage,
  setInboxConversationAiEnabled,
  takeOverInboxConversation,
} from "@/features/inbox/api";
import { useInboxConversationMessages, useInboxConversations, useInboxRealtime } from "@/features/inbox/hooks";
import type { InboxConversation, InboxConversationFilter, InboxMessage } from "@/features/inbox/types";

const FILTERS: { value: InboxConversationFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "mine", label: "Minhas" },
  { value: "unassigned", label: "Não atribuídas" },
  { value: "unread", label: "Não lidas" },
];

type MobileView = "list" | "conversation" | "details";

/**
 * Inbox do módulo Conversas — Fase 3. Desktop: 3 colunas simultâneas (lista, timeline,
 * contato/CRM). Mobile: uma coluna por vez (`MobileView`), nunca as três juntas — ver
 * `web/CLAUDE.md`/design system.
 */
export function InboxTab({ workspaceId }: { workspaceId: string }) {
  const [filter, setFilter] = useState<InboxConversationFilter>("all");
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [mobileView, setMobileView] = useState<MobileView>("list");

  useInboxRealtime(workspaceId, selectedConversationId);

  const { data, isLoading, error, mutate } = useInboxConversations(workspaceId, filter);
  const conversations = data?.conversations ?? [];
  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  function handleSelect(conversation: InboxConversation) {
    setSelectedConversationId(conversation.id);
    setMobileView("conversation");
    if (conversation.unreadCount > 0) {
      markInboxConversationRead(workspaceId, conversation.id)
        .then(() => mutate())
        .catch(() => {});
    }
  }

  return (
    <div className="flex h-[calc(100vh-16rem)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card">
      <div className={cn("w-full flex-col md:flex md:w-80 md:flex-none md:border-r md:border-border", mobileView === "list" ? "flex" : "hidden")}>
        <ConversationListPane
          conversations={conversations}
          isLoading={isLoading}
          error={error}
          onRetry={() => mutate()}
          filter={filter}
          onFilterChange={setFilter}
          selectedConversationId={selectedConversationId}
          onSelect={handleSelect}
        />
      </div>

      <div className={cn("min-w-0 flex-1 flex-col", mobileView === "conversation" ? "flex" : "hidden md:flex")}>
        {selectedConversation ? (
          <ConversationTimelinePane
            workspaceId={workspaceId}
            conversation={selectedConversation}
            onBack={() => setMobileView("list")}
            onOpenDetails={() => setMobileView("details")}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState title="Selecione uma conversa" description="Escolha uma conversa na lista para ver o histórico de mensagens." />
          </div>
        )}
      </div>

      <div className={cn("w-full flex-col md:flex md:w-80 md:flex-none md:border-l md:border-border", mobileView === "details" ? "flex" : "hidden md:flex")}>
        {selectedConversation ? (
          <ContactContextPane
            workspaceId={workspaceId}
            conversation={selectedConversation}
            onBack={() => setMobileView("conversation")}
            onConversationChanged={() => mutate()}
          />
        ) : null}
      </div>
    </div>
  );
}

function ConversationListPane({
  conversations,
  isLoading,
  error,
  onRetry,
  filter,
  onFilterChange,
  selectedConversationId,
  onSelect,
}: {
  conversations: InboxConversation[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  filter: InboxConversationFilter;
  onFilterChange: (filter: InboxConversationFilter) => void;
  selectedConversationId: string | undefined;
  onSelect: (conversation: InboxConversation) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 overflow-x-auto border-b border-border p-2">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onFilterChange(item.value)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === item.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner className="h-5 w-5 text-primary" /></div>
        ) : error ? (
          <div className="p-3"><ErrorState error={error} onRetry={onRetry} /></div>
        ) : conversations.length === 0 ? (
          <div className="p-4"><EmptyState title="Nenhuma conversa" description="Conversas novas aparecem aqui automaticamente." /></div>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-muted/60",
                selectedConversationId === conversation.id && "bg-muted",
              )}
            >
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback>{(conversation.contactName ?? conversation.contactPhone).slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{conversation.contactName ?? conversation.contactPhone}</p>
                  {conversation.lastMessageAt ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(conversation.lastMessageAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {conversation.aiEnabled ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">IA</Badge> : null}
                  {!conversation.assignedUserId ? <span className="text-[11px] text-muted-foreground">Não atribuída</span> : null}
                </div>
              </div>
              {conversation.unreadCount > 0 ? (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {conversation.unreadCount}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ConversationTimelinePane({
  workspaceId,
  conversation,
  onBack,
  onOpenDetails,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  onBack: () => void;
  onOpenDetails: () => void;
}) {
  const { data, isLoading, error, mutate } = useInboxConversationMessages(workspaceId, conversation.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const messages = [...(data?.messages ?? [])].reverse();

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setDraft("");
    try {
      await sendInboxMessage(workspaceId, conversation.id, body);
      await mutate();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Button variant="ghost" className="md:hidden" onClick={onBack}>←</Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{conversation.contactName ?? conversation.contactPhone}</p>
          <p className="text-xs text-muted-foreground">{conversation.contactPhone}</p>
        </div>
        {conversation.aiEnabled ? <Badge variant="secondary">IA ativa</Badge> : null}
        <Button variant="ghost" className="md:hidden" onClick={onOpenDetails}>Detalhes</Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner className="h-5 w-5 text-primary" /></div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : messages.length === 0 ? (
          <EmptyState title="Nenhuma mensagem ainda" description="Envie a primeira mensagem para começar a conversa." />
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Digite uma mensagem..."
          className="min-h-[42px] flex-1 resize-none"
          rows={1}
        />
        <Button onClick={handleSend} disabled={sending || !draft.trim()}>Enviar</Button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: InboxMessage }) {
  const isOutbound = message.direction === "outbound";
  const senderLabel = message.sentByAi ? "Enviado pela IA" : message.sentByAutomation ? "Automação" : isOutbound ? "Atendente" : undefined;
  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[75%] rounded-2xl px-3 py-2 text-sm", isOutbound ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
        {senderLabel ? <p className="mb-0.5 text-[10px] font-medium opacity-70">{senderLabel}</p> : null}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className="mt-1 text-right text-[10px] opacity-60">
          {new Date(message.sentAt ?? message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          {isOutbound ? ` · ${statusLabel(message.status)}` : ""}
        </p>
      </div>
    </div>
  );
}

function statusLabel(status: InboxMessage["status"]): string {
  switch (status) {
    case "queued": return "enviando";
    case "sending": return "enviando";
    case "sent": return "enviado";
    case "delivered": return "entregue";
    case "read": return "lido";
    case "failed": return "falhou";
    default: return status;
  }
}

function ContactContextPane({
  workspaceId,
  conversation,
  onBack,
  onConversationChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  onBack: () => void;
  onConversationChanged: () => void;
}) {
  const { state } = useAuth();
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;
  const [busy, setBusy] = useState(false);
  const isAssignedToMe = conversation.assignedUserId === currentUserId;

  async function handleTakeOver() {
    setBusy(true);
    try {
      await takeOverInboxConversation(workspaceId, conversation.id);
      onConversationChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleReleaseAssignment() {
    setBusy(true);
    try {
      await assignInboxConversation(workspaceId, conversation.id, undefined);
      onConversationChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAi(aiEnabled: boolean) {
    setBusy(true);
    try {
      await setInboxConversationAiEnabled(workspaceId, conversation.id, aiEnabled);
      onConversationChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2 md:hidden">
        <Button variant="ghost" onClick={onBack}>← Voltar</Button>
      </div>

      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">{(conversation.contactName ?? conversation.contactPhone).slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <p className="text-sm font-medium text-foreground">{conversation.contactName ?? "Sem nome"}</p>
        <p className="text-xs text-muted-foreground">{conversation.contactPhone}</p>
      </div>

      <section className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Responsável</h3>
        {conversation.assignedUserId ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-foreground">{isAssignedToMe ? "Você" : conversation.assignedUserId}</p>
            <Button variant="secondary" disabled={busy} onClick={handleReleaseAssignment}>Liberar</Button>
          </div>
        ) : (
          <Button disabled={busy} onClick={handleTakeOver}>Assumir conversa</Button>
        )}
      </section>

      <section className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Inteligência artificial</h3>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-foreground">{conversation.aiEnabled ? "IA ativa" : "IA pausada"}</p>
          {conversation.aiEnabled ? (
            <Button variant="secondary" disabled={busy} onClick={() => handleToggleAi(false)}>Pausar IA</Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => handleToggleAi(true)}>Reativar IA</Button>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Status da conversa</h3>
        <p className="text-sm text-foreground capitalize">{conversation.status}</p>
      </section>
    </div>
  );
}
