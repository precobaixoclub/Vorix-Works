"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
  assignInboxConversation,
  closeInboxConversation,
  markInboxConversationRead,
  reopenInboxConversation,
  sendInboxMessage,
  setInboxConversationAiEnabled,
  takeOverInboxConversation,
  transferInboxConversation,
} from "@/features/inbox/api";
import { useInboxConversationEvents, useInboxConversationMessages, useInboxConversations, useInboxMembers, useInboxRealtime } from "@/features/inbox/hooks";
import type { InboxConversation, InboxConversationEvent, InboxConversationFilter, InboxMessage, InboxTenantMember } from "@/features/inbox/types";

const FILTERS: { value: InboxConversationFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "mine", label: "Minhas" },
  { value: "unassigned", label: "Não atribuídas" },
  { value: "unread", label: "Não lidas" },
  { value: "open", label: "Em atendimento" },
  { value: "pending", label: "Pendentes" },
  { value: "resolved", label: "Finalizadas" },
];

/** Resolve um userId para o nome do membro (Fase 5, `GET /v1/inbox/members`) quando disponível;
 * cai para "Você"/id truncado quando `members` ainda não carregou ou o id não pertence ao tenant
 * (nunca deveria acontecer, mas evita quebrar a UI). */
function agentLabel(userId: string | undefined, currentUserId: string | undefined, members: readonly InboxTenantMember[]): string {
  if (!userId) return "Ninguém";
  if (userId === currentUserId) return "Você";
  const member = members.find((m) => m.userId === userId);
  if (member) return member.name;
  return userId.length > 10 ? `${userId.slice(0, 8)}…` : userId;
}

/** Fase 5 — motivo de a IA estar pausada, mostrado discretamente no painel "Atendimento". */
function aiPauseReasonLabel(reason: NonNullable<InboxConversation["aiPausedReason"]>): string {
  switch (reason) {
    case "human_takeover": return "Pausada automaticamente — um atendente assumiu a conversa";
    case "manual": return "Pausada manualmente por um atendente";
    default: return "";
  }
}

function statusLabelFor(status: InboxConversation["status"]): string {
  switch (status) {
    case "open": return "Em atendimento";
    case "pending": return "Pendente";
    case "resolved": return "Finalizada";
    case "archived": return "Arquivada";
    default: return status;
  }
}

type MobileView = "list" | "conversation" | "details";

/**
 * Inbox do módulo Conversas — Fase 3. Desktop: 3 colunas simultâneas (lista, timeline,
 * contato/CRM). Mobile: uma coluna por vez (`MobileView`), nunca as três juntas — ver
 * `web/CLAUDE.md`/design system.
 */
export function InboxTab({ workspaceId }: { workspaceId: string }) {
  const { state } = useAuth();
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;
  const [filter, setFilter] = useState<InboxConversationFilter>("all");
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [mobileView, setMobileView] = useState<MobileView>("list");

  useInboxRealtime(workspaceId, selectedConversationId);

  const { data, isLoading, error, mutate } = useInboxConversations(workspaceId, filter);
  const { data: membersData } = useInboxMembers(workspaceId);
  const members = membersData?.members ?? [];
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
          currentUserId={currentUserId}
          members={members}
        />
      </div>

      <div className={cn("min-w-0 flex-1 flex-col", mobileView === "conversation" ? "flex" : "hidden md:flex")}>
        {selectedConversation ? (
          <ConversationTimelinePane
            workspaceId={workspaceId}
            conversation={selectedConversation}
            currentUserId={currentUserId}
            members={members}
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
            members={members}
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
  currentUserId,
  members,
}: {
  conversations: InboxConversation[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  filter: InboxConversationFilter;
  onFilterChange: (filter: InboxConversationFilter) => void;
  selectedConversationId: string | undefined;
  onSelect: (conversation: InboxConversation) => void;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
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
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{statusLabelFor(conversation.status)}</Badge>
                  {conversation.assignedUserId ? (
                    <Badge variant="info" className="px-1.5 py-0 text-[10px]">Atendimento humano</Badge>
                  ) : conversation.aiEnabled ? (
                    <Badge variant="accent" className="px-1.5 py-0 text-[10px]">IA ativa</Badge>
                  ) : (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">IA pausada</Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">{agentLabel(conversation.assignedUserId, currentUserId, members)}</span>
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

type TimelineEntry = { kind: "message"; at: string; message: InboxMessage } | { kind: "event"; at: string; event: InboxConversationEvent };

function ConversationTimelinePane({
  workspaceId,
  conversation,
  currentUserId,
  members,
  onBack,
  onOpenDetails,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
  onBack: () => void;
  onOpenDetails: () => void;
}) {
  const { data, isLoading, error, mutate } = useInboxConversationMessages(workspaceId, conversation.id);
  const { data: eventsData } = useInboxConversationEvents(workspaceId, conversation.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const messages = [...(data?.messages ?? [])].reverse();
  const events = eventsData?.events ?? [];
  const timeline: TimelineEntry[] = [
    ...messages.map((message): TimelineEntry => ({ kind: "message", at: message.sentAt ?? message.createdAt, message })),
    ...events.map((event): TimelineEntry => ({ kind: "event", at: event.createdAt, event })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

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
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{conversation.contactName ?? conversation.contactPhone}</p>
          <p className="text-xs text-muted-foreground">{conversation.contactPhone}</p>
        </div>
        {conversation.assignedUserId ? (
          <Badge variant="info">Atendimento humano</Badge>
        ) : conversation.aiEnabled ? (
          <Badge variant="accent">IA ativa</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">IA pausada</Badge>
        )}
        <Button variant="ghost" className="md:hidden" onClick={onOpenDetails}>Detalhes</Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner className="h-5 w-5 text-primary" /></div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : timeline.length === 0 ? (
          <EmptyState title="Nenhuma mensagem ainda" description="Envie a primeira mensagem para começar a conversa." />
        ) : (
          <div className="flex flex-col gap-2">
            {timeline.map((entry) =>
              entry.kind === "message" ? (
                <MessageBubble key={`msg-${entry.message.id}`} message={entry.message} />
              ) : (
                <EventPill key={`evt-${entry.event.id}`} event={entry.event} currentUserId={currentUserId} members={members} />
              ),
            )}
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
        <Button onClick={handleSend} loading={sending} disabled={sending || !draft.trim()}>Enviar</Button>
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

/** Fase 4/5 — evento operacional discreto, renderizado como um "pill" central na timeline. NUNCA
 * é uma mensagem enviada ao WhatsApp — só reflete uma mudança de estado do atendimento (humano ou,
 * na Fase 5, da IA). */
function EventPill({ event, currentUserId, members }: { event: InboxConversationEvent; currentUserId: string | undefined; members: readonly InboxTenantMember[] }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
        {eventLabel(event, currentUserId, members)} · {new Date(event.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

function eventLabel(event: InboxConversationEvent, currentUserId: string | undefined, members: readonly InboxTenantMember[]): string {
  const by = agentLabel(event.performedBy, currentUserId, members);
  switch (event.type) {
    case "took_over":
      return `${by} assumiu o atendimento`;
    case "assigned":
      return `${by} atribuiu a conversa a ${agentLabel(event.toUserId, currentUserId, members)}`;
    case "unassigned":
      return `${by} removeu ${agentLabel(event.fromUserId, currentUserId, members)} do atendimento`;
    case "transferred":
      return `${by} transferiu a conversa de ${agentLabel(event.fromUserId, currentUserId, members)} para ${agentLabel(event.toUserId, currentUserId, members)}`;
    case "status_changed":
      if (event.toStatus === "resolved") return `${by} finalizou o atendimento`;
      if (event.toStatus === "open") return `${by} reabriu a conversa`;
      return `${by} mudou o status para ${event.toStatus ? statusLabelFor(event.toStatus) : "—"}`;
    case "ai_paused":
      return "IA pausada";
    case "ai_resumed":
      return "IA reativada";
    case "ai_response_sent":
      return "IA respondeu automaticamente";
    case "ai_response_failed":
      return "IA não conseguiu gerar uma resposta (falha temporária)";
    case "ai_response_cancelled":
      return "Resposta da IA cancelada — um atendente assumiu a conversa";
    default:
      return "Atendimento atualizado";
  }
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
  members,
  onBack,
  onConversationChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  members: readonly InboxTenantMember[];
  onBack: () => void;
  onConversationChanged: () => void;
}) {
  const { state } = useAuth();
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [transferTarget, setTransferTarget] = useState("");
  const isAssignedToMe = conversation.assignedUserId === currentUserId;
  const isResolved = conversation.status === "resolved";
  const transferOptions = members.filter((member) => member.userId !== conversation.assignedUserId).map((member) => ({ id: member.userId, label: `${member.name} · ${member.email}` }));

  async function runAction(action: () => Promise<InboxConversation>) {
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      onConversationChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy(false);
    }
  }

  function handleTakeOver() {
    return runAction(() => takeOverInboxConversation(workspaceId, conversation.id));
  }

  function handleReleaseAssignment() {
    return runAction(() => assignInboxConversation(workspaceId, conversation.id, undefined));
  }

  function handleTransfer() {
    if (!transferTarget) return;
    return runAction(() => transferInboxConversation(workspaceId, conversation.id, transferTarget)).then(() => setTransferTarget(""));
  }

  function handleToggleAi(aiEnabled: boolean) {
    return runAction(() => setInboxConversationAiEnabled(workspaceId, conversation.id, aiEnabled));
  }

  function handleClose() {
    return runAction(() => closeInboxConversation(workspaceId, conversation.id));
  }

  function handleReopen() {
    return runAction(() => reopenInboxConversation(workspaceId, conversation.id));
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

      {actionError ? (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</div>
      ) : null}

      <section className="mb-4 border-b border-border pb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Atendimento</h3>

        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] text-muted-foreground">Responsável</p>
            <p className="text-sm text-foreground">{agentLabel(conversation.assignedUserId, currentUserId, members)}</p>
          </div>
          <div className="flex gap-1.5">
            {!isAssignedToMe ? (
              <Button variant="secondary" loading={busy} disabled={busy} onClick={handleTakeOver}>{conversation.assignedUserId ? "Assumir" : "Assumir conversa"}</Button>
            ) : null}
            {conversation.assignedUserId ? (
              <Button variant="secondary" disabled={busy} onClick={handleReleaseAssignment}>Liberar</Button>
            ) : null}
          </div>
        </div>

        {conversation.assignedUserId ? (
          <div className="mb-3">
            <p className="mb-1 text-[11px] text-muted-foreground">Transferir para</p>
            <div className="flex gap-1.5">
              <SearchableCombo
                items={transferOptions}
                value={transferTarget}
                onValueChange={setTransferTarget}
                placeholder="Escolher atendente"
                searchPlaceholder="Buscar por nome ou e-mail..."
                emptyText="Nenhum outro membro encontrado."
                disabled={busy}
                className="min-w-0 flex-1"
              />
              <Button variant="secondary" disabled={busy || !transferTarget} onClick={handleTransfer}>Transferir</Button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] text-muted-foreground">Status</p>
            <p className="text-sm text-foreground">{statusLabelFor(conversation.status)}</p>
          </div>
          {isResolved ? (
            <Button variant="secondary" disabled={busy} onClick={handleReopen}>Reabrir</Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={handleClose}>Finalizar</Button>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Inteligência artificial</h3>
        <div className="flex items-center justify-between gap-2">
          <div>
            {/* Fase 7 — achado de auditoria: atribuição DIRETA (Fase 4, `assign()`) nunca desliga
             * `aiEnabled` no banco, então mostrar só `aiEnabled` aqui podia dizer "IA ativa" numa
             * conversa que JAMAIS recebe resposta automática enquanto tiver responsável (o gate
             * real, `isConversationEligibleForAi`, sempre checa `assignedUserId` primeiro). */}
            <p className="text-sm text-foreground">
              {conversation.assignedUserId ? "IA não responde (atendimento humano ativo)" : conversation.aiEnabled ? "IA ativa" : "IA pausada"}
            </p>
            {conversation.assignedUserId ? (
              <p className="text-[11px] text-muted-foreground">Volta a responder automaticamente só depois que o responsável for liberado.</p>
            ) : !conversation.aiEnabled && conversation.aiPausedReason ? (
              <p className="text-[11px] text-muted-foreground">{aiPauseReasonLabel(conversation.aiPausedReason)}</p>
            ) : null}
          </div>
          {conversation.aiEnabled ? (
            <Button variant="secondary" disabled={busy} onClick={() => handleToggleAi(false)}>Pausar IA</Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => handleToggleAi(true)}>Reativar IA</Button>
          )}
        </div>
      </section>
    </div>
  );
}
