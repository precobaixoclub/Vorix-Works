"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  Paperclip,
  PauseCircle,
  Search,
  Send,
  Sparkles,
  UserCheck,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Input } from "@/components/Field";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";
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
import { CrmContextSection } from "./crm-panel";

const QUICK_FILTERS: { value: InboxConversationFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "mine", label: "Minhas" },
  { value: "unread", label: "Nao lidas" },
];

const ADVANCED_FILTERS: { value: InboxConversationFilter; label: string; description: string }[] = [
  { value: "open", label: "Em atendimento", description: "Conversas abertas agora." },
  { value: "pending", label: "Pendentes", description: "Aguardando retorno ou decisao." },
  { value: "resolved", label: "Finalizadas", description: "Atendimentos encerrados." },
  { value: "unassigned", label: "Sem responsável", description: "Fila livre para assumir." },
];

type MobileView = "list" | "conversation";
type TimelineEntry = { kind: "message"; at: string; message: InboxMessage } | { kind: "event"; at: string; event: InboxConversationEvent };

export function InboxTab({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { state } = useAuth();
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;
  const [filter, setFilter] = useState<InboxConversationFilter>("all");
  const [search, setSearch] = useState("");
  const [mobileView, setMobileView] = useState<MobileView>(searchParams.get("conversation") ? "conversation" : "list");
  const [contextOpen, setContextOpen] = useState(false);
  const [contextPinned, setContextPinned] = useState(false);

  const selectedConversationId = searchParams.get("conversation") ?? undefined;

  useInboxRealtime(workspaceId, selectedConversationId);

  const { data, isLoading, error, mutate } = useInboxConversations(workspaceId, filter);
  const { data: membersData } = useInboxMembers(workspaceId);
  const members = membersData?.members ?? [];
  const conversations = data?.conversations ?? [];
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conversation) => {
      const haystack = [
        conversation.contactName,
        conversation.contactPhone,
        statusLabelFor(conversation.status),
        agentLabel(conversation.assignedUserId, currentUserId, members),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [conversations, currentUserId, members, search]);

  useEffect(() => {
    if (selectedConversationId) setMobileView("conversation");
  }, [selectedConversationId]);

  function setSelectedConversationId(conversationId: string | undefined) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (conversationId) nextParams.set("conversation", conversationId);
    else nextParams.delete("conversation");
    const query = nextParams.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function handleSelect(conversation: InboxConversation) {
    setSelectedConversationId(conversation.id);
    setMobileView("conversation");
    setContextOpen(false);
    if (conversation.unreadCount > 0) {
      markInboxConversationRead(workspaceId, conversation.id)
        .then(() => mutate())
        .catch(() => undefined);
    }
  }

  return (
    <div className="relative min-h-[620px] overflow-hidden rounded-xl border border-border bg-card shadow-sm md:h-[calc(100dvh-13rem)]">
      <div
        className={cn(
          "grid h-full min-h-0",
          contextOpen && contextPinned ? "xl:grid-cols-[320px_minmax(0,1fr)_380px]" : "md:grid-cols-[320px_minmax(0,1fr)]",
        )}
      >
        <div className={cn("min-h-0 border-border md:block md:border-r", mobileView === "list" ? "block" : "hidden")}>
          <ConversationListPane
            conversations={filteredConversations}
            totalConversations={conversations.length}
            isLoading={isLoading}
            error={error}
            onRetry={() => mutate()}
            filter={filter}
            onFilterChange={setFilter}
            search={search}
            onSearchChange={setSearch}
            selectedConversationId={selectedConversationId}
            onSelect={handleSelect}
            currentUserId={currentUserId}
            members={members}
          />
        </div>

        <div className={cn("min-h-0 min-w-0", mobileView === "conversation" ? "block" : "hidden md:block")}>
          {selectedConversation ? (
            <ConversationTimelinePane
              workspaceId={workspaceId}
              conversation={selectedConversation}
              currentUserId={currentUserId}
              members={members}
              onBack={() => {
                setSelectedConversationId(undefined);
                setMobileView("list");
              }}
              onOpenContext={() => setContextOpen(true)}
              onConversationChanged={() => mutate()}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState title="Selecione uma conversa" description="Escolha uma conversa para abrir o histórico e o contexto comercial." />
            </div>
          )}
        </div>

        {contextOpen && contextPinned && selectedConversation ? (
          <div className="hidden min-h-0 border-l border-border xl:block">
            <ContactContextPane
              workspaceId={workspaceId}
              conversation={selectedConversation}
              members={members}
              onClose={() => setContextOpen(false)}
              contextPinned={contextPinned}
              onPinnedChange={setContextPinned}
              onConversationChanged={() => mutate()}
            />
          </div>
        ) : null}
      </div>

      {contextOpen && selectedConversation && !contextPinned ? (
        <div className="absolute inset-0 z-20 flex justify-end bg-background/55 backdrop-blur-[2px]">
          <div className="h-full w-full border-l border-border bg-card shadow-2xl sm:w-[390px]">
            <ContactContextPane
              workspaceId={workspaceId}
              conversation={selectedConversation}
              members={members}
              onClose={() => setContextOpen(false)}
              contextPinned={contextPinned}
              onPinnedChange={setContextPinned}
              onConversationChanged={() => mutate()}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConversationListPane({
  conversations,
  totalConversations,
  isLoading,
  error,
  onRetry,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  selectedConversationId,
  onSelect,
  currentUserId,
  members,
}: {
  conversations: InboxConversation[];
  totalConversations: number;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  filter: InboxConversationFilter;
  onFilterChange: (filter: InboxConversationFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedConversationId: string | undefined;
  onSelect: (conversation: InboxConversation) => void;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
}) {
  const activeAdvancedFilter = ADVANCED_FILTERS.find((item) => item.value === filter);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="space-y-3 border-b border-border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Fila viva</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">Atendimento</p>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{totalConversations}</span>
        </div>

        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar conversa"
            className="h-9 pl-8"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {QUICK_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onFilterChange(item.value)}
              className={cn(
                "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition-colors duration-150",
                filter === item.value ? "bg-primary text-primary-foreground dark:bg-primary-glow dark:text-background" : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {item.label}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition-colors duration-150",
                  activeAdvancedFilter ? "bg-ai-soft text-ai dark:bg-ai/15 dark:text-ai-glow" : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {activeAdvancedFilter?.label ?? "Filtros"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <div className="space-y-1">
                {ADVANCED_FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => onFilterChange(item.value)}
                    className={cn(
                      "flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors",
                      filter === item.value ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs">{item.description}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <ConversationListSkeleton />
        ) : error ? (
          <div className="p-3"><ErrorState error={error} onRetry={onRetry} /></div>
        ) : conversations.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={search ? "Nenhuma conversa encontrada" : "Nenhuma conversa"}
              description={search ? "Ajuste a busca ou limpe os filtros para ver a fila completa." : "Conversas novas aparecem aqui automaticamente."}
            />
          </div>
        ) : (
          conversations.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              selected={selectedConversationId === conversation.id}
              currentUserId={currentUserId}
              members={members}
              onSelect={() => onSelect(conversation)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ConversationListItem({
  conversation,
  selected,
  currentUserId,
  members,
  onSelect,
}: {
  conversation: InboxConversation;
  selected: boolean;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors duration-150 hover:bg-muted/50",
        selected && "bg-muted/80",
      )}
    >
      <Avatar className="h-10 w-10 shrink-0 rounded-xl">
        <AvatarFallback className="rounded-xl bg-muted text-xs font-semibold text-foreground">
          {initials(conversation.contactName ?? conversation.contactPhone)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("truncate text-sm text-foreground", conversation.unreadCount > 0 ? "font-semibold" : "font-medium")}>
            {conversation.contactName ?? conversation.contactPhone}
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeLabel(conversation.lastMessageAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">WhatsApp · {conversation.contactPhone}</p>
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/80">{conversation.lastMessageAt ? "Última interação registrada." : "Sem mensagens recentes."}</p>
        <div className="mt-2 flex min-w-0 items-center gap-1.5">
          <StatusDot status={conversation.status} />
          <span className="truncate text-[11px] text-muted-foreground">{agentLabel(conversation.assignedUserId, currentUserId, members)}</span>
          <AiStateBadge conversation={conversation} compact />
          {conversation.unreadCount > 0 ? (
            <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground dark:bg-primary-glow dark:text-background">
              {conversation.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ConversationTimelinePane({
  workspaceId,
  conversation,
  currentUserId,
  members,
  onBack,
  onOpenContext,
  onConversationChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
  onBack: () => void;
  onOpenContext: () => void;
  onConversationChanged: () => Promise<unknown> | void;
}) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.role : undefined;
  const canOperate = canOperateWorkspace(role);
  const { data, isLoading, error, mutate } = useInboxConversationMessages(workspaceId, conversation.id);
  const { data: eventsData, mutate: mutateEvents } = useInboxConversationEvents(workspaceId, conversation.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [failedDraft, setFailedDraft] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [transferTarget, setTransferTarget] = useState("");

  const messages = [...(data?.messages ?? [])].reverse();
  const events = eventsData?.events ?? [];
  const timeline: TimelineEntry[] = [
    ...messages.map((message): TimelineEntry => ({ kind: "message", at: message.sentAt ?? message.createdAt, message })),
    ...events.map((event): TimelineEntry => ({ kind: "event", at: event.createdAt, event })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const isAssignedToMe = conversation.assignedUserId === currentUserId;
  const isResolved = conversation.status === "resolved";
  const transferOptions = members.filter((member) => member.userId !== conversation.assignedUserId).map((member) => ({ id: member.userId, label: `${member.name} · ${member.email}` }));

  async function refreshThread() {
    await Promise.all([mutate(), mutateEvents(), onConversationChanged()]);
  }

  async function runAction(key: string, action: () => Promise<InboxConversation>) {
    if (!canOperate) return;
    setBusyAction(key);
    setActionError(undefined);
    try {
      await action();
      if (key === "transfer") setTransferTarget("");
      await refreshThread();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível concluir a ação.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleSend(bodyFromRetry?: string) {
    if (!canOperate) return;
    const body = (bodyFromRetry ?? draft).trim();
    if (!body) return;
    setSending(true);
    setSendError(undefined);
    try {
      await sendInboxMessage(workspaceId, conversation.id, body);
      setDraft((current) => (current.trim() === body ? "" : current));
      setFailedDraft(undefined);
      await refreshThread();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível enviar a mensagem.";
      setDraft((current) => (current.trim() ? current : body));
      setFailedDraft(body);
      setSendError(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border bg-card px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Voltar para a lista">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar className="h-10 w-10 shrink-0 rounded-xl">
            <AvatarFallback className="rounded-xl bg-primary/10 text-xs font-semibold text-primary dark:bg-primary-glow/10 dark:text-primary-glow">
              {initials(conversation.contactName ?? conversation.contactPhone)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{conversation.contactName ?? conversation.contactPhone}</p>
              <StatusDot status={conversation.status} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              WhatsApp · {conversation.contactPhone} · {statusLabelFor(conversation.status)} · {agentLabel(conversation.assignedUserId, currentUserId, members)}
            </p>
          </div>

          <div className="hidden items-center gap-1.5 lg:flex">
            {!isAssignedToMe && !isResolved ? (
              <GuardedButton
                size="sm"
                variant="secondary"
                allowed={canOperate}
                blockedReason={RBAC_COPY.operateConversations}
                loading={busyAction === "take-over"}
                disabled={Boolean(busyAction)}
                onClick={() => runAction("take-over", () => takeOverInboxConversation(workspaceId, conversation.id))}
              >
                <UserCheck className="h-3.5 w-3.5" />
                Assumir
              </GuardedButton>
            ) : null}
            <GuardedButton
              size="sm"
              variant="secondary"
              allowed={canOperate}
              blockedReason={RBAC_COPY.operateConversations}
              loading={busyAction === "status"}
              disabled={Boolean(busyAction)}
              onClick={() => runAction("status", () => (isResolved ? reopenInboxConversation(workspaceId, conversation.id) : closeInboxConversation(workspaceId, conversation.id)))}
            >
              {isResolved ? "Reabrir" : "Finalizar"}
            </GuardedButton>
          </div>

          <ConversationActionsMenu
            canOperate={canOperate}
            conversation={conversation}
            workspaceId={workspaceId}
            busyAction={busyAction}
            transferTarget={transferTarget}
            transferOptions={transferOptions}
            onTransferTargetChange={setTransferTarget}
            onRunAction={runAction}
            onOpenContext={onOpenContext}
          />

          <Button variant="ghost" size="sm" onClick={onOpenContext}>
            Detalhes
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AiStateBadge conversation={conversation} />
          {actionError ? <span className="text-xs text-destructive">{actionError}</span> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {isLoading ? (
            <MessageSkeleton />
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : timeline.length === 0 ? (
            <EmptyState title="Nenhuma mensagem ainda" description="Envie a primeira mensagem para comecar a conversa." />
          ) : (
            timeline.map((entry) =>
              entry.kind === "message" ? (
                <MessageBubble key={`msg-${entry.message.id}`} message={entry.message} onRetry={(body) => handleSend(body)} retrying={sending} />
              ) : (
                <EventPill key={`evt-${entry.event.id}`} event={entry.event} currentUserId={currentUserId} members={members} />
              ),
            )
          )}
          {conversation.aiEnabled && !conversation.assignedUserId && conversation.status === "open" ? (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-ai dark:text-ai-glow">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai dark:bg-ai-glow" aria-hidden="true" />
              Vorix Intelligence monitorando a conversa
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border bg-card px-3 py-3">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {sendError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{sendError}</span>
              {failedDraft ? (
                <Button variant="secondary" size="sm" loading={sending} onClick={() => handleSend(failedDraft)}>
                  Tentar novamente
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button type="button" variant="ghost" size="icon" disabled aria-label="Anexos indisponiveis">
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Este canal aceita apenas texto nesta versao.</TooltipContent>
            </Tooltip>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={canOperate ? "Digite uma mensagem..." : "Seu papel permite visualizar, mas não operar esta conversa."}
              className="max-h-36 min-h-[42px] flex-1 resize-none"
              rows={1}
              disabled={!canOperate || sending}
            />
            <GuardedButton
              onClick={() => handleSend()}
              loading={sending}
              disabled={sending || !draft.trim()}
              allowed={canOperate}
              blockedReason={RBAC_COPY.operateConversations}
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Enviar</span>
            </GuardedButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationActionsMenu({
  canOperate,
  conversation,
  workspaceId,
  busyAction,
  transferTarget,
  transferOptions,
  onTransferTargetChange,
  onRunAction,
  onOpenContext,
}: {
  canOperate: boolean;
  conversation: InboxConversation;
  workspaceId: string;
  busyAction: string | undefined;
  transferTarget: string;
  transferOptions: readonly { id: string; label: string }[];
  onTransferTargetChange: (value: string) => void;
  onRunAction: (key: string, action: () => Promise<InboxConversation>) => void;
  onOpenContext: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Mais ações">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ações</p>
          <p className="mt-1 text-xs text-muted-foreground">Comandos secundarios ficam aqui para manter a conversa limpa.</p>
        </div>

        <div className="space-y-2">
          <GuardedButton
            variant="secondary"
            className="w-full justify-start"
            allowed={canOperate}
            blockedReason={RBAC_COPY.operateConversations}
            disabled={Boolean(busyAction) || !conversation.assignedUserId}
            loading={busyAction === "release"}
            onClick={() => onRunAction("release", () => assignInboxConversation(workspaceId, conversation.id, undefined))}
          >
            Liberar atendimento
          </GuardedButton>
          <GuardedButton
            variant="secondary"
            className="w-full justify-start"
            allowed={canOperate}
            blockedReason={RBAC_COPY.operateConversations}
            disabled={Boolean(busyAction)}
            loading={busyAction === "ai"}
            onClick={() => onRunAction("ai", () => setInboxConversationAiEnabled(workspaceId, conversation.id, !conversation.aiEnabled))}
          >
            {conversation.aiEnabled ? "Pausar IA" : "Reativar IA"}
          </GuardedButton>
          <Button variant="ghost" className="w-full justify-start" onClick={onOpenContext}>
            Ver historico e CRM
          </Button>
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-1.5 text-xs font-medium text-foreground">Transferir para</p>
          <div className="flex gap-2">
            <SearchableCombo
              items={transferOptions}
              value={transferTarget}
              onValueChange={onTransferTargetChange}
              placeholder="Atendente"
              searchPlaceholder="Buscar membro..."
              emptyText="Nenhum outro membro."
              disabled={!canOperate || Boolean(busyAction)}
              className="min-w-0 flex-1"
            />
            <GuardedButton
              variant="secondary"
              allowed={canOperate}
              blockedReason={RBAC_COPY.operateConversations}
              disabled={Boolean(busyAction) || !transferTarget}
              loading={busyAction === "transfer"}
              onClick={() => onRunAction("transfer", () => transferInboxConversation(workspaceId, conversation.id, transferTarget))}
            >
              OK
            </GuardedButton>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MessageBubble({ message, onRetry, retrying }: { message: InboxMessage; onRetry: (body: string) => void; retrying: boolean }) {
  const isOutbound = message.direction === "outbound";
  const senderLabel = message.sentByAi ? "Vorix IA" : message.sentByAutomation ? "Automacao" : isOutbound ? "Atendente" : undefined;
  const body = message.body?.trim();
  const failed = isOutbound && message.status === "failed";

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(78%,42rem)] rounded-xl border px-3 py-2 text-sm shadow-sm",
          isOutbound
            ? failed
              ? "border-destructive/40 bg-destructive/10 text-foreground"
              : "border-primary/20 bg-primary text-primary-foreground dark:bg-primary-glow dark:text-background"
            : "border-border bg-card text-foreground",
        )}
      >
        {senderLabel ? <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{senderLabel}</p> : null}
        {body ? <p className="whitespace-pre-wrap break-words">{body}</p> : <MessageMediaPreview message={message} />}
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2 text-[10px] opacity-70">
          <span className="tabular-nums">{timeLabel(message.sentAt ?? message.createdAt)}</span>
          {isOutbound ? <span>{messageStatusLabel(message.status)}</span> : null}
        </div>
        {failed && body ? (
          <div className="mt-2 flex justify-end">
            <Button variant="secondary" size="sm" loading={retrying} onClick={() => onRetry(body)}>
              Tentar novamente
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageMediaPreview({ message }: { message: InboxMessage }) {
  const Icon = mediaIconFor(message.type);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/70 px-3 py-2 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-xs">{mediaLabelFor(message.type)}</span>
    </div>
  );
}

function EventPill({ event, currentUserId, members }: { event: InboxConversationEvent; currentUserId: string | undefined; members: readonly InboxTenantMember[] }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full border border-border bg-card px-3 py-1 text-center text-[11px] text-muted-foreground shadow-sm">
        {eventLabel(event, currentUserId, members)} · {timeLabel(event.createdAt)}
      </span>
    </div>
  );
}

function ContactContextPane({
  workspaceId,
  conversation,
  members,
  onClose,
  contextPinned,
  onPinnedChange,
  onConversationChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  members: readonly InboxTenantMember[];
  onClose: () => void;
  contextPinned: boolean;
  onPinnedChange: (value: boolean) => void;
  onConversationChanged: () => void;
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Contexto</p>
          <p className="truncate text-sm font-semibold text-foreground">{conversation.contactName ?? "Contato sem nome"}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="hidden xl:inline-flex" onClick={() => onPinnedChange(!contextPinned)}>
            {contextPinned ? "Soltar" : "Fixar"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar detalhes">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center gap-3">
          <Avatar className="h-12 w-12 rounded-xl">
            <AvatarFallback className="rounded-xl bg-primary/10 text-sm font-semibold text-primary dark:bg-primary-glow/10 dark:text-primary-glow">
              {initials(conversation.contactName ?? conversation.contactPhone)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{conversation.contactName ?? "Sem nome"}</p>
            <p className="truncate text-xs text-muted-foreground">{conversation.contactPhone}</p>
            <p className="truncate text-xs text-muted-foreground">WhatsApp</p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <p className="text-muted-foreground">Responsável</p>
            <p className="mt-0.5 truncate font-medium text-foreground">{agentLabel(conversation.assignedUserId, undefined, members)}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <p className="text-muted-foreground">Status</p>
            <p className="mt-0.5 truncate font-medium text-foreground">{statusLabelFor(conversation.status)}</p>
          </div>
        </div>

        {conversation.crmContactId ? (
          <Link href={`/workspaces/${workspaceId}/contacts`} className="mb-4 inline-flex text-xs font-medium text-primary hover:underline dark:text-primary-glow">
            Abrir contato completo
          </Link>
        ) : null}

        <CrmContextSection workspaceId={workspaceId} conversation={conversation} members={members} onLinked={onConversationChanged} />
      </div>
    </aside>
  );
}

function AiStateBadge({ conversation, compact = false }: { conversation: InboxConversation; compact?: boolean }) {
  if (conversation.assignedUserId) {
    return (
      <Badge variant="info" className={cn("gap-1 border-transparent", compact && "px-1.5 py-0 text-[10px]")}>
        <PauseCircle className="h-3 w-3" />
        Humano
      </Badge>
    );
  }
  if (conversation.aiEnabled) {
    return (
      <Badge variant="accent" className={cn("gap-1 border-transparent", compact && "px-1.5 py-0 text-[10px]")}>
        <Sparkles className="h-3 w-3" />
        IA ativa
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("gap-1 text-muted-foreground", compact && "px-1.5 py-0 text-[10px]")}>
      <Bot className="h-3 w-3" />
      IA pausada
    </Badge>
  );
}

function StatusDot({ status }: { status: InboxConversation["status"] }) {
  const classes: Record<InboxConversation["status"], string> = {
    open: "bg-primary dark:bg-primary-glow",
    pending: "bg-warning",
    resolved: "bg-success",
    archived: "bg-muted-foreground",
  };
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", classes[status])} title={statusLabelFor(status)} />;
}

function ConversationListSkeleton() {
  return (
    <div className="divide-y divide-border/60">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-3 py-3">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-14 w-2/3 animate-pulse rounded-xl bg-muted" />
      <div className="ml-auto h-16 w-3/4 animate-pulse rounded-xl bg-muted" />
      <div className="h-12 w-1/2 animate-pulse rounded-xl bg-muted" />
      <div className="ml-auto h-20 w-2/3 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function agentLabel(userId: string | undefined, currentUserId: string | undefined, members: readonly InboxTenantMember[]): string {
  if (!userId) return "Sem responsável";
  if (userId === "ai") return "Vorix";
  if (userId === currentUserId) return "Voce";
  const member = members.find((item) => item.userId === userId);
  if (member) return member.name;
  return userId.length > 10 ? `${userId.slice(0, 8)}...` : userId;
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

function messageStatusLabel(status: InboxMessage["status"]): string {
  switch (status) {
    case "queued": return "Enviando";
    case "sending": return "Enviando";
    case "sent": return "Enviado";
    case "delivered": return "Entregue";
    case "read": return "Lido";
    case "failed": return "Falhou";
    default: return status;
  }
}

function eventLabel(event: InboxConversationEvent, currentUserId: string | undefined, members: readonly InboxTenantMember[]): string {
  const by = agentLabel(event.performedBy, currentUserId, members);
  switch (event.type) {
    case "took_over":
      return `${by} assumiu o atendimento`;
    case "assigned":
      return `${by} atribuiu a conversa a ${agentLabel(event.toUserId, currentUserId, members)}`;
    case "unassigned":
      return `${by} liberou o atendimento`;
    case "transferred":
      return `${by} transferiu para ${agentLabel(event.toUserId, currentUserId, members)}`;
    case "status_changed":
      return event.toStatus === "resolved" ? `${by} finalizou o atendimento` : `${by} mudou para ${event.toStatus ? statusLabelFor(event.toStatus) : "--"}`;
    case "ai_paused":
      return "IA pausada";
    case "ai_resumed":
      return "IA reativada";
    case "ai_response_sent":
      return "Vorix respondeu automaticamente";
    case "ai_response_failed":
      return "Vorix não conseguiu responder";
    case "ai_response_cancelled":
      return "Resposta da IA cancelada";
    default:
      return "Atendimento atualizado";
  }
}

function mediaIconFor(type: InboxMessage["type"]) {
  switch (type) {
    case "image": return ImageIcon;
    case "video": return Video;
    case "audio": return Volume2;
    case "document": return FileText;
    default: return AlertCircle;
  }
}

function mediaLabelFor(type: InboxMessage["type"]): string {
  switch (type) {
    case "image": return "Imagem recebida";
    case "video": return "Video recebido";
    case "audio": return "Audio recebido";
    case "document": return "Documento recebido";
    case "location": return "Localizacao recebida";
    case "contact": return "Contato recebido";
    case "text": return "Mensagem sem texto";
    default: return "Midia recebida";
  }
}

function initials(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "VX";
  const parts = normalized.split(/\s+/).slice(0, 2);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts.map((part) => part[0]).join("").toUpperCase();
}

function timeLabel(iso: string | undefined): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
