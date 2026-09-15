"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  Mic,
  MoreHorizontal,
  Paperclip,
  PauseCircle,
  Search,
  Send,
  Smile,
  Sparkles,
  Square,
  Trash2,
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
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GuardedButton } from "@/components/GuardedButton";
import { Input } from "@/components/Field";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { canManageTenant, canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";
import {
  assignInboxConversation,
  closeInboxConversation,
  deleteInboxConversation,
  markInboxConversationRead,
  reopenInboxConversation,
  sendInboxMediaMessage,
  sendInboxMessage,
  setInboxConversationAiEnabled,
  takeOverInboxConversation,
  transferInboxConversation,
} from "@/features/inbox/api";
import { useInboxConversationEvents, useInboxConversationMessages, useInboxConversations, useInboxMembers, useInboxRealtime } from "@/features/inbox/hooks";
import type { InboxConversation, InboxConversationEvent, InboxConversationFilter, InboxMessage, InboxTenantMember } from "@/features/inbox/types";
import { CrmContextSection } from "./crm-panel";
import { MessageMedia } from "./message-media";

const QUICK_FILTERS: { value: InboxConversationFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "mine", label: "Minhas" },
  { value: "unread", label: "Não lidas" },
];

/** Bloco "Organização da lista" (ver docs/conversas-inbox-organization-media-runtime.md) — filtro
 * por `chatType`, deliberadamente client-side (a lista de um workspace é pequena o bastante pra
 * não justificar mais um parâmetro de servidor/índice novo) — nunca esconde o filtro de status já
 * existente, os dois combinam (ex.: "Não lidas" + "Grupos"). */
const CHAT_TYPE_FILTERS: { value: "all" | "group" | "direct"; label: string }[] = [
  { value: "all", label: "Todos os tipos" },
  { value: "group", label: "Grupos" },
  { value: "direct", label: "Diretas" },
];

const ADVANCED_FILTERS: { value: InboxConversationFilter; label: string; description: string }[] = [
  { value: "open", label: "Em atendimento", description: "Conversas abertas agora." },
  { value: "pending", label: "Pendentes", description: "Aguardando retorno ou decisão." },
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
  const [chatTypeFilter, setChatTypeFilter] = useState<"all" | "group" | "direct">("all");
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
    const byType = chatTypeFilter === "all" ? conversations : conversations.filter((conversation) => conversation.chatType === chatTypeFilter);
    const term = search.trim().toLowerCase();
    if (!term) return byType;
    return byType.filter((conversation) => {
      // Grupo: busca por nome do grupo (groupName/subject) — nunca por LID (seção 34 do pedido:
      // "não buscar por LID como experiência principal"). Direta: nome/telefone, como já era.
      const haystack = [
        conversation.contactName,
        conversation.contactPhone,
        conversation.groupName,
        statusLabelFor(conversation.status),
        agentLabel(conversation.assignedUserId, currentUserId, members),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [chatTypeFilter, conversations, currentUserId, members, search]);

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
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-card">
      <div
        className={cn(
          // `grid-rows-[minmax(0,1fr)]` é o que impede o CSS Grid de fazer a única linha (mobile:
          // 1 coluna implícita; desktop: linha única atrás das colunas explícitas) crescer para
          // caber o conteúdo (`grid-auto-rows` padrão é `auto` = tamanho do conteúdo, ignorando
          // `h-full`/`min-h-0` do item) — sem isso, uma conversa longa empurra a linha (e a página
          // inteira) além da viewport no mobile, mesmo com overflow-y-auto interno correto.
          "grid h-full min-h-0 grid-rows-[minmax(0,1fr)]",
          contextOpen && contextPinned ? "xl:grid-cols-[320px_minmax(0,1fr)_384px]" : "md:grid-cols-[320px_minmax(0,1fr)]",
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
            chatTypeFilter={chatTypeFilter}
            onChatTypeFilterChange={setChatTypeFilter}
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
          <div className="h-full w-full border-l border-border bg-card shadow-2xl sm:w-96">
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
  chatTypeFilter,
  onChatTypeFilterChange,
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
  chatTypeFilter: "all" | "group" | "direct";
  onChatTypeFilterChange: (value: "all" | "group" | "direct") => void;
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

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {CHAT_TYPE_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onChatTypeFilterChange(item.value)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium transition-colors duration-150",
                chatTypeFilter === item.value
                  ? "border-primary/30 bg-primary/10 text-primary dark:border-primary-glow/30 dark:bg-primary-glow/10 dark:text-primary-glow"
                  : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted",
              )}
            >
              {item.label}
            </button>
          ))}
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
          {initials(conversationTitle(conversation))}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("truncate text-sm text-foreground", conversation.unreadCount > 0 ? "font-semibold" : "font-medium")}>
            {conversationTitle(conversation)}
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeLabel(conversation.lastMessageAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{conversationSubtitle(conversation)}</p>
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/80">{lastMessagePreviewLabel(conversation)}</p>
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
  const canDelete = canManageTenant(role);
  const { data, isLoading, error, mutate } = useInboxConversationMessages(workspaceId, conversation.id);
  const { data: eventsData, mutate: mutateEvents } = useInboxConversationEvents(workspaceId, conversation.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [failedDraft, setFailedDraft] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [transferTarget, setTransferTarget] = useState("");
  // Bloco "Composer" (ver docs/conversas-whatsapp-experience-completion.md) — anexo (imagem/vídeo/
  // documento) é um upload+envio próprio, com seu próprio estado de progresso/erro (nunca reusa
  // `sending`/`sendError` do texto — são caminhos independentes que podem estar em voo ao mesmo tempo).
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

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

  /** Exclusão PERMANENTE — nunca "fechar"/"arquivar" (`runAction("status", ...)` acima, reversível).
   * Some da lista pro lado de quem excluiu (`onConversationChanged`) e sai da tela da conversa
   * (`onBack`) — não há mais nada pra mostrar aqui depois disto. */
  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    setActionError(undefined);
    try {
      await deleteInboxConversation(workspaceId, conversation.id);
      setDeleteConfirmOpen(false);
      onBack();
      await onConversationChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível excluir esta conversa.");
    } finally {
      setDeleting(false);
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

  async function handleAttach(file: File) {
    if (!canOperate) return;
    setAttaching(true);
    setAttachError(undefined);
    try {
      await sendInboxMediaMessage(workspaceId, conversation.id, file);
      await refreshThread();
    } catch (cause) {
      setAttachError(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.");
    } finally {
      setAttaching(false);
    }
  }

  async function handleSendVoiceNote(blob: Blob) {
    if (!canOperate) return;
    setAttaching(true);
    setAttachError(undefined);
    try {
      const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      await sendInboxMediaMessage(workspaceId, conversation.id, blob, { fileName: `audio-${Date.now()}.${extension}` });
      await refreshThread();
    } catch (cause) {
      setAttachError(cause instanceof Error ? cause.message : "Não foi possível enviar o áudio.");
    } finally {
      setAttaching(false);
    }
  }

  /** Insere na posição do CURSOR (nunca só no final) — comportamento esperado de um seletor de
   * emoji num campo de texto (ver seção 18 do pedido original). */
  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraft((current) => current + emoji);
      return;
    }
    const start = textarea.selectionStart ?? draft.length;
    const end = textarea.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + emoji.length;
      textarea.setSelectionRange(cursor, cursor);
    });
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
              {initials(conversationTitle(conversation))}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{conversationTitle(conversation)}</p>
              <StatusDot status={conversation.status} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {conversationHeaderSubtitle(conversation)} · {statusLabelFor(conversation.status)} · {agentLabel(conversation.assignedUserId, currentUserId, members)}
            </p>
          </div>

          <div className="hidden items-center gap-1.5 md:flex">
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
            canDelete={canDelete}
            conversation={conversation}
            workspaceId={workspaceId}
            busyAction={busyAction}
            transferTarget={transferTarget}
            transferOptions={transferOptions}
            onTransferTargetChange={setTransferTarget}
            onRunAction={runAction}
            onOpenContext={onOpenContext}
            onRequestDelete={() => setDeleteConfirmOpen(true)}
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

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={conversation.chatType === "group" ? "Excluir grupo" : "Excluir conversa"}
        description={`Isto apaga permanentemente ${conversation.chatType === "group" ? `o grupo "${conversationTitle(conversation)}"` : `a conversa com "${conversationTitle(conversation)}"`} e todo o histórico de mensagens. Não pode ser desfeito.`}
        confirmLabel="Excluir"
        variant="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {isLoading ? (
            <MessageSkeleton />
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : timeline.length === 0 ? (
            <EmptyState title="Nenhuma mensagem ainda" description="Envie a primeira mensagem para começar a conversa." />
          ) : (
            timeline.map((entry) =>
              entry.kind === "message" ? (
                <MessageBubble
                  key={`msg-${entry.message.id}`}
                  workspaceId={workspaceId}
                  message={entry.message}
                  isGroup={conversation.chatType === "group"}
                  onRetry={(body) => handleSend(body)}
                  retrying={sending}
                />
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
          {attachError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{attachError}</span>
            </div>
          ) : null}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleAttach(file);
            }}
          />
          <input
            ref={documentInputRef}
            type="file"
            accept="application/pdf,text/plain,application/zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleAttach(file);
            }}
          />
          <div className="flex items-end gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <span className="inline-flex">
                  <Button type="button" variant="ghost" size="icon" disabled={!canOperate || attaching} aria-label="Anexar arquivo">
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-52 p-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  Foto ou vídeo
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => documentInputRef.current?.click()}
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Documento
                </button>
              </PopoverContent>
            </Popover>
            <EmojiPickerButton disabled={!canOperate} onSelect={insertEmoji} />
            <Textarea
              ref={textareaRef}
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
            {draft.trim() ? (
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
            ) : (
              <VoiceRecorderButton disabled={!canOperate || attaching} onSend={handleSendVoiceNote} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationActionsMenu({
  canOperate,
  canDelete,
  conversation,
  workspaceId,
  busyAction,
  transferTarget,
  transferOptions,
  onTransferTargetChange,
  onRunAction,
  onOpenContext,
  onRequestDelete,
}: {
  canOperate: boolean;
  canDelete: boolean;
  conversation: InboxConversation;
  workspaceId: string;
  busyAction: string | undefined;
  transferTarget: string;
  transferOptions: readonly { id: string; label: string }[];
  onTransferTargetChange: (value: string) => void;
  onRunAction: (key: string, action: () => Promise<InboxConversation>) => void;
  onOpenContext: () => void;
  onRequestDelete: () => void;
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

        <div className="border-t border-border pt-3">
          <GuardedButton
            variant="danger"
            className="w-full justify-start"
            allowed={canDelete}
            blockedReason={RBAC_COPY.deleteConversations}
            onClick={onRequestDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {conversation.chatType === "group" ? "Excluir grupo" : "Excluir conversa"}
          </GuardedButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Bloco "Composer" — seletor de emoji leve (ver seção 18 do pedido original): sem biblioteca
 * externa, sem backend (emoji é texto Unicode normal, inserido direto no rascunho). Conjunto
 * curado com palavra-chave própria pra busca simples (nunca uma busca "de verdade" contra um
 * banco de nomes Unicode — não vale a complexidade pra um seletor deste tamanho). */
const EMOJI_ENTRIES: { char: string; keywords: string }[] = [
  { char: "😀", keywords: "sorriso feliz" }, { char: "😁", keywords: "sorriso feliz" }, { char: "😂", keywords: "risada rindo" },
  { char: "🤣", keywords: "risada rindo chao" }, { char: "🙂", keywords: "sorriso" }, { char: "😊", keywords: "sorriso feliz" },
  { char: "😍", keywords: "apaixonado coracao olhos" }, { char: "😘", keywords: "beijo" }, { char: "😉", keywords: "piscada" },
  { char: "😎", keywords: "legal oculos" }, { char: "🤔", keywords: "pensando duvida" }, { char: "😅", keywords: "suor aliviado" },
  { char: "😢", keywords: "triste chorando" }, { char: "😭", keywords: "choro triste" }, { char: "😡", keywords: "raiva bravo" },
  { char: "🥳", keywords: "festa comemoracao" }, { char: "😴", keywords: "sono dormindo" }, { char: "😇", keywords: "anjo santo" },
  { char: "🤗", keywords: "abraco" }, { char: "😏", keywords: "sorriso malicioso" }, { char: "😮", keywords: "surpresa espanto" },
  { char: "👍", keywords: "joinha positivo like" }, { char: "👎", keywords: "negativo dislike" }, { char: "👏", keywords: "palmas aplauso" },
  { char: "🙏", keywords: "obrigado por favor rezar" }, { char: "💪", keywords: "forca musculo" }, { char: "🤝", keywords: "aperto de mao acordo" },
  { char: "✌️", keywords: "paz vitoria" }, { char: "👌", keywords: "ok perfeito" }, { char: "🖐️", keywords: "mao parar" },
  { char: "👋", keywords: "tchau oi acenar" }, { char: "🙌", keywords: "comemoracao maos" }, { char: "💯", keywords: "cem perfeito" },
  { char: "🔥", keywords: "fogo top demais" }, { char: "✨", keywords: "brilho estrela" }, { char: "⭐", keywords: "estrela favorito" },
  { char: "❤️", keywords: "coracao amor" }, { char: "💔", keywords: "coracao partido" }, { char: "💛", keywords: "coracao amarelo" },
  { char: "📞", keywords: "telefone ligar" }, { char: "📱", keywords: "celular whatsapp" }, { char: "💻", keywords: "computador notebook" },
  { char: "📷", keywords: "camera foto" }, { char: "🎉", keywords: "festa parabens comemoracao" }, { char: "🎂", keywords: "bolo aniversario" },
  { char: "🎁", keywords: "presente" }, { char: "📅", keywords: "calendario data agenda" }, { char: "⏰", keywords: "relogio despertador hora" },
  { char: "✅", keywords: "check certo confirmado" }, { char: "❌", keywords: "errado cancelar x" }, { char: "⚠️", keywords: "atencao aviso" },
  { char: "📌", keywords: "fixar pin" }, { char: "💡", keywords: "ideia lampada" }, { char: "🛒", keywords: "carrinho compra" },
  { char: "💰", keywords: "dinheiro pagamento" }, { char: "📦", keywords: "pacote entrega" }, { char: "🚗", keywords: "carro" },
  { char: "✈️", keywords: "aviao viagem" }, { char: "🏠", keywords: "casa" },
];

function EmojiPickerButton({ disabled, onSelect }: { disabled: boolean; onSelect: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = query.trim() ? EMOJI_ENTRIES.filter((entry) => entry.keywords.includes(query.trim().toLowerCase())) : EMOJI_ENTRIES;

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger asChild>
        <span className="inline-flex">
          <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label="Inserir emoji">
            <Smile className="h-4 w-4" />
          </Button>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar emoji..."
          className="mb-2 h-8 text-sm"
          autoFocus
        />
        <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
          {filtered.map((entry) => (
            <button
              key={entry.char}
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted"
              onClick={() => onSelect(entry.char)}
              aria-label={entry.keywords}
            >
              {entry.char}
            </button>
          ))}
          {filtered.length === 0 ? <p className="col-span-8 py-4 text-center text-xs text-muted-foreground">Nenhum emoji encontrado.</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Bloco "Gravação de áudio" (ver seções 19-23 do pedido original) — `navigator.mediaDevices.
 * getUserMedia` + `MediaRecorder`. Fluxo: clicar microfone → permissão → gravando (timer + cancelar/
 * parar) → preview (ouvir antes de enviar, nunca envia direto ao parar) → enviar/descartar. Erros
 * (permissão negada, browser sem suporte, dispositivo indisponível) sempre viram mensagem humana,
 * nunca o erro técnico cru — ver `describeRecorderError`.
 *
 * Formato: usa o mimetype que o PRÓPRIO browser oferece via `MediaRecorder.isTypeSupported`
 * (preferindo `audio/ogg;codecs=opus`, o formato do exemplo documentado do WuzAPI — `API.md`,
 * `POST /chat/send/audio` — quando o browser suporta gravar nesse formato; a maioria dos Chromium
 * só grava `audio/webm;codecs=opus` nativamente). AINDA NÃO CONFIRMADO ao vivo: se o WuzAPI
 * distingue voice note/PTT de áudio genérico por algum campo à parte (a documentação pública não
 * menciona nenhum) — precisa validar contra um WhatsApp real antes de considerar "voice note"
 * garantido (ver docs/conversas-whatsapp-experience-completion.md, riscos restantes).
 */
function VoiceRecorderButton({ disabled, onSend }: { disabled: boolean; onSend: (blob: Blob) => Promise<void> }) {
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "preview" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function reset() {
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    blobRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
    setPhase("idle");
  }

  async function startRecording() {
    setError(undefined);
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase("preview");
        stopStream();
      };
      recorderRef.current = recorder;
      recorder.start();
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((current) => current + 1), 1000);
    } catch (cause) {
      setError(describeRecorderError(cause));
      setPhase("idle");
      stopStream();
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function cancelRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    reset();
  }

  async function confirmSend() {
    if (!blobRef.current) return;
    setPhase("sending");
    try {
      await onSend(blobRef.current);
      reset();
    } catch {
      // `onSend` já registra o erro no estado do composer (attachError) — aqui só volta pro
      // preview, nunca perde a gravação numa falha de rede/upload.
      setPhase("preview");
    }
  }

  useEffect(() => () => stopStream(), []);

  if (phase === "idle") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={startRecording} aria-label="Gravar áudio">
                <Mic className="h-4 w-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Gravar mensagem de voz</TooltipContent>
        </Tooltip>
        {error ? <p className="max-w-[12rem] text-right text-[11px] text-destructive">{error}</p> : null}
      </div>
    );
  }

  if (phase === "requesting") {
    return <Button type="button" variant="ghost" size="icon" disabled aria-label="Solicitando microfone" loading />;
  }

  if (phase === "recording") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
        <span className="tabular-nums text-sm text-foreground">{formatRecordingTime(seconds)}</span>
        <Button type="button" variant="ghost" size="sm" onClick={cancelRecording}>
          Cancelar
        </Button>
        <Button type="button" variant="secondary" size="icon" onClick={stopRecording} aria-label="Parar gravação">
          <Square className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // "preview" | "sending" — sempre pode ouvir antes de enviar (nunca envia direto ao parar).
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5">
      {previewUrl ? <audio src={previewUrl} controls className="h-8 max-w-[10rem]" /> : null}
      <Button type="button" variant="ghost" size="icon" onClick={reset} disabled={phase === "sending"} aria-label="Descartar gravação">
        <Trash2 className="h-4 w-4" />
      </Button>
      <GuardedButton size="sm" onClick={confirmSend} loading={phase === "sending"} disabled={phase === "sending"} allowed={!disabled} blockedReason={RBAC_COPY.operateConversations}>
        <Send className="h-4 w-4" />
        Enviar
      </GuardedButton>
    </div>
  );
}

function describeRecorderError(cause: unknown): string {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    return "Seu navegador não suporta gravação de áudio.";
  }
  if (cause instanceof DOMException) {
    if (cause.name === "NotAllowedError" || cause.name === "SecurityError") return "Não foi possível acessar o microfone.";
    if (cause.name === "NotFoundError") return "Nenhum microfone disponível neste dispositivo.";
  }
  return "Não foi possível acessar o microfone.";
}

function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function MessageBubble({
  workspaceId,
  message,
  isGroup,
  onRetry,
  retrying,
}: {
  workspaceId: string;
  message: InboxMessage;
  isGroup: boolean;
  onRetry: (body: string) => void;
  retrying: boolean;
}) {
  const isOutbound = message.direction === "outbound";
  // Grupo: mostra quem dos participantes mandou (a conversa representa o grupo inteiro, não mais
  // um remetente — ver docs/conversas-canonical-chat-identity.md). DM: mantém o comportamento
  // original (nunca repete o nome do contato acima de toda mensagem, ele já está no header).
  const senderLabel = message.sentByAi
    ? "Vorix IA"
    : message.sentByAutomation
      ? "Automação"
      : isOutbound
        ? "Atendente"
        : isGroup
          ? (message.senderDisplayName ?? "Participante")
          : undefined;
  const body = message.body?.trim();
  const isMedia = message.type === "image" || message.type === "video" || message.type === "audio" || message.type === "document";
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
        {isMedia ? (
          <MessageMedia workspaceId={workspaceId} message={message} />
        ) : !body ? (
          // Bug real corrigido: tipo sem renderizador dedicado (location/contact/other/sticker) e
          // sem body deixava a bolha completamente vazia (só timestamp) — nunca mais "nada".
          (() => {
            const Icon = mediaIconFor(message.type);
            return (
              <div className="flex items-center gap-2 rounded-lg bg-muted/70 px-3 py-2 text-muted-foreground">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-xs">{mediaLabelFor(message.type)}</span>
              </div>
            );
          })()
        ) : null}
        {body ? <p className={cn("whitespace-pre-wrap break-words", isMedia && "mt-1.5")}>{body}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1 text-[10px] opacity-70">
          <span className="tabular-nums">{timeLabel(message.sentAt ?? message.createdAt)}</span>
          {isOutbound ? <MessageStatusTicks status={message.status} /> : null}
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
          <p className="truncate text-sm font-semibold text-foreground">{conversationTitle(conversation)}</p>
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
              {initials(conversationTitle(conversation))}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{conversationTitle(conversation)}</p>
            {conversation.chatType === "direct" ? <p className="truncate text-xs text-muted-foreground">{conversation.contactPhone}</p> : null}
            <p className="truncate text-xs text-muted-foreground">{conversationSubtitle(conversation)}</p>
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

        {conversation.chatType === "direct" && conversation.crmContactId ? (
          <Link href={`/workspaces/${workspaceId}/contacts`} className="mb-4 inline-flex text-xs font-medium text-primary hover:underline dark:text-primary-glow">
            Abrir contato completo
          </Link>
        ) : null}

        {/* Grupo nunca é uma pessoa/Contact do CRM — vínculo manual só faz sentido pra conversas
            diretas (ver docs/conversas-canonical-chat-identity.md, seção 8 do pedido original). */}
        {conversation.chatType === "direct" ? (
          <CrmContextSection workspaceId={workspaceId} conversation={conversation} members={members} onLinked={onConversationChanged} />
        ) : null}
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
  if (userId === currentUserId) return "Você";
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

/** Bloco "Receipts" (ver docs/conversas-whatsapp-experience-completion.md) — ícones ✓/✓✓ na
 * ergonomia do WhatsApp em vez do rótulo de texto anterior. Tooltip explica o estado por extenso.
 * `queued`/`sending` usam um relógio discreto (nunca inventa um "entregue"/"lido" que o provider
 * não confirmou — ver `mapStatusReceipt` no backend, só reconhece `Delivered`/`Read`/`ReadSelf`). */
function MessageStatusTicks({ status }: { status: InboxMessage["status"] }) {
  const icon =
    status === "failed" ? (
      <AlertCircle className="h-3 w-3 text-destructive" aria-hidden="true" />
    ) : status === "read" ? (
      <CheckCheck className="h-3 w-3 text-sky-500 dark:text-sky-400" aria-hidden="true" />
    ) : status === "delivered" ? (
      <CheckCheck className="h-3 w-3" aria-hidden="true" />
    ) : status === "sent" ? (
      <Check className="h-3 w-3" aria-hidden="true" />
    ) : (
      <Clock className="h-3 w-3" aria-hidden="true" />
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center" aria-label={messageStatusLabel(status)}>
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>{messageStatusLabel(status)}</TooltipContent>
    </Tooltip>
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

export function mediaIconFor(type: InboxMessage["type"]) {
  switch (type) {
    case "image": return ImageIcon;
    case "video": return Video;
    case "audio": return Volume2;
    case "document": return FileText;
    default: return AlertCircle;
  }
}

function lastMessagePreviewLabel(conversation: InboxConversation): string {
  const preview = conversation.lastMessagePreview;
  if (!preview) return conversation.lastMessageAt ? "Última interação registrada." : "Sem mensagens recentes.";
  // Grupo: "Maria: Fechou" — sem isso, a lista mostraria só "Fechou" sem dizer quem, dos N
  // participantes, mandou a última mensagem (ver seção 31 do pedido original).
  const prefix =
    preview.direction === "outbound"
      ? "Você: "
      : conversation.chatType === "group" && preview.senderDisplayName
        ? `${preview.senderDisplayName}: `
        : "";
  if (preview.type === "text") return `${prefix}${preview.body?.trim() || "Mensagem sem texto"}`;
  return `${prefix}${mediaPreviewLabel(preview.type)}`;
}

/** Rótulo curto com ícone pra PREVIEW DA LISTA (ex.: "Daniel: 📷 Foto") — distinto do rótulo mais
 * longo usado como fallback dentro da bolha da conversa (`mediaLabelFor`, mantido como estava).
 * Ver seção 11 do pedido original ("carregamento real de mídia"). */
function mediaPreviewLabel(type: InboxMessage["type"]): string {
  switch (type) {
    case "image": return "📷 Foto";
    case "video": return "🎥 Vídeo";
    case "audio": return "🎤 Áudio";
    case "document": return "📄 Documento";
    case "location": return "📍 Localização";
    case "contact": return "👤 Contato";
    default: return mediaLabelFor(type);
  }
}

export function mediaLabelFor(type: InboxMessage["type"]): string {
  switch (type) {
    case "image": return "Imagem recebida";
    case "video": return "Video recebido";
    case "audio": return "Audio recebido";
    case "document": return "Documento recebido";
    case "location": return "Localização recebida";
    case "contact": return "Contato recebido";
    case "text": return "Mensagem sem texto";
    default: return "Mídia recebida";
  }
}

/** Correção do bug de identidade de conversa — título/subtítulo exibido pra uma conversa, sem
 * inventar nada: grupo sem `groupName` conhecido cai num rótulo genérico seguro ("Grupo do
 * WhatsApp"), nunca no nome do primeiro remetente (ver docs/conversas-canonical-chat-identity.md,
 * seção 10 do pedido original). */
function conversationTitle(conversation: InboxConversation): string {
  // Fallback "Grupo" (nunca "Grupo do WhatsApp" permanente) — a metadata real chega sozinha via
  // `syncGroupMetadata` (worker) logo após a primeira mensagem; isto só aparece na janela curta
  // antes disso resolver (ver docs/conversas-inbox-organization-media-runtime.md).
  if (conversation.chatType === "group") return conversation.groupName ?? "Grupo";
  return conversation.contactName ?? conversation.contactPhone ?? "Contato";
}

function conversationSubtitle(conversation: InboxConversation): string {
  return conversation.chatType === "group" ? "WhatsApp · Grupo" : `WhatsApp · ${conversation.contactPhone ?? "—"}`;
}

/** Só pro HEADER da conversa aberta (nunca a lista, que fica só "WhatsApp · Grupo") — inclui
 * contagem de participantes quando `syncGroupMetadata` já resolveu isso (ver seção 12 do pedido:
 * "18 participantes quando esses dados realmente existirem", nunca inventado). */
function conversationHeaderSubtitle(conversation: InboxConversation): string {
  const base = conversationSubtitle(conversation);
  if (conversation.chatType === "group" && conversation.groupParticipantCount) {
    return `${base} · ${conversation.groupParticipantCount} participantes`;
  }
  return base;
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
