"use client";

import { useMyAccess } from "@/features/auth/access";

import { Suspense, useEffect, useMemo, useState } from "react";
import { FileText, Mail, MailOpen, MessageSquareText, MoreHorizontal, Search, Settings2, SlidersHorizontal, Workflow } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { DealDetailModal } from "@/components/crm/DealDetailModal";
import { PipelineStageManager } from "@/components/crm/PipelineStageManager";
import { PipelineAutomations } from "@/components/crm/PipelineAutomations";
import { LossReasonModal } from "@/components/crm/LossReasonModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label } from "@/components/Field";
import { SearchableCombo } from "@/components/SearchableCombo";
import { TeamPicker, teamLabel } from "@/components/TeamPicker";
import { UserPicker, userInitials, userLabel } from "@/components/UserPicker";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { CloseDealModal } from "@/components/sales/DealCockpit";
import type { DealBoardView } from "@/features/crm/api";
import { moveDealStage } from "@/features/crm/api";
import { QuickCreateDealModal } from "@/components/crm/QuickCreateDealModal";
import { useContacts, useDeal, useDeals, usePipelines, usePipelineStages, useProposals, useStockRisk, useTasks } from "@/features/crm/hooks";
import { StockRiskBadge } from "@/components/sales/StockRisk";
import { DealProposalComposer } from "@/components/sales/DealProposalComposer";
import { useInvalidateSales } from "@/features/sales/hooks";
import { nextPendingTask, TASK_TYPE_LABEL } from "@/features/crm/presentation";
import type { Contact, Deal, DealStockRisk, PipelineStage, Task } from "@/features/crm/types";
import { useTeams } from "@/features/identity/hooks";
import type { Team } from "@/features/identity/types";
import { markInboxConversationRead, markInboxConversationUnread } from "@/features/inbox/api";
import { useInboxConversations, useInboxMembers, useInboxRealtime } from "@/features/inbox/hooks";
import type { InboxConversation } from "@/features/inbox/types";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCurrencyCents, formatDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { canManageTenant, canOperateWorkspace } from "@/lib/rbac";
import { ChannelIcon, ConversationTimelinePane, lastMessagePreviewLabel, timeLabel } from "../conversas/inbox-tab";

function stageDotClass(stage: PipelineStage): string {
  if (stage.isWon) return "bg-emerald-500";
  if (stage.isLost) return "bg-rose-500";
  return "bg-ai";
}

export default function DealsPage() {
  return (
    <Suspense fallback={<DealsFallback />}>
      <DealsView />
    </Suspense>
  );
}

function DealsFallback() {
  return (
    <main className="mx-auto max-w-[1540px] px-3 py-5 sm:px-6 sm:py-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-4 h-14 rounded-xl" />
      <div className="mt-5"><KanbanSkeleton /></div>
    </main>
  );
}

function DealsView() {
  const router = useRouter();
  const workspace = useCurrentWorkspace();
  const invalidateSales = useInvalidateSales(workspace.id);
  const searchParams = useSearchParams();
  const { state: authState } = useAuth();
  const currentUserId = authState.status === "authenticated" ? authState.user.id : undefined;
  const { can } = useMyAccess();
  const canGenerateProposal = can("proposal:manage");
  const canManageAutomations = can("pipeline:configure");
  const [stageManagerOpen, setStageManagerOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const { data: pipelines } = usePipelines(workspace.id);
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [ownerSelection, setOwnerUserId] = useState<string | undefined>();
  const ownerUserId = ownerSelection ?? currentUserId ?? "";
  const [teamId, setTeamId] = useState("");
  const [origin, setOrigin] = useState("");
  const [boardView, setBoardView] = useState<DealBoardView>("operational");
  const [withoutNextAction, setWithoutNextAction] = useState(false);
  const [mobileStageId, setMobileStageId] = useState<string | undefined>();
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (!pipelineId && pipelines && pipelines.length > 0) setPipelineId((pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0]).id);
  }, [pipelines, pipelineId]);

  const { data: stages, error: stagesError, mutate: mutateStages } = usePipelineStages(pipelineId, workspace.id);
  const { data: contacts, error: contactsError } = useContacts(workspace.id);
  const { data: tasks, mutate: mutateTasks } = useTasks(workspace.id);
  const { data: proposals } = useProposals(workspace.id);
  const { data: membersData } = useInboxMembers(workspace.id);
  const { data: teams } = useTeams(workspace.id);
  // Bloco "conversa no card do negócio" (pedido explícito do usuário: mostrar a conversa
  // WhatsApp/Instagram do contato vinculado direto no Kanban de Negócios, "sem direcionar para
  // outras telas") — mesma chave de cache (`["inbox-conversations", workspaceId, "all"]`) já usada
  // pela Inbox/Kanban de atendimento, então `useInboxRealtime` mantém isto atualizado em tempo real
  // aqui também, nunca uma segunda fonte de verdade.
  const { data: inboxConversationsData, mutate: mutateInboxConversations } = useInboxConversations(workspace.id, "all");
  const [chatConversation, setChatConversation] = useState<InboxConversation | undefined>();
  useInboxRealtime(workspace.id, chatConversation?.id);
  const conversationByContactId = useMemo(() => {
    const map = new Map<string, InboxConversation>();
    for (const conversation of inboxConversationsData?.conversations ?? []) {
      if (!conversation.crmContactId || conversation.chatType === "group") continue;
      const previous = map.get(conversation.crmContactId);
      if (!previous || (conversation.lastMessageAt ?? "") > (previous.lastMessageAt ?? "")) map.set(conversation.crmContactId, conversation);
    }
    return map;
  }, [inboxConversationsData]);
  const filterParams = {
    boardView,
    pipelineId,
    search: debouncedSearch || undefined,
    ownerUserId: ownerUserId || undefined,
    teamId: teamId || undefined,
    origin: origin.trim() || undefined,
  };
  const { data: deals, error, isLoading, mutate: mutateDeals } = useDeals(workspace.id, filterParams);
  // Estoque × oportunidades abertas: laranja = atenção, vermelho = revisar (ver StockRisk.tsx).
  const { data: stockRisk, mutate: mutateStockRisk } = useStockRisk(workspace.id);
  const stockRiskByDeal = useMemo(() => new Map((stockRisk?.deals ?? []).map((entry) => [entry.dealId, entry])), [stockRisk]);

  const orderedStages = useMemo(() => [...(stages ?? [])].sort((a, b) => a.position - b.position), [stages]);
  const activePipeline = pipelines?.find((pipeline) => pipeline.id === pipelineId);
  const members = membersData?.members ?? [];
  const contactsList = contacts ?? [];
  const tasksList = tasks ?? [];
  const proposalsList = proposals ?? [];
  const teamsList = teams ?? [];

  const visibleDeals = useMemo(() => {
    const list = deals ?? [];
    if (!withoutNextAction) return list;
    return list.filter((deal) => !nextPendingTask(tasksList, { dealId: deal.id }));
  }, [deals, tasksList, withoutNextAction]);

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const deal of visibleDeals) {
      const list = map.get(deal.stageId) ?? [];
      list.push(deal);
      map.set(deal.stageId, list);
    }
    return map;
  }, [visibleDeals]);

  const summaryByStage = useMemo(() => {
    const map = new Map<string, { count: number; valueCentsSum: number }>();
    for (const deal of visibleDeals) {
      const current = map.get(deal.stageId) ?? { count: 0, valueCentsSum: 0 };
      current.count += 1;
      current.valueCentsSum += deal.status === "won" ? deal.finalValueCents ?? deal.valueCents : deal.valueCents;
      map.set(deal.stageId, current);
    }
    return map;
  }, [visibleDeals]);

  const pipelineValue = visibleDeals.reduce((sum, deal) => sum + (deal.status === "won" ? deal.finalValueCents ?? deal.valueCents : deal.valueCents), 0);
  const openPipelineValue = visibleDeals.filter(deal => !deal.status || deal.status === "open").reduce((sum, deal) => sum + deal.valueCents, 0);

  useEffect(() => {
    const matching = boardView === "won" ? orderedStages.filter(s => s.isWon) : boardView === "lost" ? orderedStages.filter(s => s.isLost) : boardView === "closed" || boardView === "archived" ? orderedStages.filter(s => visibleDeals.some(d => d.stageId === s.id)) : orderedStages;
    if (matching[0] && (!mobileStageId || !matching.some(s => s.id === mobileStageId))) setMobileStageId(matching[0].id);
  }, [mobileStageId, orderedStages, boardView, visibleDeals]);

  const [createOpen, setCreateOpen] = useState(false);
  const [contactId, setContactId] = useState(searchParams.get("contactId") ?? "");

  const [hoveredStageId, setHoveredStageId] = useState<string | undefined>();
  const [movingDealId, setMovingDealId] = useState<string | undefined>();
  const [winPrompt, setWinPrompt] = useState<{ deal: Deal; stage: PipelineStage }>();
  const [lossPrompt, setLossPrompt] = useState<{ deal: Deal; stage: PipelineStage } | undefined>();
  const [selectedDealId, setSelectedDealId] = useState<string | undefined>();
  const [proposalDeal, setProposalDeal] = useState<Deal>();

  useEffect(() => {
    const queryContactId = searchParams.get("contactId");
    if (queryContactId) {
      setContactId(queryContactId);
      setCreateOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const queryDealId = searchParams.get("dealId");
    if (queryDealId) setSelectedDealId(queryDealId);
  }, [searchParams]);

  const selectedFromBoard = deals?.find((deal) => deal.id === selectedDealId);
  // Links de uma oportunidade específica continuam abrindo mesmo fora do filtro inicial.
  const { data: requestedDeal } = useDeal(workspace.id, selectedFromBoard ? undefined : selectedDealId);
  const selectedDeal = selectedFromBoard ?? requestedDeal;
  const { data: selectedDealStages } = usePipelineStages(selectedDeal?.pipelineId, workspace.id);
  const contactOptions = contactsList.map((contact) => ({ id: contact.id, label: contactLabel(contact) }));

  async function refresh() {
    await Promise.all([mutateTasks(), mutateStockRisk(), invalidateSales()]);
  }

  function requestMoveDeal(deal: Deal, targetStage: PipelineStage) {
    setHoveredStageId(undefined);
    const permission = targetStage.isWon ? "deal:win" : targetStage.isLost ? "deal:lose" : deal.status !== "open" ? "deal:reopen" : "deal:manage";
    if (!can("deal:manage") || !can(permission)) { toast.error("Sem permissão para mover esta oportunidade."); return; }
    if (movingDealId || deal.stageId === targetStage.id) return;
    if (deal.status && deal.status !== "open" && (targetStage.isWon || targetStage.isLost)) { toast.info("Reabra a oportunidade em uma fase em andamento antes de registrar outro resultado."); return; }
    if (targetStage.isWon) { setWinPrompt({ deal, stage: targetStage }); return; }
    if (targetStage.isLost) {
      setLossPrompt({ deal, stage: targetStage });
      return;
    }
    void performMoveDeal(deal, targetStage);
  }

  async function performMoveDeal(deal: Deal, targetStage: PipelineStage, lossReasonValue?: string, lossComment?: string, closing?: { finalValueCents?: number; closedAt?: string }) {
    const previousDeals = deals;
    const movedAt = new Date().toISOString();
    setMovingDealId(deal.id);
    await mutateDeals(
      (current) => current?.map((item) => item.id === deal.id ? { ...item, stageId: targetStage.id, lastStageChangedAt: movedAt, wonAt: targetStage.isWon ? movedAt : item.wonAt, lostAt: targetStage.isLost ? movedAt : item.lostAt, lossReason: lossReasonValue ?? item.lossReason } : item),
      { revalidate: false },
    );
    try {
      await moveDealStage(deal.id, workspace.id, targetStage.id, lossReasonValue, lossComment, closing);
      await refresh();
      if (targetStage.isWon) toast.success("Oportunidade ganha 🎉");
      return true;
    } catch (cause) {
      await mutateDeals(previousDeals, { revalidate: false });
      toast.error("Não foi possível mover a oportunidade", { description: cause instanceof Error ? cause.message : "Tente novamente." });
      return false;
    } finally {
      setMovingDealId(undefined);
    }
  }

  async function handleToggleConversationRead(conversation: InboxConversation) {
    try {
      if (conversation.unreadCount > 0) await markInboxConversationRead(workspace.id, conversation.id);
      else await markInboxConversationUnread(workspace.id, conversation.id);
      await mutateInboxConversations();
    } catch (cause) {
      toast.error("Não foi possível atualizar a conversa", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    }
  }

  // Pedido explícito do usuário: destaque de não lida some "até ser respondida ou marcada como
  // lida" — abrir a conversa (card/menu) já conta como lida, mesmo racional de `handleSelect` na
  // tela Conversas (`inbox-tab.tsx`). Aqui precisa ser explícito porque só reusamos
  // `ConversationTimelinePane` sozinho, sem o `InboxTab` que faria isso por conta própria.
  function handleOpenConversation(conversation: InboxConversation) {
    setChatConversation(conversation);
    if (conversation.unreadCount > 0) {
      markInboxConversationRead(workspace.id, conversation.id)
        .then(() => mutateInboxConversations())
        .catch(() => undefined);
    }
  }

  async function confirmLossReason(reason: string, comment?: string) {
    if (!lossPrompt) return;
    if (await performMoveDeal(lossPrompt.deal, lossPrompt.stage, reason, comment)) setLossPrompt(undefined);
  }

  function resetCreateForm() {
    setContactId("");
  }

  function renderDeal(deal: Deal) {
    return (
      <DealCard
        key={deal.id}
        deal={deal}
        stockRisk={deal.status === "open" ? stockRiskByDeal.get(deal.id) : undefined}
        contact={contactsList.find((item) => item.id === deal.contactId)}
        conversation={deal.contactId ? conversationByContactId.get(deal.contactId) : undefined}
        stages={can("deal:manage") ? orderedStages.filter(stage => stage.isWon ? can("deal:win") : stage.isLost ? can("deal:lose") : deal.status === "open" || can("deal:reopen")) : []}
        tasks={tasksList}
        members={members}
        teams={teamsList}
        moving={movingDealId === deal.id}
        onOpen={() => setSelectedDealId(deal.id)}
        onGenerateProposal={() => setProposalDeal(deal)}
        canGenerateProposal={canGenerateProposal}
        onMove={(stage) => requestMoveDeal(deal, stage)}
        onOpenConversation={handleOpenConversation}
        onToggleConversationRead={handleToggleConversationRead}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", deal.id);
        }}
      />
    );
  }

  const selectedMobileStage = orderedStages.find((stage) => stage.id === mobileStageId) ?? orderedStages[0];
  const mobileDeals = selectedMobileStage ? dealsByStage.get(selectedMobileStage.id) ?? [] : [];

  return (
    <main className="mx-auto max-w-[1540px] px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Oportunidades</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Acompanhe as oportunidades comerciais da sua empresa, da primeira conversa até o fechamento.</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span><strong className="font-semibold text-foreground">{formatCurrencyCents(boardView === "operational" || boardView === "open" ? openPipelineValue : pipelineValue)}</strong> {boardView === "operational" || boardView === "open" ? "em andamento" : "na consulta"}</span>
            <span><strong className="font-semibold text-foreground">{visibleDeals.length}</strong> oportunidades</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageAutomations ? <Button variant="secondary" disabled={!pipelineId || !stages || !!stagesError} onClick={() => setStageManagerOpen(true)}><Settings2 className="mr-2 h-4 w-4" />Fases</Button> : null}
          {canManageAutomations ? <Button variant="secondary" disabled={!activePipeline} onClick={() => setAutomationsOpen(true)}><Workflow className="mr-2 h-4 w-4" />Automações</Button> : null}
          {pipelines && pipelines.length > 1 ? (
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Pipeline" /></SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Button onClick={() => setCreateOpen(true)} disabled={!can("deal:manage") || !pipelineId || orderedStages.length === 0}>Nova oportunidade</Button>
        </div>
      </div>

      {stageManagerOpen && pipelineId ? <PipelineStageManager key={pipelineId} workspaceId={workspace.id} pipelineId={pipelineId} stages={orderedStages} onClose={() => setStageManagerOpen(false)} onChanged={() => mutateStages()} /> : null}
      {automationsOpen && activePipeline ? <PipelineAutomations key={activePipeline.id} workspaceId={workspace.id} pipeline={activePipeline} onClose={() => setAutomationsOpen(false)} /> : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Label htmlFor="opportunity-view">Exibir</Label>
        <Select value={boardView} onValueChange={value => setBoardView(value as DealBoardView)}>
          <SelectTrigger id="opportunity-view" className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="operational">Kanban operacional</SelectItem>
            <SelectItem value="open">Em andamento</SelectItem>
            <SelectItem value="won">Ganhas</SelectItem>
            <SelectItem value="lost">Perdidas</SelectItem>
            <SelectItem value="closed">Encerradas</SelectItem>
            <SelectItem value="archived">Arquivadas</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{boardView === "operational" ? "Encerradas aparecem até o prazo de arquivamento definido nas regras comerciais." : "Os filtros de consulta incluem oportunidades arquivadas."}</p>
      </div>

      <FilterBar
        summary={[activePipeline?.name, ownerUserId === currentUserId ? "Minhas oportunidades" : ownerUserId ? userLabel(ownerUserId, members) : "Todos os responsáveis", withoutNextAction ? "Sem próxima atividade" : undefined].filter(Boolean).join(" · ")}
      >
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar oportunidade ou contato" className="pl-9" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Filtros
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] space-y-3">
            <div>
              <Label>Responsável</Label>
              <UserPicker workspaceId={workspace.id} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Todos" }} />
            </div>
            <div>
              <Label>Equipe</Label>
              <TeamPicker workspaceId={workspace.id} value={teamId} onValueChange={setTeamId} extraOption={{ value: "", label: "Todas" }} />
            </div>
            <div>
              <Label htmlFor="deal-origin-filter">Origem</Label>
              <Input id="deal-origin-filter" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Ex.: whatsapp" />
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm">
              <input type="checkbox" checked={withoutNextAction} onChange={(event) => setWithoutNextAction(event.target.checked)} />
              Sem próxima atividade
            </label>
          </PopoverContent>
        </Popover>
      </FilterBar>

      {contactsError ? <div className="mb-4"><ErrorState error={contactsError} /></div> : null}
      {isLoading ? <KanbanSkeleton /> : null}
      {error ? <ErrorState error={error} onRetry={() => refresh()} /> : null}
      {!isLoading && !error && orderedStages.length === 0 ? (
        <EmptyState title="Nenhuma etapa configurada" description="Este pipeline ainda não tem etapas configuradas." />
      ) : null}

      {!isLoading && !error && orderedStages.length > 0 ? (
        <>
          <div className="md:hidden">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-2">
              {orderedStages.map((stage) => {
                const stageSummary = summaryByStage.get(stage.id);
                const selected = selectedMobileStage?.id === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setMobileStageId(stage.id)}
                    className={cn(
                      "flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", stageDotClass(stage))} />
                    {stage.name}
                    <span className="rounded-full bg-background/20 px-1.5 tabular-nums">{stageSummary?.count ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {mobileDeals.map(renderDeal)}
              {mobileDeals.length === 0 ? <EmptyState title="Sem oportunidades nesta etapa" description="Escolha outra etapa ou ajuste os filtros." /> : null}
            </div>
          </div>

          <div className="hidden gap-4 overflow-x-auto pb-4 md:flex">
            {orderedStages.map((stage) => {
              const stageDeals = dealsByStage.get(stage.id) ?? [];
              const stageSummary = summaryByStage.get(stage.id);
              return (
                <section
                  key={stage.id}
                  onDragOver={(event) => { event.preventDefault(); if (!movingDealId) setHoveredStageId(stage.id); }}
                  onDragLeave={() => setHoveredStageId((current) => (current === stage.id ? undefined : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dealId = event.dataTransfer.getData("text/plain");
                    const deal = visibleDeals.find((item) => item.id === dealId);
                    if (deal) requestMoveDeal(deal, stage);
                  }}
                  className={cn("flex w-80 flex-shrink-0 flex-col rounded-2xl border border-border/70 bg-card/80 transition", hoveredStageId === stage.id ? "border-primary/50 bg-primary/5 ring-2 ring-primary/15" : "")}
                >
                  <header className="shrink-0 border-b border-border/70 px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 rounded-full", stageDotClass(stage))} />
                      <span className="truncate text-sm font-semibold text-foreground">{stage.name}</span>
                      <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{stageSummary?.count ?? 0}</span>
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatCurrencyCents(stageSummary?.valueCentsSum ?? 0)}</p>
                  </header>
                  <div className="min-h-[220px] flex-1 space-y-2 overflow-y-auto p-2">
                    {stageDeals.map(renderDeal)}
                    {stageDeals.length === 0 ? <p className="px-1 py-8 text-center text-xs text-muted-foreground">Solte oportunidades aqui</p> : null}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : null}

      {proposalDeal ? <DealProposalComposer workspaceId={workspace.id} deal={proposalDeal} contactName={proposalDeal.contactId ? conversationByContactId.get(proposalDeal.contactId)?.contactName || contactsList.find(contact => contact.id === proposalDeal.contactId)?.name : undefined} onClose={() => setProposalDeal(undefined)} onChanged={refresh} /> : null}

      {createOpen ? (
        <QuickCreateDealModal
          workspaceId={workspace.id}
          contactId={contactId || undefined}
          defaultOwnerUserId={ownerUserId || currentUserId}
          onClose={() => { setCreateOpen(false); resetCreateForm(); }}
          onCreated={async (deal) => {
            setCreateOpen(false);
            resetCreateForm();
            await refresh();
            setSelectedDealId(deal.id);
            toast.success("Oportunidade criada.");
          }}
        />
      ) : null}

      {winPrompt ? <CloseDealModal mode="won" deal={winPrompt.deal} reasons={[]} competitors={[]} onClose={() => setWinPrompt(undefined)} onConfirm={async input => {
        if (await performMoveDeal(winPrompt.deal, winPrompt.stage, undefined, input.comment, { finalValueCents: input.finalValueCents, closedAt: input.closedAt })) setWinPrompt(undefined);
      }} /> : null}
      {lossPrompt ? (
        <LossReasonModal onClose={() => setLossPrompt(undefined)} onConfirm={confirmLossReason} busy={Boolean(movingDealId)} />
      ) : null}

      {chatConversation ? (
        <Dialog open onOpenChange={(open) => { if (!open) setChatConversation(undefined); }}>
          <DialogContent className="flex h-[85vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 pt-10 sm:rounded-xl">
            <DialogTitle className="sr-only">Conversa</DialogTitle>
            {/* `pt-10` acima reserva espaço pro X de fechar do Radix (absolute right-4 top-4) nunca
               sobrepor os botões do próprio cabeçalho da conversa ("Detalhes"/menu de ações). */}
            <div className="min-h-0 flex-1">
              <ConversationTimelinePane
                workspaceId={workspace.id}
                conversation={chatConversation}
                currentUserId={currentUserId}
                members={members}
                teams={teamsList}
                onBack={() => setChatConversation(undefined)}
                onOpenContext={() => {
                  const owningDeal = visibleDeals.find((item) => item.contactId === chatConversation.crmContactId);
                  setChatConversation(undefined);
                  if (owningDeal) setSelectedDealId(owningDeal.id);
                }}
                onConversationChanged={() => mutateInboxConversations()}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <DealDetailModal
        open={Boolean(selectedDeal)}
        onOpenChange={(open) => { if (!open) setSelectedDealId(undefined); }}
        workspaceId={workspace.id}
        deal={selectedDeal}
        pipeline={pipelines?.find((pipeline) => pipeline.id === selectedDeal?.pipelineId)}
        stages={selectedDealStages ?? []}
        contacts={contactsList}
        tasks={tasksList}
        proposals={proposalsList}
        members={members}
        teams={teamsList}
        onChanged={refresh}
        onMove={(deal, stage) => requestMoveDeal(deal, stage)}
        onOpenConversation={selectedDeal?.contactId && conversationByContactId.has(selectedDeal.contactId) ? (deal) => {
          const conversation = deal.contactId ? conversationByContactId.get(deal.contactId) : undefined;
          if (!conversation) return;
          setSelectedDealId(undefined);
          handleOpenConversation(conversation);
        } : undefined}
        onOpenContact={(contactId) => router.push(`/workspaces/${workspace.id}/contacts?contactId=${contactId}`)}
      />
    </main>
  );
}

function DealCard({
  deal,
  stockRisk,
  contact,
  conversation,
  stages,
  tasks,
  members,
  teams,
  moving,
  onOpen,
  onGenerateProposal,
  canGenerateProposal,
  onDragStart,
  onMove,
  onOpenConversation,
  onToggleConversationRead,
}: {
  deal: Deal;
  /** Alerta de estoque desta oportunidade aberta (laranja/vermelho). */
  stockRisk?: DealStockRisk;
  contact: Contact | undefined;
  /** Conversa (WhatsApp/Instagram) do Inbox vinculada ao contato deste negócio, se houver — pedido
   * explícito do usuário: ver e agir sobre ela direto no card, sem abrir o negócio. */
  conversation: InboxConversation | undefined;
  stages: readonly PipelineStage[];
  tasks: readonly Task[];
  members: readonly { userId: string; name: string; email: string }[];
  teams: readonly Team[];
  moving: boolean;
  onOpen: () => void;
  onGenerateProposal: () => void;
  canGenerateProposal: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onMove: (stage: PipelineStage) => void;
  onOpenConversation: (conversation: InboxConversation) => void;
  onToggleConversationRead: (conversation: InboxConversation) => void;
}) {
  const moveTargets = stages.filter((stage) => stage.id !== deal.stageId);
  const nextTask = nextPendingTask(tasks, { dealId: deal.id });
  const isUnread = Boolean(conversation && conversation.unreadCount > 0);

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className={cn(
        "group rounded-xl border border-border/70 bg-background px-3 py-3 shadow-sm transition hover:border-primary/40 hover:shadow-md md:cursor-grab md:active:cursor-grabbing",
        moving && "pointer-events-none opacity-60",
        // Pedido explícito do usuário: conversa não lida do contato "circulada e destacada em
        // verde até ser respondida ou marcada como lida" — abrir a conversa (`onOpenConversation`)
        // já marca como lida (ver `ConversationTimelinePane`), o que faz este destaque sumir sozinho.
        isUnread && "ring-2 ring-emerald-500 bg-emerald-50/70 hover:bg-emerald-50 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15",
        !isUnread && stockRisk?.level === "critical" && "border-destructive/60 ring-1 ring-destructive/40 bg-destructive/[0.04]",
        !isUnread && stockRisk?.level === "warning" && "border-orange-500/60 ring-1 ring-orange-500/40 bg-orange-500/[0.04]",
      )}
    >
      {stockRisk ? <StockRiskBadge risk={stockRisk} className="mb-2" /> : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{conversation?.contactName?.trim() || contact?.name?.trim() || conversation?.contactPhone || deal.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{contact ? deal.title : deal.origin ?? "Sem contato vinculado"}</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Ações da oportunidade" onClick={(event) => event.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 p-2" onClick={(event) => event.stopPropagation()}>
            {conversation ? (
              <>
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Conversa</p>
                <div className="space-y-1 pb-2">
                  <button
                    type="button"
                    onClick={() => onOpenConversation(conversation)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">Conversar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleConversationRead(conversation)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    {isUnread ? <MailOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{isUnread ? "Marcar como lida" : "Marcar como não lida"}</span>
                  </button>
                </div>
              </>
            ) : null}
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mover para</p>
            <div className="space-y-1">
              {moveTargets.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => onMove(stage)}
                  disabled={moving}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", stageDotClass(stage))} />
                  <span className="truncate">{stage.name}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {conversation ? (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onOpenConversation(conversation); }}
          className={cn(
            "mt-2 flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
            isUnread
              ? "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15"
              : "border-border/70 bg-muted/40 text-muted-foreground hover:bg-muted",
          )}
        >
          <ChannelIcon provider={conversation.connectionProvider} className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className={cn("min-w-0 flex-1 truncate", isUnread && "font-medium text-foreground")}>{lastMessagePreviewLabel(conversation)}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{timeLabel(conversation.lastMessageAt)}</span>
          {isUnread ? (
            <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold tabular-nums text-white">
              {conversation.unreadCount}
            </span>
          ) : null}
        </button>
      ) : null}
      {deal.archivedAt ? <span className="mt-2 inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Arquivada</span> : null}
      <p className="mt-3 text-lg font-semibold tabular-nums text-foreground">{formatCurrencyCents(deal.status === "won" ? deal.finalValueCents ?? deal.valueCents : deal.valueCents, deal.currency)}</p>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">{userInitials(deal.ownerUserId, members)}</span>
          <span className="truncate">{userLabel(deal.ownerUserId, members)}</span>
        </span>
        <span className="shrink-0">{formatRelativeTime(deal.lastStageChangedAt)}</span>
      </div>
      <div className="mt-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
        {nextTask ? `${TASK_TYPE_LABEL[nextTask.type]} · ${nextTask.title} · ${formatDate(nextTask.dueAt)}` : "Sem próxima atividade"}
      </div>
      {deal.origin || deal.teamId ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          {deal.origin ? <span className="rounded-full bg-muted px-2 py-0.5">{deal.origin}</span> : null}
          {deal.teamId ? <span className="rounded-full bg-muted px-2 py-0.5">{teamLabel(deal.teamId, teams)}</span> : null}
        </div>
      ) : null}
      {(deal.status === "open" || (!deal.status && !deal.wonAt && !deal.lostAt)) ? <Button className="mt-3 w-full gap-2" disabled={!canGenerateProposal || moving} onClick={event => { event.stopPropagation(); onGenerateProposal(); }}><FileText className="h-4 w-4" />Gerar proposta</Button> : null}
    </article>
  );
}

function KanbanSkeleton() {
  return (
    <div className="hidden gap-4 overflow-hidden md:flex">
      {[0, 1, 2, 3].map((column) => (
        <div key={column} className="w-80 shrink-0 rounded-2xl border border-border/70 bg-card p-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-3 w-24" />
          <div className="mt-4 space-y-2">
            {[0, 1, 2].map((card) => <Skeleton key={card} className="h-32 rounded-xl" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function contactLabel(contact: Contact): string {
  return contact.company ? `${contact.name} · ${contact.company}` : contact.name;
}
