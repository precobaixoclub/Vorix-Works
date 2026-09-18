"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Camera,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Flame,
  Image as ImageIcon,
  Mail,
  MailOpen,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Tag,
  Trash2,
  UserCheck,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GuardedButton } from "@/components/GuardedButton";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { canManageTenant, canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";
import {
  addTagToConversation,
  assignInboxConversation,
  closeInboxConversation,
  createInboxTag,
  deleteInboxConversation,
  deleteInboxMessage,
  deleteInboxTag,
  markInboxConversationRead,
  markInboxConversationUnread,
  reactToInboxMessage,
  removeTagFromConversation,
  reopenInboxConversation,
  sendInboxMediaMessage,
  sendInboxMessage,
  setInboxConversationAiEnabled,
  setInboxConversationTeam,
  setInboxConversationUrgent,
  takeOverInboxConversation,
  transferInboxConversation,
  updateInboxTag,
} from "@/features/inbox/api";
import { useInboxConversationEvents, useInboxConversationMessages, useInboxConversations, useInboxMembers, useInboxRealtime, useInboxTags } from "@/features/inbox/hooks";
import { useTeams } from "@/features/identity/hooks";
import { INBOX_TAG_COLORS } from "@/features/inbox/types";
import type { InboxConversation, InboxConversationEvent, InboxConversationStatus, InboxMediaStorageRef, InboxMessage, InboxTag, InboxTagColor, InboxTenantMember, MessagingProviderId, TeamKanbanPhase } from "@/features/inbox/types";
import type { Team } from "@/features/identity/types";
import {
  applyInboxFilters,
  CONVERSAS_FILTER_SECTIONS,
  countActiveInboxFilters,
  KANBAN_FILTER_SECTIONS,
  ownerOptionsFor,
  teamOptionsFor,
  useInboxFilterState,
} from "@/features/inbox/inbox-filters";
import type { InboxAiFilter, InboxFilterSection, InboxFilterState, InboxPeriodFilter, InboxReadFilter } from "@/features/inbox/inbox-filters";
import { CrmContextSection } from "./crm-panel";
import { MessageMedia } from "./message-media";
import { InboxAvatar } from "./inbox-avatar";

/** Bloco "Organização da lista" (ver docs/conversas-inbox-organization-media-runtime.md) — filtro
 * por `chatType`, deliberadamente client-side (a lista de um workspace é pequena o bastante pra
 * não justificar mais um parâmetro de servidor/índice novo) — nunca esconde o filtro de status já
 * existente, os dois combinam (ex.: "Não lidas" + "Grupos"). Melhoria visual (pedido explícito do
 * usuário: "filtros demais visíveis ao mesmo tempo") — junto com `CHANNEL_FILTERS`/`ADVANCED_FILTERS`/
 * a "Prioridade" (urgente), tudo isto agora vive dentro do popover único "Filtros", nunca mais uma
 * fileira própria de chips — reduz poluição visual sem remover nenhum filtro que já existia. */
const CHAT_TYPE_FILTERS: { value: "all" | "group" | "direct"; label: string }[] = [
  { value: "direct", label: "Diretas" },
  { value: "group", label: "Grupos" },
];

/** Bloco "canal unificado" (pedido explícito do usuário: "colocar o icone do whatsapp e do
 * instagram para diferenciar na conversa e um filtro tambem caso eu precise filtrar") — Instagram
 * DM virou canal de primeira classe do Inbox, `connectionProvider` é quem diferencia. Client-side,
 * mesmo racional de `CHAT_TYPE_FILTERS` (combina com os outros filtros, nunca os substitui).
 * `undefined` conta como "wuzapi" (ambiente que ainda não atualizou o backend, sempre foi só
 * WhatsApp). */
const CHANNEL_FILTERS: { value: MessagingProviderId; label: string }[] = [
  { value: "wuzapi", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
];

export function ChannelIcon({ provider, className }: { provider: MessagingProviderId | undefined; className?: string }) {
  if (provider === "instagram") return <Camera className={className} aria-label="Instagram" />;
  return <MessageCircle className={className} aria-label="WhatsApp" />;
}

/** Melhoria visual (pedido explícito do usuário: "considerar visualmente Conversas [Lista][Kanban],
 * mesmo que internamente as rotas continuem separadas") — nunca junta as duas rotas (`/conversas`
 * e `/kanban` continuam páginas próprias, sem mudança de arquitetura), só deixa visualmente claro
 * que são o mesmo módulo de atendimento. Usado nos dois cabeçalhos.
 *
 * Ajuste de ergonomia (pedido explícito do usuário: "Lista → Kanban não perder todos os filtros
 * inesperadamente") — propaga a querystring ATUAL (filtros, busca, equipe) pro destino: como as
 * duas telas leem os MESMOS nomes de parâmetro (`useInboxFilterState`), trocar de rota preserva o
 * filtro sozinho, sem precisar de estado global/localStorage. Nunca carrega `conversation=` pro
 * Kanban (não existe lá) nem `team=` pra Conversas quando a origem é Kanban mudando de equipe via
 * um link que não passou por aqui — só o que está na URL no momento do clique. */
export function AttendanceModuleToggle({ workspaceId, active }: { workspaceId: string; active: "lista" | "kanban" }) {
  const searchParams = useSearchParams();
  const carryParams = new URLSearchParams(searchParams.toString());
  carryParams.delete("conversation");
  const query = carryParams.toString();
  const items: { href: string; value: "lista" | "kanban"; label: string }[] = [
    { href: `/workspaces/${workspaceId}/conversas${query ? `?${query}` : ""}`, value: "lista", label: "Lista" },
    { href: `/workspaces/${workspaceId}/kanban${query ? `?${query}` : ""}`, value: "kanban", label: "Kanban" },
  ];
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/40 p-0.5">
      {items.map((item) => (
        <Link
          key={item.value}
          href={item.href}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            active === item.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

const STATUS_FILTER_OPTIONS: { value: InboxConversationStatus; label: string }[] = [
  { value: "open", label: "Em atendimento" },
  { value: "pending", label: "Pendente" },
  { value: "resolved", label: "Finalizada" },
  { value: "archived", label: "Arquivada" },
];

const AI_FILTER_OPTIONS: { value: InboxAiFilter; label: string }[] = [
  { value: "active", label: "IA ativa" },
  { value: "paused", label: "IA pausada" },
  { value: "human", label: "Atendimento humano" },
];

const READ_FILTER_OPTIONS: { value: InboxReadFilter; label: string }[] = [
  { value: "unread", label: "Não lidas" },
  { value: "read", label: "Lidas" },
];

const PERIOD_FILTER_OPTIONS: { value: InboxPeriodFilter; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "24h", label: "Últimas 24h" },
  { value: "7d", label: "Últimos 7 dias" },
];

/** Bloco "grupo de botões de filtro" — mesmo idioma visual pras 4 seções da `InboxFilterBar` que
 * são "escolha única, clicar de novo no ativo volta pra 'Todas'" (Tipo/Status/IA/Leitura/Período).
 * Um componente genérico em vez de 5 blocos JSX quase idênticos. */
function FilterButtonGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: readonly { value: T; label: string }[];
  value: T | "all";
  onChange: (value: T | "all") => void;
}) {
  return (
    <div className="space-y-1">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5 px-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(value === option.value ? "all" : option.value)}
            className={cn(
              "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors",
              value === option.value
                ? "border-primary/30 bg-primary/10 text-primary dark:border-primary-glow/30 dark:bg-primary-glow/10 dark:text-primary-glow"
                : "border-border/60 text-muted-foreground hover:bg-muted/60",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Bloco "ajuste de ergonomia e filtros" (pedido explícito do usuário: "Conversas e Kanban
 * representam a MESMA operação de atendimento... criar/reutilizar um componente compartilhado,
 * como FilterBar/InboxFilters") — ÚNICA FilterBar do módulo, usada tanto em Conversas quanto no
 * Kanban (`sections`/`inlineSections` decidem o que aparece em cada tela; Kanban nunca mostra
 * Status/Equipe — ver `KANBAN_FILTER_SECTIONS`). Estado vem de fora (`useInboxFilterState`, URL),
 * nunca duplicado aqui.
 */
export function InboxFilterBar({
  workspaceId,
  sections,
  inlineSections = [],
  quickChips = false,
  filters,
  onFilterChange,
  onClearFilters,
  search,
  onSearchChange,
  members,
  teams,
  currentUserId,
}: {
  workspaceId: string;
  sections: readonly InboxFilterSection[];
  inlineSections?: readonly InboxFilterSection[];
  quickChips?: boolean;
  filters: InboxFilterState;
  onFilterChange: <K extends keyof InboxFilterState>(key: K, value: InboxFilterState[K]) => void;
  onClearFilters: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  members: readonly InboxTenantMember[];
  teams: readonly Team[];
  currentUserId: string | undefined;
}) {
  const { data: tagsData } = useInboxTags(workspaceId);
  const tagOptions = (tagsData?.tags ?? []).map((tag) => ({ id: tag.id, label: tag.name }));
  const ownerOptions = [{ id: "me", label: "Eu" }, { id: "unassigned", label: "Sem responsável" }, ...ownerOptionsFor(members)];
  const teamOptions = teamOptionsFor(teams);
  const activeCount = countActiveInboxFilters(filters);
  const has = (section: InboxFilterSection) => sections.includes(section);
  const isInline = (section: InboxFilterSection) => inlineSections.includes(section) && has(section);
  const popoverSections = sections.filter((section) => !inlineSections.includes(section));

  return (
    <div className="space-y-1.5">
      {quickChips ? (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => { onFilterChange("owner", filters.owner === "me" ? "all" : filters.owner); onFilterChange("read", filters.read === "unread" ? "all" : filters.read); onFilterChange("urgent", false); }}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors duration-150",
              filters.owner !== "me" && filters.read !== "unread" && !filters.urgent
                ? "bg-primary text-primary-foreground dark:bg-primary-glow dark:text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => onFilterChange("owner", filters.owner === "me" ? "all" : "me")}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors duration-150",
              filters.owner === "me" ? "bg-primary text-primary-foreground dark:bg-primary-glow dark:text-background" : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            Minhas
          </button>
          <button
            type="button"
            onClick={() => onFilterChange("read", filters.read === "unread" ? "all" : "unread")}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors duration-150",
              filters.read === "unread" ? "bg-primary text-primary-foreground dark:bg-primary-glow dark:text-background" : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            Não lidas
          </button>
          <button
            type="button"
            onClick={() => onFilterChange("urgent", !filters.urgent)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors duration-150",
              filters.urgent ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            <Flame className="h-3.5 w-3.5" /> Urgentes
          </button>
        </div>
      ) : null}

      {/* `overflow-x-auto` + `min-w-[140px]` na busca (em vez de `min-w-0`) — achado via QA real em
         390px (Playwright): no Kanban, busca + Responsável + Canal + Filtros não cabem juntos; com
         `min-w-0` a busca simplesmente espremia até ficar ilegível. Agora ela mantém um piso
         utilizável e o EXCESSO rola horizontalmente (mesmo padrão já usado pelos chips rápidos de
         Conversas), nunca esconde nem espreme um filtro até sumir. */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <div className="relative min-w-[140px] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar conversa" className="h-8 pl-8" />
        </div>
        {isInline("owner") ? (
          <SearchableCombo
            items={ownerOptions}
            value={filters.owner === "all" ? "" : filters.owner}
            onValueChange={(value) => onFilterChange("owner", value || "all")}
            placeholder="Responsável"
            extraOption={{ value: "", label: "Todos" }}
            className="h-8 w-36 shrink-0"
          />
        ) : null}
        {isInline("channel") ? (
          <SearchableCombo
            items={CHANNEL_FILTERS.map((item) => ({ id: item.value, label: item.label }))}
            value={filters.channel === "all" ? "" : filters.channel}
            onValueChange={(value) => onFilterChange("channel", (value || "all") as InboxFilterState["channel"])}
            placeholder="Canal"
            extraOption={{ value: "", label: "Todos" }}
            className="h-8 w-32 shrink-0"
          />
        ) : null}
        {popoverSections.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors duration-150",
                  activeCount > 0
                    ? "border-primary/30 bg-primary/10 text-primary dark:border-primary-glow/30 dark:bg-primary-glow/10 dark:text-primary-glow"
                    : "border-border bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
              >
                Filtros{activeCount > 0 ? ` (${activeCount})` : ""}
              </button>
            </PopoverTrigger>
            {/* `w-[min(20rem,calc(100vw-2rem))]` em vez de `w-80` fixo — achado via QA real em
               390px (Playwright): um popover de 320px encostado em `align="end"` estourava a
               viewport móvel e cobria a própria busca. O `min()` mantém 20rem (320px) em telas
               largas e cai pra "viewport menos a margem" só quando precisa, sem duplicar o
               componente pra um "Sheet" mobile à parte. */}
            <PopoverContent align="end" className="max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-3">
              {has("type") && !isInline("type") ? (
                <FilterButtonGroup title="Tipo" options={CHAT_TYPE_FILTERS} value={filters.chatType} onChange={(value) => onFilterChange("chatType", value)} />
              ) : null}
              {has("channel") && !isInline("channel") ? (
                <FilterButtonGroup title="Canal" options={CHANNEL_FILTERS} value={filters.channel} onChange={(value) => onFilterChange("channel", value)} />
              ) : null}
              {has("owner") && !isInline("owner") ? (
                <div className="space-y-1">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Responsável</p>
                  <SearchableCombo
                    items={ownerOptions}
                    value={filters.owner === "all" ? "" : filters.owner}
                    onValueChange={(value) => onFilterChange("owner", value || "all")}
                    placeholder="Todos"
                    extraOption={{ value: "", label: "Todos" }}
                  />
                </div>
              ) : null}
              {has("team") && teamOptions.length > 0 ? (
                <div className="space-y-1">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Equipe</p>
                  <SearchableCombo
                    items={teamOptions}
                    value={filters.teamId}
                    onValueChange={(value) => onFilterChange("teamId", value)}
                    placeholder="Todas"
                    extraOption={{ value: "", label: "Todas" }}
                  />
                </div>
              ) : null}
              {has("status") ? (
                <FilterButtonGroup title="Status / Fase" options={STATUS_FILTER_OPTIONS} value={filters.status} onChange={(value) => onFilterChange("status", value)} />
              ) : null}
              {has("ai") ? <FilterButtonGroup title="IA" options={AI_FILTER_OPTIONS} value={filters.ai} onChange={(value) => onFilterChange("ai", value)} /> : null}
              {has("read") ? <FilterButtonGroup title="Leitura" options={READ_FILTER_OPTIONS} value={filters.read} onChange={(value) => onFilterChange("read", value)} /> : null}
              {has("urgent") ? (
                <div className="space-y-1">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Prioridade</p>
                  <button
                    type="button"
                    onClick={() => onFilterChange("urgent", !filters.urgent)}
                    className={cn(
                      "flex h-7 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors",
                      filters.urgent ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border/60 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <Flame className="h-3.5 w-3.5" /> Urgentes
                  </button>
                </div>
              ) : null}
              {has("tag") && tagOptions.length > 0 ? (
                <div className="space-y-1">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Etiqueta</p>
                  <SearchableCombo
                    items={tagOptions}
                    value={filters.tagId}
                    onValueChange={(value) => onFilterChange("tagId", value)}
                    placeholder="Todas as etiquetas"
                    extraOption={{ value: "", label: "Todas as etiquetas" }}
                  />
                </div>
              ) : null}
              {has("period") ? (
                <FilterButtonGroup title="Período" options={PERIOD_FILTER_OPTIONS} value={filters.period} onChange={(value) => onFilterChange("period", value)} />
              ) : null}
              {activeCount > 0 ? (
                <button type="button" onClick={onClearFilters} className="w-full rounded-md border-t border-border/60 pt-2.5 text-center text-xs font-medium text-muted-foreground hover:text-foreground">
                  Limpar filtros
                </button>
              ) : null}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

/** Bloco "etiquetas" (pedido explícito do usuário: "criar e configurar etiquetas dentro do
 * sistema e nas conversas ser possível adicionar mais do que uma") — cor vem do vocabulário
 * fechado (`INBOX_TAG_COLORS`), nunca hex livre (ver `web/CLAUDE.md`). Um mapa fixo em vez de
 * montar a classe Tailwind dinamicamente (`bg-${color}-500`) — o compilador do Tailwind só gera
 * CSS pra classe que aparece LITERALMENTE no código-fonte. */
const INBOX_TAG_COLOR_CLASSES: Record<InboxTagColor, { dot: string }> = {
  emerald: { dot: "bg-emerald-500" },
  sky: { dot: "bg-sky-500" },
  violet: { dot: "bg-violet-500" },
  amber: { dot: "bg-amber-500" },
  rose: { dot: "bg-rose-500" },
  slate: { dot: "bg-slate-500" },
};

type MobileView = "list" | "conversation";
type TimelineEntry = { kind: "message"; at: string; message: InboxMessage } | { kind: "event"; at: string; event: InboxConversationEvent };

export function InboxTab({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { state } = useAuth();
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;
  // Bloco "ajuste de ergonomia e filtros" (pedido explícito do usuário) — TODA filtragem virou
  // client-side sobre a MESMA lista buscada uma vez com `filter: "all"` (mesmo padrão que o Kanban
  // já usava antes desta mudança, ver `KanbanBoard`). Nunca mais um fetch novo por clique de
  // filtro (seção 32 do pedido: "não fazer requisição a cada clique").
  const { filters, search: urlSearch, setFilter, setSearch: setUrlSearch, clearFilters } = useInboxFilterState();
  // Busca: o INPUT reage instantaneamente (filtragem é local, sem custo de rede — não precisa
  // esperar debounce pra "sentir" a busca), só a ESCRITA na URL é debounced (evita empilhar
  // `router.replace` a cada tecla). Resincroniza quando a URL muda por fora (voltar do navegador,
  // "Limpar filtros").
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => { setSearchInput(urlSearch); }, [urlSearch]);
  useEffect(() => {
    const handle = setTimeout(() => { if (searchInput !== urlSearch) setUrlSearch(searchInput); }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);
  const [mobileView, setMobileView] = useState<MobileView>(searchParams.get("conversation") ? "conversation" : "list");
  const [contextOpen, setContextOpen] = useState(false);
  const [contextPinned, setContextPinned] = useState(false);

  const selectedConversationId = searchParams.get("conversation") ?? undefined;

  useInboxRealtime(workspaceId, selectedConversationId);

  const { data, isLoading, error, mutate } = useInboxConversations(workspaceId, "all");
  const { data: membersData } = useInboxMembers(workspaceId);
  const members = membersData?.members ?? [];
  // Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) — só
  // pra rotular `conversation.currentTeamId` na lista/cabeçalho, nunca usado pra decidir nada.
  const { data: teams } = useTeams(workspaceId);
  const conversations = data?.conversations ?? [];
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId);

  const filteredConversations = useMemo(() => {
    // Todas as dimensões combinam com AND (pedido explícito do usuário, seção 5: busca + canal +
    // não lidas + sem responsável "deve retornar apenas conversas que atendam a TODOS os
    // critérios") — `applyInboxFilters` é a MESMA função usada pelo Kanban, nunca duas lógicas.
    const byFilters = applyInboxFilters(conversations, filters, { currentUserId });
    const term = searchInput.trim().toLowerCase();
    if (!term) return byFilters;
    return byFilters.filter((conversation) => {
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
  }, [conversations, currentUserId, filters, members, searchInput]);

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
          // Largura da lista lateral (pedido explícito do usuário: "muito estreita para a
          // quantidade de informação exibida") — 356px em vez de 320px, dentro da faixa 340-360px
          // pedida; telas menores continuam caindo pro layout de 1 coluna (abaixo de `md`), sem
          // mudança nenhuma aí.
          contextOpen && contextPinned ? "xl:grid-cols-[356px_minmax(0,1fr)_384px]" : "md:grid-cols-[356px_minmax(0,1fr)]",
        )}
      >
        <div className={cn("min-h-0 border-border md:block md:border-r", mobileView === "list" ? "block" : "hidden")}>
          <ConversationListPane
            workspaceId={workspaceId}
            conversations={filteredConversations}
            totalConversations={conversations.length}
            isLoading={isLoading}
            error={error}
            onRetry={() => mutate()}
            filters={filters}
            onFilterChange={setFilter}
            onClearFilters={clearFilters}
            search={searchInput}
            onSearchChange={setSearchInput}
            selectedConversationId={selectedConversationId}
            onSelect={handleSelect}
            currentUserId={currentUserId}
            members={members}
            teams={teams ?? []}
            onConversationChanged={() => mutate()}
          />
        </div>

        <div className={cn("min-h-0 min-w-0", mobileView === "conversation" ? "block" : "hidden md:block")}>
          {selectedConversation ? (
            <ConversationTimelinePane
              workspaceId={workspaceId}
              conversation={selectedConversation}
              currentUserId={currentUserId}
              members={members}
              teams={teams ?? []}
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
  workspaceId,
  conversations,
  totalConversations,
  isLoading,
  error,
  onRetry,
  filters,
  onFilterChange,
  onClearFilters,
  search,
  onSearchChange,
  selectedConversationId,
  onSelect,
  currentUserId,
  members,
  teams,
  onConversationChanged,
}: {
  workspaceId: string;
  conversations: InboxConversation[];
  totalConversations: number;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  filters: InboxFilterState;
  onFilterChange: <K extends keyof InboxFilterState>(key: K, value: InboxFilterState[K]) => void;
  onClearFilters: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedConversationId: string | undefined;
  onSelect: (conversation: InboxConversation) => void;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
  teams: readonly Team[];
  onConversationChanged: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Otimização de espaço vertical (pedido explícito do usuário — captura de tela mostrando
         o topo da tela de Conversas tomando espaço demais no celular e no desktop): "Fila viva"
         (eyebrow decorativo) removido — "Atendimento" numa linha só com o contador já basta,
         economiza uma linha inteira; padding/gaps e alturas de controle reduzidos em seguida. */}
      <div className="space-y-2 border-b border-border p-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Atendimento</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{totalConversations}</span>
          </div>
          <AttendanceModuleToggle workspaceId={workspaceId} active="lista" />
        </div>

        <InboxFilterBar
          workspaceId={workspaceId}
          sections={CONVERSAS_FILTER_SECTIONS}
          quickChips
          filters={filters}
          onFilterChange={onFilterChange}
          onClearFilters={onClearFilters}
          search={search}
          onSearchChange={onSearchChange}
          members={members}
          teams={teams}
          currentUserId={currentUserId}
        />
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
              workspaceId={workspaceId}
              conversation={conversation}
              selected={selectedConversationId === conversation.id}
              currentUserId={currentUserId}
              members={members}
              teams={teams}
              onSelect={() => onSelect(conversation)}
              onConversationChanged={onConversationChanged}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Exportado para reuso no board do Kanban (`kanban/kanban-board.tsx`) — o board não tem card
 * próprio, usa este mesmo componente, só passando `phaseOptions`/`onMoveToPhase` (caminho sem
 * drag, pro menu de 3 pontinhos ganhar um "Mover para fase...", necessário pra mobile/touch onde
 * arrastar é ruim de usar). Nas telas que não são o board, essas duas props ficam `undefined` e o
 * item some do menu — comportamento idêntico ao de antes desta mudança. */
export function ConversationListItem({
  workspaceId,
  conversation,
  selected,
  currentUserId,
  members,
  teams,
  onSelect,
  onConversationChanged,
  phaseOptions,
  onMoveToPhase,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  selected: boolean;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
  teams: readonly Team[];
  onSelect: () => void;
  onConversationChanged: () => void;
  phaseOptions?: readonly TeamKanbanPhase[];
  onMoveToPhase?: (phaseId: string) => void;
}) {
  const avatarProps = avatarPropsFor(conversation);
  // Bloco "3 pontinhos na listagem" (pedido explícito do usuário: "sem precisar clicar e abrir
  // para isso") — o item inteiro continua clicável (abre a conversa), mas precisa deixar de ser um
  // `<button>` de verdade pra poder conter o botão do menu dentro (botão dentro de botão é HTML
  // inválido) — `role="button"`/`tabIndex`/`onKeyDown` preservam a acessibilidade de teclado.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex w-full cursor-pointer gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors duration-150 hover:bg-muted/50",
        selected && "bg-muted/80",
      )}
    >
      <div className="relative shrink-0">
        <InboxAvatar
          workspaceId={workspaceId}
          kind={avatarProps.kind}
          targetId={avatarProps.targetId}
          storageRef={avatarProps.storageRef}
          fallback={initials(conversationTitle(conversation))}
          className="h-10 w-10 rounded-xl"
          fallbackClassName="rounded-xl bg-muted text-xs text-foreground"
        />
        <span
          className={cn(
            "absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card",
            conversation.connectionProvider === "instagram" ? "bg-rose-500" : "bg-emerald-500",
          )}
        >
          <ChannelIcon provider={conversation.connectionProvider} className="h-2.5 w-2.5 text-white" />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            {conversation.isUrgent ? <Flame className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Urgente" /> : null}
            <p className={cn("truncate text-sm text-foreground", conversation.unreadCount > 0 ? "font-semibold" : "font-medium")}>
              {conversationTitle(conversation)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="text-[11px] tabular-nums text-muted-foreground">{timeLabel(conversation.lastMessageAt)}</span>
            <TagPicker workspaceId={workspaceId} conversation={conversation} onChanged={onConversationChanged} />
            <ConversationListItemMenu
              workspaceId={workspaceId}
              conversation={conversation}
              onChanged={onConversationChanged}
              phaseOptions={phaseOptions}
              onMoveToPhase={onMoveToPhase}
            />
          </div>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{conversationSubtitle(conversation)}</p>
        {/* Melhoria visual (pedido explícito do usuário — hierarquia de 4 linhas): linha 3 é
           preview + contador de não lidas (antes ficava numa 4ª linha própria, competindo com
           status/responsável); linha 4 fica bem discreta, texto único em vez de vários badges. */}
        <div className="mt-1 flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">{lastMessagePreviewLabel(conversation)}</p>
          {conversation.unreadCount > 0 ? (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground dark:bg-primary-glow dark:text-background">
              {conversation.unreadCount}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <StatusDot status={conversation.status} />
          <span className="truncate">
            {statusLabelFor(conversation.status)}
            {conversation.currentTeamId ? ` · ${teamLabel(conversation.currentTeamId, teams)}` : ""}
            {` · ${agentLabel(conversation.assignedUserId, currentUserId, members)}`}
          </span>
          {/* "IA pausada" fica só um ícone discreto (pedido explícito do usuário) — nunca mais um
             badge colorido com texto competindo com o resto da linha; "Humano"/"IA ativa" já são
             óbvios pelo responsável mostrado acima, então não precisam de indicador próprio aqui. */}
          {!conversation.assignedUserId && !conversation.aiEnabled ? <Bot className="h-3 w-3 shrink-0 opacity-60" aria-label="IA pausada" /> : null}
          {conversation.tags && conversation.tags.length > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5">
              {conversation.tags.slice(0, 3).map((tag) => (
                <span key={tag.id} className={cn("h-1.5 w-1.5 rounded-full", INBOX_TAG_COLOR_CLASSES[tag.color].dot)} aria-hidden="true" />
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Bloco "3 pontinhos na listagem" — versão compacta do `ConversationActionsMenu` (que vive no
 * cabeçalho da conversa aberta): só as ações pedidas explicitamente pra funcionar sem abrir a
 * conversa (ler/não lida, urgente). Nunca duplica as ações administrativas (transferir/excluir/IA)
 * do menu completo — aquelas continuam exigindo a conversa aberta. */
export function ConversationListItemMenu({
  workspaceId,
  conversation,
  onChanged,
  phaseOptions,
  onMoveToPhase,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  onChanged: () => void;
  phaseOptions?: readonly TeamKanbanPhase[];
  onMoveToPhase?: (phaseId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch {
      // Ação secundária best-effort — a revalidação normal (SSE/polling) eventualmente corrige a
      // UI se isto falhar; sem toast dedicado pra não pesar um menu deliberadamente leve.
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Mais ações"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            // Achado de revisão (pedido explícito do usuário, seção 17: "hoje os cards não exibem
            // claramente o menu contextual") — este componente é reusado tanto na listagem (tem um
            // ancestral `.group` sem escopo) quanto no card do Kanban (`group/kanban-card`, um
            // grupo NOMEADO — `group-hover:` sem nome nunca casa com um grupo nomeado, então o
            // botão ficava permanentemente invisível ali, mesmo passando o mouse). Mesmo racional
            // já aplicado em `TagPicker`: nunca depender de `group-hover`, sempre parcialmente
            // visível — funciona em qualquer contexto e em touch (onde não existe hover).
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 p-1"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => (conversation.unreadCount > 0 ? markInboxConversationRead(workspaceId, conversation.id) : markInboxConversationUnread(workspaceId, conversation.id)))}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {conversation.unreadCount > 0 ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
          {conversation.unreadCount > 0 ? "Marcar como lida" : "Marcar como não lida"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => setInboxConversationUrgent(workspaceId, conversation.id, !conversation.isUrgent))}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Flame className={cn("h-4 w-4", conversation.isUrgent && "text-destructive")} />
          {conversation.isUrgent ? "Remover urgência" : "Marcar como urgente"}
        </button>
        {phaseOptions && phaseOptions.length > 0 && onMoveToPhase ? (
          <>
            <div className="my-1 border-t border-border/60" />
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Mover para fase</p>
            {phaseOptions.map((phase) => (
              <button
                key={phase.id}
                type="button"
                disabled={busy || phase.id === conversation.currentPhaseId}
                onClick={() => run(() => Promise.resolve(onMoveToPhase(phase.id)))}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", phase.id === conversation.currentPhaseId ? "bg-primary" : "bg-muted-foreground/40")} />
                {phase.name}
              </button>
            ))}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Bloco "etiquetas" (pedido explícito do usuário: "criar e configurar etiquetas dentro do
 * sistema e nas conversas ser possível adicionar mais do que uma") — funciona tanto na listagem
 * (sem abrir a conversa, `ConversationListItem`) quanto no cabeçalho da conversa aberta
 * (`ConversationTimelinePane`), sempre este MESMO componente (nunca dois pickers diferentes). */
export function TagPicker({
  workspaceId,
  conversation,
  onChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  onChanged: () => void;
}) {
  const { data, mutate } = useInboxTags(workspaceId);
  const allTags = data?.tags ?? [];
  const appliedIds = new Set((conversation.tags ?? []).map((tag) => tag.id));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<InboxTagColor>("emerald");
  const [createError, setCreateError] = useState<string | undefined>();
  const [managerOpen, setManagerOpen] = useState(false);

  async function toggle(tag: InboxTag) {
    setBusy(true);
    try {
      if (appliedIds.has(tag.id)) await removeTagFromConversation(workspaceId, conversation.id, tag.id);
      else await addTagToConversation(workspaceId, conversation.id, tag.id);
      onChanged();
    } catch {
      // Best-effort — mesmo racional do resto deste menu compacto (ver `ConversationListItemMenu`).
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setCreateError(undefined);
    try {
      const tag = await createInboxTag(workspaceId, name, newColor);
      await mutate();
      await addTagToConversation(workspaceId, conversation.id, tag.id);
      setNewName("");
      setCreating(false);
      onChanged();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Não foi possível criar a etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Etiquetas"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            // Sem `group-hover` de propósito (achado de revisão): este componente é reusado tanto
            // na listagem (tem um ancestral `.group`) quanto no cabeçalho da conversa aberta (não
            // tem) — depender de `group-hover` deixaria o botão permanentemente invisível ali.
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-muted hover:opacity-100 data-[state=open]:opacity-100",
            appliedIds.size > 0 ? "opacity-100" : "opacity-70",
          )}
        >
          <Tag className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2" onClick={(event) => event.stopPropagation()}>
        <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Etiquetas</p>
        {allTags.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Nenhuma etiqueta ainda neste workspace.</p>
        ) : (
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {allTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                disabled={busy}
                onClick={() => toggle(tag)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", INBOX_TAG_COLOR_CLASSES[tag.color].dot)} />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                {appliedIds.has(tag.id) ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
              </button>
            ))}
          </div>
        )}
        <div className="my-1.5 border-t border-border/60" />
        {creating ? (
          <div className="space-y-2 px-1 py-1">
            <Input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nome da etiqueta"
              className="h-8 text-sm"
              onKeyDown={(event) => { if (event.key === "Enter") handleCreate(); }}
            />
            <div className="flex items-center gap-1.5">
              {INBOX_TAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Cor ${color}`}
                  onClick={() => setNewColor(color)}
                  className={cn(
                    "h-5 w-5 rounded-full ring-offset-1 transition-shadow",
                    INBOX_TAG_COLOR_CLASSES[color].dot,
                    newColor === color && "ring-2 ring-foreground ring-offset-background",
                  )}
                />
              ))}
            </div>
            {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setNewName(""); setCreateError(undefined); }}>Cancelar</Button>
              <Button size="sm" loading={busy} disabled={!newName.trim() || busy} onClick={handleCreate}>Criar</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Nova etiqueta
          </button>
        )}
        <button
          type="button"
          onClick={() => setManagerOpen(true)}
          className="mt-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          Gerenciar etiquetas
        </button>
      </PopoverContent>
      {managerOpen ? (
        <TagManagerModal
          workspaceId={workspaceId}
          onClose={() => setManagerOpen(false)}
          onChanged={() => { void mutate(); onChanged(); }}
        />
      ) : null}
    </Popover>
  );
}

/** Gestão da taxonomia (renomear/recolorir/excluir) — mesmo racional de `PhaseManagerModal`
 * (`kanban-board.tsx`): lista curta, sem reorder nenhum (etiqueta não tem ordem, só nome/cor). */
function TagManagerModal({
  workspaceId,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, mutate } = useInboxTags(workspaceId);
  const tags = data?.tags ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<InboxTagColor>("emerald");
  const [pendingDelete, setPendingDelete] = useState<InboxTag | undefined>();

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(undefined);
    try {
      await createInboxTag(workspaceId, name, newColor);
      setNewName("");
      await mutate();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(tag: InboxTag, name: string) {
    if (!name.trim() || name === tag.name) return;
    setBusy(true);
    setError(undefined);
    try {
      await updateInboxTag(workspaceId, tag.id, { name: name.trim() });
      await mutate();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível renomear a etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecolor(tag: InboxTag, color: InboxTagColor) {
    setBusy(true);
    setError(undefined);
    try {
      await updateInboxTag(workspaceId, tag.id, { color });
      await mutate();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível recolorir a etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteInboxTag(workspaceId, pendingDelete.id);
      setPendingDelete(undefined);
      await mutate();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a etiqueta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Etiquetas" onClose={onClose} maxWidthClass="sm:max-w-lg">
      <div className="flex flex-col gap-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col gap-2">
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma etiqueta ainda — crie a primeira abaixo.</p>
          ) : (
            tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <div className="flex shrink-0 items-center gap-1">
                  {INBOX_TAG_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Cor ${color}`}
                      disabled={busy}
                      onClick={() => handleRecolor(tag, color)}
                      className={cn(
                        "h-4 w-4 rounded-full ring-offset-1 transition-shadow disabled:opacity-50",
                        INBOX_TAG_COLOR_CLASSES[color].dot,
                        tag.color === color && "ring-2 ring-foreground ring-offset-background",
                      )}
                    />
                  ))}
                </div>
                <Input
                  defaultValue={tag.name}
                  disabled={busy}
                  className="h-8 flex-1 text-sm"
                  onBlur={(event) => handleRename(tag, event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPendingDelete(tag)}>Excluir</Button>
              </div>
            ))
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-border/60 pt-4">
          <div className="flex-1">
            <Label htmlFor="new-tag-name">Nova etiqueta</Label>
            <Input id="new-tag-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ex.: Urgente" disabled={busy} />
          </div>
          <div className="flex items-center gap-1.5 pb-2">
            {INBOX_TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Cor ${color}`}
                onClick={() => setNewColor(color)}
                className={cn(
                  "h-5 w-5 rounded-full ring-offset-1 transition-shadow",
                  INBOX_TAG_COLOR_CLASSES[color].dot,
                  newColor === color && "ring-2 ring-foreground ring-offset-background",
                )}
              />
            ))}
          </div>
          <Button onClick={handleCreate} loading={busy} disabled={busy || !newName.trim()}>
            <Plus className="h-4 w-4" /> Criar
          </Button>
        </div>
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          open
          variant="danger"
          busy={busy}
          title="Excluir etiqueta"
          description={`"${pendingDelete.name}" será removida de toda conversa que a tiver. Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(undefined)}
        />
      ) : null}
    </Modal>
  );
}

/** Exportado para reuso fora da tela Conversas (pedido explícito do usuário: abrir a conversa do
 * contato "ali mesmo", direto do card do negócio no Kanban de Negócios, "sem direcionar para
 * outras telas") — mesmo racional de `ConversationListItem` já reusado no board de atendimento:
 * nunca uma segunda UI de chat paralela, sempre esta mesma (composer, mídia, reações, IA...). */
export function ConversationTimelinePane({
  workspaceId,
  conversation,
  currentUserId,
  members,
  teams,
  onBack,
  onOpenContext,
  onConversationChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
  teams: readonly Team[];
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
  // Bloco "responder mensagem específica" (pedido explícito do usuário: "clicar para reponder uma
  // mensagem especifica") — mensagem sendo respondida, mostrada como preview acima do composer.
  const [replyingTo, setReplyingTo] = useState<InboxMessage | undefined>();
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

  const headerAvatarProps = avatarPropsFor(conversation);
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
    // Retry de uma mensagem que falhou antes é sempre reenviada como mensagem normal — a citação
    // original (se houver) não é reconstruída aqui (edge case deliberadamente fora de escopo).
    const replyToMessageId = bodyFromRetry ? undefined : replyingTo?.id;
    setSending(true);
    setSendError(undefined);
    try {
      await sendInboxMessage(workspaceId, conversation.id, body, replyToMessageId);
      setDraft((current) => (current.trim() === body ? "" : current));
      setFailedDraft(undefined);
      setReplyingTo(undefined);
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
          <InboxAvatar
            workspaceId={workspaceId}
            kind={headerAvatarProps.kind}
            targetId={headerAvatarProps.targetId}
            storageRef={headerAvatarProps.storageRef}
            fallback={initials(conversationTitle(conversation))}
            className="h-10 w-10 shrink-0 rounded-xl"
            fallbackClassName="rounded-xl bg-primary/10 text-xs text-primary dark:bg-primary-glow/10 dark:text-primary-glow"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{conversationTitle(conversation)}</p>
              <StatusDot status={conversation.status} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {conversationHeaderSubtitle(conversation)} · {statusLabelFor(conversation.status)}
              {conversation.currentTeamId ? ` · ${teamLabel(conversation.currentTeamId, teams)}` : ""} · {agentLabel(conversation.assignedUserId, currentUserId, members)}
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

          <TagPicker workspaceId={workspaceId} conversation={conversation} onChanged={refreshThread} />

          <ConversationActionsMenu
            canOperate={canOperate}
            canDelete={canDelete}
            conversation={conversation}
            workspaceId={workspaceId}
            teams={teams}
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
        {/* Cabeçalho compacto (pedido explícito do usuário: "evitar muitos badges e textos ao
           mesmo tempo") — a linha de badges (IA/"Humano"/etiquetas) some daqui; o estado da IA já
           é visível no responsável (linha acima) e as etiquetas continuam acessíveis pelo ícone de
           etiqueta, sem precisar de uma segunda fileira permanente. Erro de ação é a única coisa
           que ainda pode aparecer abaixo, e só quando existe. */}
        {actionError ? <p className="mt-1.5 text-xs text-destructive">{actionError}</p> : null}
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
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-1">
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
                  conversationId={conversation.id}
                  message={entry.message}
                  messages={messages}
                  isGroup={conversation.chatType === "group"}
                  onRetry={(body) => handleSend(body)}
                  retrying={sending}
                  canOperate={canOperate}
                  onReplyTo={setReplyingTo}
                  onChanged={() => mutate()}
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
        <div className="mx-auto w-full max-w-4xl space-y-2">
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
          {replyingTo ? (
            <div className="flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/60 py-1.5 pl-2.5 pr-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">Respondendo</p>
                <p className="line-clamp-1 text-muted-foreground">{replyingTo.body?.trim() || mediaLabelFor(replyingTo.type, replyingTo.direction === "outbound")}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setReplyingTo(undefined)} aria-label="Cancelar resposta">
                <X className="h-3.5 w-3.5" />
              </Button>
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
          {/* Composer como UMA superfície só (pedido explícito do usuário: "não parecer input
             simples com ícones soltos") — os ícones (anexo/emoji/enviar-ou-microfone) ficam
             integrados ao mesmo container bordado do texto, em vez de cada um com sua própria
             borda/fundo flutuando ao lado. */}
          <div className="flex items-end gap-0.5 rounded-2xl border border-border bg-background px-1.5 py-1.5 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
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
              className="max-h-36 min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus:border-0 focus:ring-0"
              rows={1}
              disabled={!canOperate || sending}
            />
            {draft.trim() ? (
              <GuardedButton
                size="icon"
                className="rounded-full"
                onClick={() => handleSend()}
                loading={sending}
                disabled={sending || !draft.trim()}
                allowed={canOperate}
                blockedReason={RBAC_COPY.operateConversations}
                aria-label="Enviar mensagem"
              >
                <Send className="h-4 w-4" />
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
  teams,
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
  teams: readonly Team[];
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

        {teams.length > 0 ? (
          <div className="border-t border-border pt-3">
            {/* Bloco "atribuição manual de equipe" (achado de suporte: "por que as conversas não
               carregam no Kanban" — sem isto, currentTeamId só era setado pelo roteamento
               automático de canal em conversas NOVAS; conversas existentes nunca ganhavam equipe). */}
            <p className="mb-1.5 text-xs font-medium text-foreground">Equipe (Kanban)</p>
            <SearchableCombo
              items={teams.map((team) => ({ id: team.id, label: team.name }))}
              value={conversation.currentTeamId ?? ""}
              onValueChange={(teamId) => onRunAction("team", () => setInboxConversationTeam(workspaceId, conversation.id, teamId || undefined))}
              placeholder="Sem equipe"
              searchPlaceholder="Buscar equipe..."
              extraOption={{ value: "", label: "Sem equipe" }}
              disabled={!canOperate || Boolean(busyAction)}
            />
          </div>
        ) : null}

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
  conversationId,
  message,
  messages,
  isGroup,
  onRetry,
  retrying,
  canOperate,
  onReplyTo,
  onChanged,
}: {
  workspaceId: string;
  conversationId: string;
  message: InboxMessage;
  /** Timeline inteira já carregada — usada só para resolver o conteúdo AO VIVO de uma resposta
   * citada (`message.quotedMessage.externalMessageId`) quando a mensagem original ainda está
   * visível aqui. Cai no snapshot gravado no momento do evento (`quotedMessage.body`/`type`) quando
   * a original não está (ou nunca esteve) carregada — nunca busca de novo no backend. */
  messages: readonly InboxMessage[];
  isGroup: boolean;
  onRetry: (body: string) => void;
  retrying: boolean;
  canOperate: boolean;
  /** Bloco "responder mensagem específica" — abre o preview de resposta no composer com esta
   * mensagem. */
  onReplyTo: (message: InboxMessage) => void;
  /** Bloco "3 pontinhos em cada mensagem" — revalida a timeline depois de excluir/reagir. */
  onChanged: () => void;
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

  // Bloco "resposta citada" (pedido explícito do usuário: "quando alguem responde uma mensagem não
  // esta mostrando o conteudo corretamente") — prefere o conteúdo AO VIVO da mensagem original
  // quando ela ainda está carregada nesta timeline (pode ter sido editada/apagada desde então,
  // embora o Vorix não suporte edição hoje), caindo no snapshot gravado no momento da resposta
  // quando ela não está (fora da janela carregada, ou de uma conversa já fundida).
  const quoted = message.quotedMessage;
  const quotedLive = quoted?.externalMessageId ? messages.find((candidate) => candidate.externalMessageId === quoted.externalMessageId) : undefined;
  const quotedBody = (quotedLive?.body ?? quoted?.body)?.trim();
  const quotedType = quotedLive?.type ?? quoted?.type;
  // Nome de quem mandou a original só é confiável quando ela ainda está carregada (`senderId` no
  // snapshot é um JID/telefone cru, nunca resolvido pra nome — mostrar isso seria pior que omitir).
  const quotedSenderLabel = quotedLive?.senderDisplayName;

  const reactionGroups = groupReactionsByEmoji(message.reactions);

  return (
    <div className={cn("group/msg flex flex-col gap-1", isOutbound ? "items-end" : "items-start")}>
      {/* Bloco "3 pontinhos ao lado, não embaixo" (pedido explícito do usuário: consumia uma linha
         inteira por mensagem, mesmo com opacity-0 — `opacity` nunca remove algo do fluxo do layout).
         Agora o menu vive na "sobra" horizontal ao lado da bolha, como o próprio WhatsApp faz —
         nunca mais reserva altura própria.
         Achado de revisão (pedido explícito do usuário: "Vai / saber" quebrando quando cabia numa
         linha só) — a causa real era `max-width: %` na BOLHA calculado contra ESTE wrapper, que por
         sua vez é shrink-to-fit (largura dele mesmo depende do conteúdo, ou seja, da bolha) —
         dependência CIRCULAR: o navegador não consegue resolver "70% de uma largura que depende de
         mim", e alguns motores de layout caem pro mínimo possível, quebrando palavra por palavra.
         O `max-w-[min(70%,44rem)]` (a regra de largura pedida, seção 22) precisa estar aqui, neste
         wrapper — cuja largura É determinada (`group/msg`, acima, ocupa 100% do container de
         mensagens via `align-items: stretch` padrão, nunca shrink-to-fit) — nunca na bolha. A bolha
         em si fica sem `max-width` própria: ela já nasce do tamanho do texto (fit-content) e o teto
         de 70% do WRAPPER a contém sozinho, sem nova dependência circular. */}
      <div className={cn("flex max-w-[min(70%,44rem)] items-center gap-1", reactionGroups.length > 0 && "mb-2.5", isOutbound ? "flex-row-reverse" : "flex-row")}>
        <div
          className={cn(
            // Bolhas mais "mensageiro moderno, não painel administrativo" (pedido explícito do
            // usuário) — sem sombra, sem borda na bolha normal (só a de erro mantém, é um alerta,
            // não uma mensagem comum), cantos mais arredondados com um "bico" discreto no canto
            // que aponta pra quem mandou, em vez do retângulo uniforme de antes.
            "relative min-w-0 rounded-2xl px-3.5 py-2.5 text-sm",
            isOutbound ? "rounded-br-md" : "rounded-bl-md",
            isOutbound
              ? failed
                ? "border border-destructive/40 bg-destructive/10 text-foreground"
                : "bg-primary text-primary-foreground dark:bg-primary-glow dark:text-background"
              : "bg-muted/70 text-foreground dark:bg-muted/40",
          )}
        >
          {senderLabel ? <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{senderLabel}</p> : null}
          {quoted ? (
            <div className={cn("mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs opacity-80", isOutbound ? "border-primary-foreground/50 bg-black/10" : "border-primary/50 bg-muted/60")}>
              {quotedSenderLabel ? <p className="mb-0.5 font-semibold">{quotedSenderLabel}</p> : null}
              <p className="line-clamp-2 break-words">{quotedBody || mediaLabelFor(quotedType ?? "other", quotedLive?.direction === "outbound")}</p>
            </div>
          ) : null}
          {isMedia ? (
            <MessageMedia workspaceId={workspaceId} message={message} />
          ) : !body ? (
            // Bug real corrigido: tipo sem renderizador dedicado (location/contact/other/sticker) e
            // sem body deixava a bolha completamente vazia (só timestamp) — nunca mais "nada".
            (() => {
              const Icon = mediaIconFor(message.type);
              return (
                // Achado de revisão: com a bolha inbound agora usando `bg-muted/70` (bolhas mais
                // "mensageiro moderno"), este fallback precisa de um tom DIFERENTE do fundo da
                // própria bolha pra continuar visível — mesmo racional do box de resposta citada
                // logo acima (`bg-black/10` no outbound, um tom próprio no inbound).
                <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2", isOutbound ? "bg-black/10" : "bg-card/80 text-muted-foreground")}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{mediaLabelFor(message.type, isOutbound)}</span>
                </div>
              );
            })()
          ) : null}
          {/* `[overflow-wrap:anywhere]` em vez de `break-words` (pedido explícito do usuário, seção
             23) — quebra palavra normal só quando REALMENTE não cabe (uma URL longa, por exemplo),
             nunca palavras curtas que cabiam na linha; nunca `break-all`, que quebraria QUALQUER
             palavra no meio mesmo sobrando espaço. */}
          {body ? <p className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", isMedia && "mt-1.5")}>{body}</p> : null}
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
          {/* Bloco "reação ao lado, não embaixo" (pedido explícito do usuário) — pendurada no canto
             inferior da própria bolha (mesmo tratamento do WhatsApp), nunca mais uma linha cheia só
             pra ela. `mb-2.5` no wrapper acima abre espaço pra ela não ficar colada na mensagem seguinte. */}
          {reactionGroups.length > 0 ? (
            <div className={cn("absolute -bottom-2.5 flex gap-0.5", isOutbound ? "right-2" : "left-2")}>
              {reactionGroups.map((group) => (
                <span
                  key={group.emoji}
                  title={group.reactorNames.join(", ")}
                  className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground shadow-sm"
                >
                  <span>{group.emoji}</span>
                  {group.count > 1 ? <span className="tabular-nums text-[10px] text-muted-foreground">{group.count}</span> : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {canOperate ? (
          <div className="shrink-0 self-end opacity-0 transition-opacity group-hover/msg:opacity-100">
            <MessageActionsMenu workspaceId={workspaceId} conversationId={conversationId} message={message} onReplyTo={onReplyTo} onChanged={onChanged} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function groupReactionsByEmoji(reactions: readonly InboxMessage["reactions"][number][]): { emoji: string; count: number; reactorNames: string[] }[] {
  const byEmoji = new Map<string, string[]>();
  for (const reaction of reactions) {
    const names = byEmoji.get(reaction.emoji) ?? [];
    names.push(reaction.reactorName ?? reaction.reactorId);
    byEmoji.set(reaction.emoji, names);
  }
  return [...byEmoji.entries()].map(([emoji, reactorNames]) => ({ emoji, count: reactorNames.length, reactorNames }));
}

/** Bloco "3 pontinhos em cada mensagem" (pedido explícito do usuário: "excluir uma mensagem que eu
 * queira.. ou clicar para reponder uma mensagem esquecifica.... reagir com emoji a uma mensagem
 * especifica") — mesmo racional de curadoria rápida do WhatsApp (6 reações comuns direto no menu,
 * sem precisar abrir o seletor completo de emoji). */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function MessageActionsMenu({
  workspaceId,
  conversationId,
  message,
  onReplyTo,
  onChanged,
}: {
  workspaceId: string;
  conversationId: string;
  message: InboxMessage;
  onReplyTo: (message: InboxMessage) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reagir exige a mensagem já confirmada pelo WhatsApp (externalMessageId) — o backend rejeita
  // sem isso; nunca oferece a ação pra uma mensagem ainda "enviando"/na fila.
  const canReact = Boolean(message.externalMessageId);

  async function react(emoji: string) {
    if (!canReact || busy) return;
    setBusy(true);
    try {
      await reactToInboxMessage(workspaceId, conversationId, message.id, emoji);
      onChanged();
    } catch {
      // Best-effort de UI — este menu é deliberadamente compacto, sem um lugar próprio pra exibir o
      // motivo específico da falha (ex.: canal sem suporte a reações); a reação simplesmente não
      // aparece, e o atendente pode tentar de novo.
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteInboxMessage(workspaceId, conversationId, message.id);
      onChanged();
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Mais ações da mensagem" className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          {canReact ? (
            <div className="flex items-center justify-between gap-0.5 border-b border-border px-0.5 pb-1.5 pt-0.5">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy}
                  onClick={() => react(emoji)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-base transition-colors hover:bg-muted disabled:opacity-50"
                  aria-label={`Reagir com ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onReplyTo(message);
              setOpen(false);
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            <Reply className="h-4 w-4" />
            Responder
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setDeleteConfirmOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            Excluir mensagem
          </button>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Excluir mensagem"
        description="Isto remove a mensagem do Vorix. Se foi você quem mandou, o Vorix também tenta apagá-la para todos no WhatsApp — mensagens de um contato só somem daqui, nunca do celular dele."
        confirmLabel="Excluir"
        variant="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </>
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
  const contextAvatarProps = avatarPropsFor(conversation);
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
          <InboxAvatar
            workspaceId={workspaceId}
            kind={contextAvatarProps.kind}
            targetId={contextAvatarProps.targetId}
            storageRef={contextAvatarProps.storageRef}
            fallback={initials(conversationTitle(conversation))}
            className="h-12 w-12 rounded-xl"
            fallbackClassName="rounded-xl bg-primary/10 text-sm text-primary dark:bg-primary-glow/10 dark:text-primary-glow"
          />
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

export function StatusDot({ status }: { status: InboxConversation["status"] }) {
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

export function agentLabel(userId: string | undefined, currentUserId: string | undefined, members: readonly InboxTenantMember[]): string {
  if (!userId) return "Sem responsável";
  if (userId === "ai") return "Vorix";
  if (userId === currentUserId) return "Você";
  const member = members.find((item) => item.userId === userId);
  if (member) return member.name;
  return userId.length > 10 ? `${userId.slice(0, 8)}...` : userId;
}

/** Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — nunca decide nada, só rotula
 * `conversation.currentTeamId` na UI. `teams` ainda não carregado/equipe já excluída — mostra o
 * id cru em vez de sumir a informação (melhor um id feio do que nenhum sinal). */
function teamLabel(teamId: string, teams: readonly Team[]): string {
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}

export function statusLabelFor(status: InboxConversation["status"]): string {
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

export function lastMessagePreviewLabel(conversation: InboxConversation): string {
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

/** ACHADO AO VIVO (relatado pelo usuário em produção, screenshot de um áudio ENVIADO direto pelo
 * celular pareado, fora do Vorix) — o rótulo de fallback dizia "recebido" incondicionalmente,
 * mesmo pra mídia outbound (self-echo). `isOutbound` (default `false`, mantém o comportamento
 * anterior nos poucos call sites que não sabem a direção — ex.: preview de mensagem citada sem a
 * original carregada) troca pro particípio de "enviado(a)". */
export function mediaLabelFor(type: InboxMessage["type"], isOutbound = false): string {
  const masc = isOutbound ? "enviado" : "recebido";
  const fem = isOutbound ? "enviada" : "recebida";
  switch (type) {
    case "image": return `Imagem ${fem}`;
    case "video": return `Video ${masc}`;
    case "audio": return `Audio ${masc}`;
    case "document": return `Documento ${masc}`;
    case "location": return `Localização ${fem}`;
    case "contact": return `Contato ${masc}`;
    case "text": return "Mensagem sem texto";
    default: return `Mídia ${fem}`;
  }
}

/** Correção do bug de identidade de conversa — título/subtítulo exibido pra uma conversa, sem
 * inventar nada: grupo sem `groupName` conhecido cai num rótulo genérico seguro ("Grupo do
 * WhatsApp"), nunca no nome do primeiro remetente (ver docs/conversas-canonical-chat-identity.md,
 * seção 10 do pedido original). */
export function conversationTitle(conversation: InboxConversation): string {
  // Fallback "Grupo" (nunca "Grupo do WhatsApp" permanente) — a metadata real chega sozinha via
  // `syncGroupMetadata` (worker) logo após a primeira mensagem; isto só aparece na janela curta
  // antes disso resolver (ver docs/conversas-inbox-organization-media-runtime.md).
  if (conversation.chatType === "group") return conversation.groupName ?? "Grupo";
  return conversation.contactName ?? conversation.contactPhone ?? "Contato";
}

/** Melhoria visual (pedido explícito do usuário: linha 2 do item da lista mostra "canal +
 * telefone/grupo") — achado de revisão: antes hardcoded "WhatsApp", nunca refletia Instagram
 * mesmo já sendo um canal de primeira classe do Inbox. `channelLabelFor` é a mesma fonte usada
 * pelo filtro de canal (`CHANNEL_FILTERS`), nunca um rótulo próprio duplicado. */
export function channelLabelFor(conversation: InboxConversation): string {
  return conversation.connectionProvider === "instagram" ? "Instagram" : "WhatsApp";
}

function conversationSubtitle(conversation: InboxConversation): string {
  const channel = channelLabelFor(conversation);
  return conversation.chatType === "group" ? `${channel} · Grupo` : `${channel} · ${conversation.contactPhone ?? "—"}`;
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

/** Deriva os parâmetros de `InboxAvatar` a partir de uma conversa — grupo usa a própria conversa
 * como alvo, direta usa o contato do outro lado (`undefined` até o primeiro contato ser vinculado,
 * ex.: grupo sem contactId — `InboxAvatar` já trata `targetId: undefined` como "sem foto ainda"). */
export function avatarPropsFor(conversation: InboxConversation): { kind: "contact" | "conversation"; targetId: string | undefined; storageRef: InboxMediaStorageRef | undefined } {
  if (conversation.chatType === "group") return { kind: "conversation", targetId: conversation.id, storageRef: conversation.groupPictureStorageRef };
  return { kind: "contact", targetId: conversation.contactId, storageRef: conversation.contactProfilePictureStorageRef };
}

export function initials(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "VX";
  const parts = normalized.split(/\s+/).slice(0, 2);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts.map((part) => part[0]).join("").toUpperCase();
}

export function timeLabel(iso: string | undefined): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
