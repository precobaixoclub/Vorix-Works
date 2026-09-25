"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyInboxFilters, KANBAN_FILTER_SECTIONS, useInboxFilterState } from "@/features/inbox/inbox-filters";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Clock, Pin, Plus, Settings2, X } from "lucide-react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import {
  createKanbanPhase,
  deleteKanbanPhase,
  ensureKanbanConversationPhaseStates,
  markInboxConversationRead,
  moveConversationPhase,
  reorderKanbanPhases,
  updateKanbanPhase,
} from "@/features/inbox/api";
import { useConversationsServiceTime, useInboxConversations, useInboxMembers, useInboxRealtime, useKanbanPhases } from "@/features/inbox/hooks";
import type { InboxConversation, KanbanPhaseType, TeamKanbanPhase } from "@/features/inbox/types";
import type { Team } from "@/features/identity/types";
import {
  agentLabel,
  ChannelIcon,
  ConversationListItemMenu,
  channelLabelFor,
  ConversationTimelinePane,
  conversationTitle,
  InboxFilterBar,
  lastMessagePreviewLabel,
  statusLabelFor,
  StatusDot,
  TagPicker,
  timeLabel,
} from "../conversas/inbox-tab";

const BOARD_STATUSES = new Set(["open", "pending"]);

/**
 * Sensor de drag próprio (pedido explícito do usuário: "o card inteiro deve poder ser agarrado...
 * não exigir clicar em um ícone específico") — o card INTEIRO vira a alça de arraste (listeners no
 * div raiz do `KanbanCard`, não mais um grip isolado). O risco disso é óbvio: clicar em •••, na
 * etiqueta ou em qualquer botão dentro do card iniciaria um drag também, já que pointerdown
 * borbulha. A correção oficial do dnd-kit pra isso é um sensor que IGNORA pointerdown de dentro de
 * qualquer elemento marcado `data-no-dnd` — nunca um `stopPropagation` espalhado pelos filhos (que
 * quebraria clique neles de outras formas). `activationConstraint.distance` (abaixo, no
 * `useSensor`) é o que já resolve "clique vira abrir, não vira mover" (pedido, seção 5) — abaixo do
 * limiar o dnd-kit nunca ativa o drag e o `click` nativo do card dispara normalmente; acima do
 * limiar o próprio dnd-kit suprime o `click` sintético que viria depois do `pointerup`.
 */
class CardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: React.PointerEvent) => {
        const target = nativeEvent.target as HTMLElement | null;
        if (target?.closest("[data-no-dnd]")) return false;
        return true;
      },
    },
  ];
}

/**
 * Board Kanban de UMA equipe — quadro estilo Trello (réplica adaptada do CMDesk, pedido explícito
 * do usuário). Nunca lista conversas resolvidas/arquivadas (`BOARD_STATUSES`) — o board é só
 * atendimento em curso. `KanbanCard` é um card PRÓPRIO (melhoria visual, pedido explícito do
 * usuário: "hoje eles estão parecendo uma cópia comprimida da lista de Conversas") — mas reusa as
 * mesmas funções/peças da tela Conversas (`ChannelIcon`, `StatusDot`, `TagPicker`, rótulos...),
 * nunca duplica lógica, só a composição visual é mais enxuta que `ConversationListItem`.
 */
export function KanbanBoard({ workspaceId, teamId, teams }: { workspaceId: string; teamId: string; teams: readonly Team[] }) {
  const router = useRouter();
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.role : undefined;
  // Achado de revisão: `inbox:assign` (permissão que o backend exige pra CRUD de fase, ver
  // inbox.route.ts) está em `INBOX_OPERATOR_PERMISSIONS` — concedida a editor/admin/owner, o MESMO
  // grupo de `inbox:reply` (mover card/fixar). Nunca `canManageTenant` (só admin/owner) — isso
  // bloquearia editores de uma ação que o backend já permite pra eles.
  const canOperate = canOperateWorkspace(role);
  const canManage = canOperate;
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;

  const { data: phasesData, error: phasesError, isLoading: phasesLoading, mutate: mutatePhases } = useKanbanPhases(workspaceId, teamId);
  // Mesma chave de cache (`["inbox-conversations", workspaceId, "all"]`) da aba Conversas — nunca
  // uma chave própria do board: `useInboxRealtime` só revalida essa chave (ver `hooks.ts`), então
  // reusá-la é o que torna o board realmente "tempo real" (SSE), não só o polling de 30s.
  const { data: conversationsData, error: conversationsError, isLoading: conversationsLoading, mutate: mutateConversations } = useInboxConversations(workspaceId, "all");
  const { data: membersData } = useInboxMembers(workspaceId);
  const members = membersData?.members ?? [];

  // Bloco "conversa dentro do Kanban" (pedido explícito do usuário: "quero abrir a conversa DENTRO
  // DO KANBAN... ao fechar, continuar exatamente onde estava") — estado local, nunca navegação. O
  // board inteiro (filtros, busca, scroll de cada coluna) nunca desmonta: só um `Dialog` sobe por
  // cima. `openConversationId` (não o objeto inteiro) porque a conversa precisa continuar reativa a
  // updates (SSE/otimista) enquanto o painel está aberto — resolvida de novo a cada render.
  const [openConversationId, setOpenConversationId] = useState<string | undefined>(undefined);
  const openConversation = (conversationsData?.conversations ?? []).find((conversation) => conversation.id === openConversationId);

  useInboxRealtime(workspaceId, openConversationId);

  function handleOpenConversation(conversationId: string) {
    setOpenConversationId(conversationId);
    const conversation = (conversationsData?.conversations ?? []).find((item) => item.id === conversationId);
    if (conversation && conversation.unreadCount > 0) {
      markInboxConversationRead(workspaceId, conversationId)
        .then(() => mutateConversations())
        .catch(() => undefined);
    }
  }

  // Mesma FilterBar/estado de URL da tela Conversas (pedido explícito do usuário: "não criar um
  // sistema de filtros diferente para cada tela") — `KANBAN_FILTER_SECTIONS` nunca inclui
  // Status/Equipe (a coluna já É a fase; o board já está escopado a UMA equipe pelo seletor do
  // cabeçalho). Como as duas telas leem os MESMOS parâmetros de querystring, aplicar um filtro em
  // Conversas e trocar pra Kanban preserva o mesmo subconjunto (seção 9 do pedido).
  const { filters, search: urlSearch, setFilter, setSearch: setUrlSearch, clearFilters } = useInboxFilterState();
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => { setSearchInput(urlSearch); }, [urlSearch]);
  useEffect(() => {
    const handle = setTimeout(() => { if (searchInput !== urlSearch) setUrlSearch(searchInput); }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const phases = useMemo(() => [...(phasesData?.phases ?? [])].sort((a, b) => a.orderIndex - b.orderIndex), [phasesData]);

  // `teamConversations` fica com o conjunto BRUTO (equipe + status de board, sem os filtros da
  // FilterBar) — usado pra garantir estado de fase e buscar tempo de atendimento de TODA conversa
  // da equipe, nunca só das visíveis (senão uma conversa filtrada fora nunca ganharia fase/cronômetro
  // corretos quando o filtro fosse removido depois). `visibleConversations` é quem alimenta as
  // colunas — contagem por coluna reflete o filtro (seção 11 do pedido: "12" e não "33").
  const teamConversations = useMemo(
    () => (conversationsData?.conversations ?? []).filter((conversation) => conversation.currentTeamId === teamId && BOARD_STATUSES.has(conversation.status)),
    [conversationsData, teamId],
  );

  const visibleConversations = useMemo(() => {
    const byFilters = applyInboxFilters(teamConversations, filters, { currentUserId });
    const term = searchInput.trim().toLowerCase();
    if (!term) return byFilters;
    return byFilters.filter((conversation) => {
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
  }, [teamConversations, filters, searchInput, currentUserId, members]);

  const conversationIds = useMemo(() => teamConversations.map((conversation) => conversation.id), [teamConversations]);

  // Conversas recém-roteadas pra equipe (ou de antes desta funcionalidade) ainda não têm
  // `currentPhaseId` — chamada idempotente, sempre antes de desenhar as colunas de verdade.
  const ensuredKeyRef = useRef<string>("");
  const [ensuring, setEnsuring] = useState(false);
  useEffect(() => {
    const pending = teamConversations.filter((conversation) => !conversation.currentPhaseId);
    if (pending.length === 0 || phases.length === 0) return;
    const key = pending.map((conversation) => conversation.id).join(",");
    if (ensuredKeyRef.current === key) return;
    ensuredKeyRef.current = key;
    setEnsuring(true);
    ensureKanbanConversationPhaseStates(workspaceId, teamId, pending.map((conversation) => conversation.id))
      .then(() => mutateConversations())
      .catch(() => {
        // Best-effort — se falhar, a próxima revalidação (polling/SSE) tenta de novo; o board
        // continua utilizável mostrando essas conversas na coluna de fallback (ver `phaseKeyFor`).
      })
      .finally(() => setEnsuring(false));
  }, [teamConversations, phases.length, workspaceId, teamId, mutateConversations]);

  const { data: serviceTimeData, mutate: mutateServiceTime } = useConversationsServiceTime(workspaceId, teamId, conversationIds);
  const serviceTimeByConversation = useMemo(() => {
    const map = new Map<string, { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean }>();
    for (const entry of serviceTimeData?.serviceTime ?? []) map.set(entry.conversationId, entry);
    return map;
  }, [serviceTimeData]);

  const firstPhaseId = phases.find((phase) => phase.isDefaultFirst)?.id ?? phases[0]?.id;
  function phaseKeyFor(conversation: InboxConversation): string {
    if (conversation.currentPhaseId && phases.some((phase) => phase.id === conversation.currentPhaseId)) return conversation.currentPhaseId;
    return firstPhaseId ?? "";
  }

  const conversationsByPhase = useMemo(() => {
    const map = new Map<string, InboxConversation[]>();
    for (const phase of phases) map.set(phase.id, []);
    for (const conversation of visibleConversations) {
      const key = phaseKeyFor(conversation);
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) bucket.push(conversation);
      else map.set(key, [conversation]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleConversations, phases]);

  // Contagem SEM filtro por fase, só pra distinguir "coluna genuinamente vazia" de "coluna com
  // conversas escondidas pelo filtro atual" (o texto de vazio muda entre as duas, seção 11 do
  // pedido — nunca sugerir "arraste uma conversa pra cá" quando na verdade existem conversas ali,
  // só invisíveis pelo filtro).
  const rawCountByPhase = useMemo(() => {
    const map = new Map<string, number>();
    for (const phase of phases) map.set(phase.id, 0);
    for (const conversation of teamConversations) {
      const key = phaseKeyFor(conversation);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamConversations, phases]);

  const [phaseManagerOpen, setPhaseManagerOpen] = useState(false);

  // `distance: 8` é o que separa CLIQUE de ARRASTE (pedido explícito do usuário, seção 5) — abaixo
  // do limiar o dnd-kit nunca ativa o drag (o `click` nativo do card dispara normal, abrindo a
  // conversa); acima dele o dnd-kit ativa e suprime o `click` sintético seguinte sozinho. Não
  // precisa de nenhum estado manual "acabei de arrastar" — é o comportamento documentado do
  // `PointerSensor` com `activationConstraint`.
  const sensors = useSensors(useSensor(CardPointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeConversation, setActiveConversation] = useState<InboxConversation | undefined>(undefined);

  async function handleMoveToPhase(conversationId: string, phaseId: string) {
    if (!canOperate) return;
    const previous = conversationsData;
    // Otimista: a UI reflete a troca antes da resposta do servidor confirmar — reconciliado pela
    // revalidação (`mutateConversations()`) logo em seguida, ou revertido se a chamada falhar.
    void mutateConversations(
      (current) =>
        current
          ? { conversations: current.conversations.map((c) => (c.id === conversationId ? { ...c, currentPhaseId: phaseId } : c)) }
          : current,
      { revalidate: false },
    );
    try {
      await moveConversationPhase(workspaceId, teamId, conversationId, phaseId);
    } catch (cause) {
      // Rollback (pedido explícito do usuário, seção 4) + toast — sem isto o card ficaria "movido"
      // na tela mesmo quando o servidor recusou, uma mentira visual silenciosa.
      void mutateConversations(previous, { revalidate: false });
      toast.error("Não foi possível mover a conversa.", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      void mutateConversations();
      void mutateServiceTime();
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const conversation = teamConversations.find((c) => c.id === String(event.active.id));
    setActiveConversation(conversation);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveConversation(undefined);
    const conversationId = String(event.active.id);
    const overPhaseId = event.over?.id ? String(event.over.id) : undefined;
    if (!overPhaseId) return;
    const conversation = teamConversations.find((c) => c.id === conversationId);
    if (!conversation || phaseKeyFor(conversation) === overPhaseId) return;
    void handleMoveToPhase(conversationId, overPhaseId);
  }

  if (phasesLoading || conversationsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (phasesError) return <ErrorState error={phasesError} onRetry={() => mutatePhases()} />;
  if (conversationsError) return <ErrorState error={conversationsError} onRetry={() => mutateConversations()} />;

  if (phases.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true">🗂️</span>}
        title="Sem fases configuradas"
        description="Esta equipe ainda não tem fases no quadro. Configure as colunas para começar."
        action={
          <GuardedButton allowed={canManage} blockedReason={RBAC_COPY.operateConversations} onClick={() => setPhaseManagerOpen(true)}>
            Configurar fases
          </GuardedButton>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {visibleConversations.length} conversa{visibleConversations.length === 1 ? "" : "s"} em atendimento{ensuring ? " · organizando fases..." : ""}
        </p>
        <GuardedButton
          allowed={canManage}
          blockedReason={RBAC_COPY.operateConversations}
          variant="secondary"
          size="sm"
          onClick={() => setPhaseManagerOpen(true)}
        >
          <Settings2 className="h-4 w-4" /> Fases
        </GuardedButton>
      </div>

      <InboxFilterBar
        workspaceId={workspaceId}
        sections={KANBAN_FILTER_SECTIONS}
        inlineSections={["owner", "channel"]}
        filters={filters}
        onFilterChange={setFilter}
        onClearFilters={clearFilters}
        search={searchInput}
        onSearchChange={setSearchInput}
        members={members}
        teams={teams}
        currentUserId={currentUserId}
      />

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveConversation(undefined)}>
        {/* Ajuste de densidade visual (pedido explícito do usuário: "as fases/colunas estão largas
           demais... o quadro ficou visualmente espalhado") — REVERTE a direção de uma rodada
           anterior (`minmax(280px, 1fr)`, que esticava cada coluna proporcionalmente pra ocupar
           toda a largura da tela): poucas fases (o caso comum) ficavam enormes, e o card dentro
           esticava junto. Agora `flex` com coluna de largura FIXA/semi-fixa (`w-72`, ver
           `KanbanColumn`) — quadro compacto tipo Trello/CRM operacional, nunca esticado; quando
           houver fases demais pra caber, o PRÓPRIO board rola horizontalmente (`overflow-x-auto`
           aqui), sem esticar nada. */}
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-2">
          {phases.map((phase) => (
            <KanbanColumn
              key={phase.id}
              workspaceId={workspaceId}
              phase={phase}
              phases={phases}
              conversations={conversationsByPhase.get(phase.id) ?? []}
              rawTotal={rawCountByPhase.get(phase.id) ?? 0}
              canOperate={canOperate}
              serviceTimeByConversation={serviceTimeByConversation}
              onMoveToPhase={handleMoveToPhase}
              onConversationChanged={() => mutateConversations()}
              onOpenConversation={handleOpenConversation}
            />
          ))}
        </div>

        {/* DragOverlay (pedido explícito do usuário, seção 2: "mostrar DragOverlay/ghost do card")
           — o card ORIGINAL fica só discretamente transparente e PARADO no lugar (ver `isDragging`
           dentro de `KanbanCard`, sem `transform` nele); quem segue o cursor é este clone, fora do
           fluxo normal do grid, então nunca empurra/redimensiona as colunas por baixo. */}
        <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
          {activeConversation ? (
            <div className="w-72 rotate-1 cursor-grabbing rounded-lg border border-primary/40 bg-card px-2 py-1.5 shadow-xl">
              <KanbanCardBody conversation={activeConversation} serviceTime={serviceTimeByConversation.get(activeConversation.id)} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openConversation ? (
        <Dialog open onOpenChange={(open) => { if (!open) setOpenConversationId(undefined); }}>
          {/* Painel lateral grande (pedido explícito do usuário, seção 8: "criar/reutilizar um
             painel grande lateral para a conversa... KANBAN continua atrás"). Achado via QA real
             (computando o `cn`/`tailwind-merge` de verdade, não só lendo o código): estender a
             `DialogContent` compartilhada (centralizada, usada no Kanban de Negócios) SOBRESCREVENDO
             a posição por className não funciona de forma confiável aqui — `tailwind-merge` não
             conhece as classes de animação do `tailwindcss-animate` (`slide-in-from-left-1/2`,
             `zoom-in-95`...) como um grupo, então elas sobrevivem ao lado das novas e brigam pela
             mesma `transform`; e `rounded-none` (sem variante) nunca cancela o `sm:rounded-lg` da
             base (são variantes de breakpoint diferentes pro tailwind-merge). Por isso este painel
             usa os primitivos do Radix DIRETO (`DialogPrimitive.Content`), com uma className própria
             do zero — nunca herda a base "dialog centralizado", nunca briga com ela. Ainda é só uma
             composição a mais do MESMO `Dialog`/`DialogOverlay`/`DialogClose` de sempre, não um
             componente de Sheet novo e paralelo. O board por baixo nunca desmonta (é só isto por
             cima) — filtros, busca e o scroll de cada coluna continuam exatamente onde estavam. */}
          <DialogPortal>
            <DialogOverlay />
            <DialogPrimitive.Content className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-full flex-col overflow-hidden border-l border-border bg-popover text-popover-foreground shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-xl md:max-w-2xl">
              <DialogTitle className="sr-only">Conversa</DialogTitle>
              <DialogClose className="absolute right-3 top-3 z-10 rounded-sm p-1 text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <X className="h-4 w-4" />
                <span className="sr-only">Fechar</span>
              </DialogClose>
              <div className="min-h-0 flex-1 pt-10">
                <ConversationTimelinePane
                  workspaceId={workspaceId}
                  conversation={openConversation}
                  currentUserId={currentUserId}
                  members={members}
                  teams={teams}
                  onBack={() => setOpenConversationId(undefined)}
                  // "Detalhes" no Kanban não tem um painel de contexto CRM próprio pra abrir aqui
                  // (isso existe só na tela Conversas) — reaproveitado como escape hatch deliberado
                  // pra quem quer a experiência completa: fecha o painel e abre a conversa na tela
                  // cheia de Conversas, mesma conversa, sem perder o Kanban (o board continua do
                  // jeito que estava quando a pessoa voltar pra esta aba).
                  onOpenContext={() => router.push(`/workspaces/${workspaceId}/conversas?conversation=${openConversation.id}`)}
                  onConversationChanged={() => mutateConversations()}
                />
              </div>
            </DialogPrimitive.Content>
          </DialogPortal>
        </Dialog>
      ) : null}

      {phaseManagerOpen ? (
        <PhaseManagerModal
          workspaceId={workspaceId}
          teamId={teamId}
          phases={phases}
          onClose={() => setPhaseManagerOpen(false)}
          onChanged={() => mutatePhases()}
        />
      ) : null}
    </div>
  );
}

function KanbanColumn({
  workspaceId,
  phase,
  phases,
  conversations,
  rawTotal,
  canOperate,
  serviceTimeByConversation,
  onMoveToPhase,
  onConversationChanged,
  onOpenConversation,
}: {
  workspaceId: string;
  phase: TeamKanbanPhase;
  phases: readonly TeamKanbanPhase[];
  conversations: readonly InboxConversation[];
  rawTotal: number;
  canOperate: boolean;
  serviceTimeByConversation: Map<string, { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean }>;
  onMoveToPhase: (conversationId: string, phaseId: string) => void;
  onConversationChanged: () => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: phase.id });
  const otherPhases = phases.filter((p) => p.id !== phase.id);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // `min-h-0` é o ponto crítico (achado só via teste real de scroll no Chromium, não por
        // leitura de código): a coluna é item de um CSS GRID (`grid-template-columns`), e um item
        // de grid tem `min-height: auto` por padrão — igual ao bug clássico do flexbox, ele cresce
        // pra caber TODO o conteúdo em vez de respeitar a altura da trilha do grid. Sem isto, com
        // muitos cards a coluna estourava a altura do board inteiro (antes vazava como "a página
        // inteira desce"; depois do `overflow-hidden` da página, os cards excedentes ficavam
        // CORTADOS/invisíveis — pior ainda). Com `min-h-0`, a coluna respeita a altura da trilha e
        // só o `overflow-y-auto` do conteúdo (abaixo) rola.
        // `w-72 shrink-0` (pedido explícito do usuário: "largura fixa ou semi-fixa... coluna não
        // deve ocupar largura excessiva quando tiver pouco conteúdo") — mesma largura pro
        // `DragOverlay` (ver `KanbanBoard`), pra o clone que segue o cursor não parecer maior/menor
        // que a coluna de origem.
        "flex h-full w-72 min-h-0 shrink-0 flex-col rounded-xl border border-border bg-surface-sunken/60 transition-colors",
        isOver && "border-primary/60 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", phase.phaseType === "PAUSED" ? "bg-amber-500" : "bg-emerald-500")} />
          <p className="truncate text-[13px] font-semibold text-foreground">{phase.name}</p>
        </div>
        {conversations.length !== rawTotal ? (
          // Contagem reflete o FILTRO, nunca o total bruto (seção 11 do pedido) — o tooltip só
          // aparece quando os dois números divergem, sem poluir visualmente o caso comum.
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary dark:bg-primary-glow/10 dark:text-primary-glow">
                {conversations.length}
              </span>
            </TooltipTrigger>
            <TooltipContent>{conversations.length} de {rawTotal} conversas nesta fase (com o filtro atual)</TooltipContent>
          </Tooltip>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{conversations.length}</span>
        )}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
        {conversations.length === 0 ? (
          // Empty state discreto (pedido explícito do usuário: "hoje colunas vazias viram grandes
          // blocos sem conteúdo") — uma linha de texto simples, sem caixa/borda própria. Texto muda
          // quando a coluna só está vazia por causa do filtro (nunca sugerir "arraste aqui" se na
          // verdade existem conversas ali, só escondidas).
          <p className="px-1.5 py-3 text-xs text-muted-foreground">
            {rawTotal > 0 ? "Nenhuma conversa com os filtros atuais nesta fase." : "Arraste uma conversa para cá."}
          </p>
        ) : (
          conversations.map((conversation) => (
            <KanbanCard
              key={conversation.id}
              workspaceId={workspaceId}
              conversation={conversation}
              canOperate={canOperate}
              phaseOptions={otherPhases}
              serviceTime={serviceTimeByConversation.get(conversation.id)}
              onMoveToPhase={(phaseId) => onMoveToPhase(conversation.id, phaseId)}
              onConversationChanged={onConversationChanged}
              onOpenConversation={onOpenConversation}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Card do Kanban (melhoria visual, pedido explícito do usuário: "hoje eles estão parecendo uma
 * cópia comprimida da lista de Conversas... mostrar apenas informações realmente úteis"; e depois,
 * na rodada de UX de drag-and-drop: "os cards estão visualmente largos/grandes demais... reduzir
 * padding/altura e dar um pequeno espaçamento entre eles") — card PRÓPRIO, mais enxuto que
 * `ConversationListItem`, agora como um "chip" com borda e cantos arredondados (em vez da lista
 * antiga com `border-b` encostada) — o pequeno `space-y-1.5` do container em `KanbanColumn` é quem
 * dá o respiro entre os cards. Ainda reusa `TagPicker`/`ConversationListItemMenu` da tela Conversas
 * pras mesmas ações de sempre, nunca uma lógica paralela.
 *
 * O CARD INTEIRO é a alça de arraste (pedido explícito do usuário: "não exigir clicar em um ícone
 * específico pra começar o drag") — `{...listeners} {...attributes}` no próprio div raiz. Os únicos
 * elementos que NÃO iniciam drag são os marcados `data-no-dnd` (ver `CardPointerSensor`, acima):
 * hoje, só a fileira de ações (etiqueta + •••) dentro de `KanbanCardBody`.
 */
function KanbanCard({
  workspaceId,
  conversation,
  canOperate,
  phaseOptions,
  serviceTime,
  onMoveToPhase,
  onConversationChanged,
  onOpenConversation,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  canOperate: boolean;
  phaseOptions: readonly TeamKanbanPhase[];
  serviceTime: { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean } | undefined;
  onMoveToPhase: (phaseId: string) => void;
  onConversationChanged: () => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: conversation.id, disabled: !canOperate });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => onOpenConversation(conversation.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenConversation(conversation.id);
        }
      }}
      className={cn(
        "relative rounded-lg border border-border/60 bg-card px-2 py-1.5 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        canOperate ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
        // Discretamente transparente, mas PARADA no lugar (pedido explícito do usuário, seção 2:
        // "não deixar card simplesmente desaparecer") — quem se move é o `DragOverlay` no board.
        isDragging && "opacity-40",
      )}
    >
      <KanbanCardBody
        conversation={conversation}
        serviceTime={serviceTime}
        actions={
          <>
            <TagPicker workspaceId={workspaceId} conversation={conversation} onChanged={onConversationChanged} />
            <ConversationListItemMenu
              workspaceId={workspaceId}
              conversation={conversation}
              onChanged={onConversationChanged}
              phaseOptions={phaseOptions}
              onMoveToPhase={onMoveToPhase}
            />
          </>
        }
      />
    </div>
  );
}

/** Conteúdo visual do card, sem hooks/handlers de drag — reusado pelo `KanbanCard` de verdade
 * (arrastável/clicável) e pelo clone dentro do `DragOverlay` (só visual, sem `actions` nenhuma:
 * botões de etiqueta/menu não fariam sentido num clone que segue o cursor). Nome+hora, canal+
 * identidade+não-lidas, preview, status+tempo de atendimento — a mesma informação de sempre, só com
 * menos espaço vertical entre as linhas. */
function KanbanCardBody({
  conversation,
  serviceTime,
  actions,
}: {
  conversation: InboxConversation;
  serviceTime: { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean } | undefined;
  actions?: React.ReactNode;
}) {
  const identity = conversation.chatType === "group" ? "Grupo" : conversation.contactPhone ?? "—";

  return (
    <>
      {conversation.isPinned ? <Pin className="absolute right-1.5 top-1.5 h-3 w-3 text-primary" aria-label="Fixado" /> : null}
      <div className="flex items-center justify-between gap-2">
        <p className={cn("min-w-0 truncate text-[13px] text-foreground", conversation.unreadCount > 0 ? "font-semibold" : "font-medium")}>
          {conversationTitle(conversation)}
        </p>
        <div className="flex shrink-0 items-center gap-0.5" data-no-dnd={actions ? "true" : undefined}>
          <span className="text-[11px] tabular-nums text-muted-foreground">{timeLabel(conversation.lastMessageAt)}</span>
          {actions}
        </div>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        <ChannelIcon provider={conversation.connectionProvider} className="h-3 w-3 shrink-0" />
        <span className="truncate">{channelLabelFor(conversation)} · {identity}</span>
        {conversation.unreadCount > 0 ? (
          <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground dark:bg-primary-glow dark:text-background">
            {conversation.unreadCount}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/80">{lastMessagePreviewLabel(conversation)}</p>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <StatusDot status={conversation.status} />
          {statusLabelFor(conversation.status)}
        </span>
        {serviceTime ? <LiveServiceBadge serviceTime={serviceTime} /> : null}
      </div>
    </>
  );
}

/** Badge "cronômetro rodando" (seção 5.3 do guia) — o backend NUNCA é consultado a cada segundo;
 * só devolve `totalSeconds` (soma das entradas RUNNING já fechadas) + `isRunning`. Este componente
 * incrementa visualmente em memória enquanto `isRunning`, resincronizando sempre que `serviceTime`
 * mudar (nova resposta do polling de 60s) — nunca o contrário. */
function LiveServiceBadge({ serviceTime }: { serviceTime: { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean } }) {
  const [liveSeconds, setLiveSeconds] = useState(serviceTime.totalSeconds);

  useEffect(() => {
    setLiveSeconds(serviceTime.totalSeconds);
    if (!serviceTime.isRunning || !serviceTime.currentPhaseStartedAt) return;
    const startedAtMs = new Date(serviceTime.currentPhaseStartedAt).getTime();
    const tick = () => setLiveSeconds(serviceTime.totalSeconds + Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [serviceTime]);

  return (
    <div className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
      <Clock className={cn("h-3 w-3", serviceTime.isRunning && "text-emerald-600")} />
      {formatDuration(liveSeconds)}
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

const PHASE_TYPE_LABEL: Record<KanbanPhaseType, string> = { RUNNING: "Conta tempo de atendimento", PAUSED: "Não conta tempo (pausa)" };

/** Gestão de fases (criar/editar/excluir/reordenar) — reordenação por botões sobe/desce em vez de
 * um segundo `DndContext` dentro do modal: o guia pede drag-and-drop para MOVER CARDS entre fases
 * (a operação de alto volume), não para reordenar as poucas colunas em si — botões são mais simples
 * e igualmente utilizáveis para uma lista curta. */
function PhaseManagerModal({
  workspaceId,
  teamId,
  phases,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  teamId: string;
  phases: readonly TeamKanbanPhase[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [phaseType, setPhaseType] = useState<KanbanPhaseType>("RUNNING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<TeamKanbanPhase | undefined>();

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await createKanbanPhase(workspaceId, teamId, name.trim(), phaseType);
      setName("");
      setPhaseType("RUNNING");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a fase.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefaultFirst(phase: TeamKanbanPhase) {
    setBusy(true);
    setError(undefined);
    try {
      await updateKanbanPhase(workspaceId, teamId, phase.id, { isDefaultFirst: true });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a fase.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePhaseType(phase: TeamKanbanPhase) {
    setBusy(true);
    setError(undefined);
    try {
      await updateKanbanPhase(workspaceId, teamId, phase.id, { phaseType: phase.phaseType === "RUNNING" ? "PAUSED" : "RUNNING" });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a fase.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleNaoContabiliza(phase: TeamKanbanPhase, value: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await updateKanbanPhase(workspaceId, teamId, phase.id, { naoContabilizaOperacional: value });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a fase.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReorder(phaseId: string, direction: -1 | 1) {
    const index = phases.findIndex((p) => p.id === phaseId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= phases.length) return;
    const reordered = [...phases];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setBusy(true);
    setError(undefined);
    try {
      await reorderKanbanPhases(workspaceId, teamId, reordered.map((p) => p.id));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reordenar as fases.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteKanbanPhase(workspaceId, teamId, pendingDelete.id);
      setPendingDelete(undefined);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a fase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Fases do quadro" onClose={onClose} maxWidthClass="sm:max-w-lg">
      <div className="flex flex-col gap-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col gap-2">
          {phases.map((phase, index) => (
            <div key={phase.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="flex flex-col">
                <button type="button" disabled={busy || index === 0} onClick={() => handleReorder(phase.id, -1)} className="text-muted-foreground disabled:opacity-30">
                  ▲
                </button>
                <button type="button" disabled={busy || index === phases.length - 1} onClick={() => handleReorder(phase.id, 1)} className="text-muted-foreground disabled:opacity-30">
                  ▼
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {phase.name} {phase.isDefaultFirst ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">(fase inicial)</span> : null}
                </p>
                <button type="button" disabled={busy} onClick={() => handleTogglePhaseType(phase)} className="text-left text-xs text-muted-foreground hover:underline">
                  {PHASE_TYPE_LABEL[phase.phaseType]}
                </button>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex shrink-0 flex-col items-center gap-0.5">
                    <Switch
                      checked={phase.naoContabilizaOperacional}
                      onCheckedChange={(value) => handleToggleNaoContabiliza(phase, value)}
                      disabled={busy}
                    />
                    <span className="text-[9px] leading-none text-muted-foreground">Fora do operacional</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Conversas nesta fase não entram nas métricas de tempo operacional (relatórios).</TooltipContent>
              </Tooltip>
              {!phase.isDefaultFirst ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleSetDefaultFirst(phase)}>
                  Tornar inicial
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" disabled={busy || phases.length <= 1} onClick={() => setPendingDelete(phase)}>
                Excluir
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-end gap-2 border-t border-border/60 pt-4">
          <div className="flex-1">
            <Label htmlFor="new-phase-name">Nova fase</Label>
            <Input id="new-phase-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Em atendimento" disabled={busy} />
          </div>
          <Select value={phaseType} onValueChange={(value) => setPhaseType(value as KanbanPhaseType)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="RUNNING">Conta tempo</SelectItem>
              <SelectItem value="PAUSED">Não conta tempo</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleCreate} disabled={busy || !name.trim()}>
            <Plus className="h-4 w-4" /> Criar
          </Button>
        </div>
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          open
          variant="danger"
          busy={busy}
          title="Excluir fase"
          description={`As conversas em "${pendingDelete.name}" serão movidas para outra fase automaticamente. Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(undefined)}
        />
      ) : null}
    </Modal>
  );
}
