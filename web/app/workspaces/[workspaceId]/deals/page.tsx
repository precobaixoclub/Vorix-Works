"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Search, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { DealDetailModal } from "@/components/crm/DealDetailModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { TeamPicker, teamLabel } from "@/components/TeamPicker";
import { UserPicker, userInitials, userLabel } from "@/components/UserPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createDeal, moveDealStage } from "@/features/crm/api";
import { useContacts, useDeals, usePipelines, usePipelineStages, useProposals, useTasks } from "@/features/crm/hooks";
import { centsFromCurrencyInput, nextPendingTask, TASK_TYPE_LABEL } from "@/features/crm/presentation";
import type { Contact, Deal, PipelineStage, Task } from "@/features/crm/types";
import { useTeams } from "@/features/identity/hooks";
import type { Team } from "@/features/identity/types";
import { useInboxMembers } from "@/features/inbox/hooks";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCurrencyCents, formatDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const searchParams = useSearchParams();
  const { data: pipelines } = usePipelines(workspace.id);
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [origin, setOrigin] = useState("");
  const [withoutNextAction, setWithoutNextAction] = useState(false);
  const [mobileStageId, setMobileStageId] = useState<string | undefined>();
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (!pipelineId && pipelines && pipelines.length > 0) setPipelineId((pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0]).id);
  }, [pipelines, pipelineId]);

  const { data: stages } = usePipelineStages(pipelineId, workspace.id);
  const { data: contacts, error: contactsError } = useContacts(workspace.id);
  const { data: tasks } = useTasks(workspace.id, { status: "pending" });
  const { data: proposals } = useProposals(workspace.id);
  const { data: membersData } = useInboxMembers(workspace.id);
  const { data: teams } = useTeams(workspace.id);
  const filterParams = {
    pipelineId,
    search: debouncedSearch || undefined,
    ownerUserId: ownerUserId || undefined,
    teamId: teamId || undefined,
    origin: origin.trim() || undefined,
  };
  const { data: deals, error, isLoading, mutate: mutateDeals } = useDeals(workspace.id, filterParams);

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
      current.valueCentsSum += deal.valueCents;
      map.set(deal.stageId, current);
    }
    return map;
  }, [visibleDeals]);

  const pipelineValue = visibleDeals.reduce((sum, deal) => sum + deal.valueCents, 0);

  useEffect(() => {
    if (!mobileStageId && orderedStages[0]) setMobileStageId(orderedStages[0].id);
  }, [mobileStageId, orderedStages]);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState(searchParams.get("contactId") ?? "");
  const [valueReais, setValueReais] = useState("");
  const [createOrigin, setCreateOrigin] = useState("");
  const [createOwnerUserId, setCreateOwnerUserId] = useState("");
  const [createTeamId, setCreateTeamId] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [busy, setBusy] = useState(false);

  const [hoveredStageId, setHoveredStageId] = useState<string | undefined>();
  const [movingDealId, setMovingDealId] = useState<string | undefined>();
  const [lossPrompt, setLossPrompt] = useState<{ deal: Deal; stage: PipelineStage } | undefined>();
  const [lossReason, setLossReason] = useState("");
  const [lossNotes, setLossNotes] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<string | undefined>();

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

  const selectedDeal = visibleDeals.find((deal) => deal.id === selectedDealId) ?? deals?.find((deal) => deal.id === selectedDealId);
  const contactOptions = contactsList.map((contact) => ({ id: contact.id, label: contactLabel(contact) }));

  async function refresh() {
    await mutateDeals();
  }

  async function handleCreate() {
    if (!pipelineId || orderedStages.length === 0) return;
    setBusy(true);
    try {
      await createDeal({
        workspaceId: workspace.id,
        pipelineId,
        stageId: orderedStages[0].id,
        contactId: contactId || undefined,
        title: title.trim(),
        valueCents: centsFromCurrencyInput(valueReais),
        ownerUserId: createOwnerUserId || undefined,
        teamId: createTeamId || undefined,
        origin: createOrigin.trim() || undefined,
        expectedCloseDate: expectedCloseDate || undefined,
      });
      setCreateOpen(false);
      resetCreateForm();
      await refresh();
      toast.success("Negócio criado.");
    } catch (cause) {
      toast.error("Não foi possível criar o negócio", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  function requestMoveDeal(deal: Deal, targetStage: PipelineStage) {
    setHoveredStageId(undefined);
    if (movingDealId) return;
    if (targetStage.isLost) {
      setLossPrompt({ deal, stage: targetStage });
      return;
    }
    void performMoveDeal(deal, targetStage);
  }

  async function performMoveDeal(deal: Deal, targetStage: PipelineStage, lossReasonValue?: string) {
    const previousDeals = deals;
    const movedAt = new Date().toISOString();
    setMovingDealId(deal.id);
    await mutateDeals(
      (current) => current?.map((item) => item.id === deal.id ? { ...item, stageId: targetStage.id, lastStageChangedAt: movedAt, wonAt: targetStage.isWon ? movedAt : item.wonAt, lostAt: targetStage.isLost ? movedAt : item.lostAt, lossReason: lossReasonValue ?? item.lossReason } : item),
      { revalidate: false },
    );
    try {
      await moveDealStage(deal.id, workspace.id, targetStage.id, lossReasonValue);
      await refresh();
      if (targetStage.isWon) toast.success("Negócio marcado como ganho.");
    } catch (cause) {
      await mutateDeals(previousDeals, { revalidate: false });
      toast.error("Não foi possível mover o negócio", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setMovingDealId(undefined);
    }
  }

  async function confirmLossReason() {
    if (!lossPrompt || !lossReason.trim()) return;
    const reason = lossNotes.trim() ? `${lossReason.trim()} — ${lossNotes.trim()}` : lossReason.trim();
    await performMoveDeal(lossPrompt.deal, lossPrompt.stage, reason);
    setLossPrompt(undefined);
    setLossReason("");
    setLossNotes("");
  }

  function resetCreateForm() {
    setTitle("");
    setContactId("");
    setValueReais("");
    setCreateOrigin("");
    setCreateOwnerUserId("");
    setCreateTeamId("");
    setExpectedCloseDate("");
  }

  function renderDeal(deal: Deal) {
    return (
      <DealCard
        key={deal.id}
        deal={deal}
        contact={contactsList.find((item) => item.id === deal.contactId)}
        stages={orderedStages}
        tasks={tasksList}
        members={members}
        teams={teamsList}
        moving={movingDealId === deal.id}
        onOpen={() => setSelectedDealId(deal.id)}
        onMove={(stage) => requestMoveDeal(deal, stage)}
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Negócios</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Pipeline comercial com contexto de contato, responsável, próxima atividade e propostas.</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span><strong className="font-semibold text-foreground">{formatCurrencyCents(pipelineValue)}</strong> em pipeline</span>
            <span><strong className="font-semibold text-foreground">{visibleDeals.length}</strong> negócios</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pipelines && pipelines.length > 1 ? (
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Pipeline" /></SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Button onClick={() => setCreateOpen(true)} disabled={!pipelineId || orderedStages.length === 0}>Novo negócio</Button>
        </div>
      </div>

      <FilterBar
        summary={withoutNextAction ? "Filtro: sem próxima atividade" : activePipeline ? activePipeline.name : undefined}
      >
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar negócio ou contato" className="pl-9" />
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
              {mobileDeals.length === 0 ? <EmptyState title="Sem negócios nesta etapa" description="Escolha outra etapa ou ajuste os filtros." /> : null}
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
                    {stageDeals.length === 0 ? <p className="px-1 py-8 text-center text-xs text-muted-foreground">Solte negócios aqui</p> : null}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : null}

      {createOpen ? (
        <Modal title="Novo negócio" onClose={() => { setCreateOpen(false); resetCreateForm(); }} maxWidthClass="sm:max-w-2xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="deal-title">Titulo</Label>
              <Input id="deal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Plano Pro anual" />
            </div>
            <div>
              <Label>Contato</Label>
              <SearchableCombo items={contactOptions} value={contactId} onValueChange={setContactId} placeholder="Selecionar contato" extraOption={{ value: "", label: "Sem contato" }} />
            </div>
            <div>
              <Label htmlFor="deal-value">Valor</Label>
              <Input id="deal-value" value={valueReais} onChange={(event) => setValueReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label>Responsável</Label>
              <UserPicker workspaceId={workspace.id} value={createOwnerUserId} onValueChange={setCreateOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
            </div>
            <div>
              <Label>Equipe</Label>
              <TeamPicker workspaceId={workspace.id} value={createTeamId} onValueChange={setCreateTeamId} extraOption={{ value: "", label: "Sem equipe" }} />
            </div>
            <div>
              <Label htmlFor="deal-origin">Origem</Label>
              <Input id="deal-origin" value={createOrigin} onChange={(event) => setCreateOrigin(event.target.value)} placeholder="Ex.: whatsapp, indicacao" />
            </div>
            <div>
              <Label htmlFor="deal-close">Previsao de fechamento</Label>
              <Input id="deal-close" type="date" value={expectedCloseDate} onChange={(event) => setExpectedCloseDate(event.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setCreateOpen(false); resetCreateForm(); }} disabled={busy}>Cancelar</Button>
            <Button onClick={handleCreate} loading={busy} disabled={!title.trim() || busy}>Criar</Button>
          </div>
        </Modal>
      ) : null}

      {lossPrompt ? (
        <Modal title="Motivo da perda" onClose={() => { setLossPrompt(undefined); setLossReason(""); setLossNotes(""); }}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Escolha o motivo principal. Isso alimenta o historico comercial sem expor erro tecnico ao operador.</p>
            <div>
              <Label htmlFor="loss-reason">Motivo</Label>
              <Select value={lossReason} onValueChange={setLossReason}>
                <SelectTrigger id="loss-reason"><SelectValue placeholder="Selecionar motivo" /></SelectTrigger>
                <SelectContent>
                  {["Sem orçamento", "Concorrente", "Sem timing", "Sem fit", "Não respondeu"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="loss-notes">Observacao opcional</Label>
              <Textarea id="loss-notes" value={lossNotes} onChange={(event) => setLossNotes(event.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setLossPrompt(undefined); setLossReason(""); setLossNotes(""); }}>Cancelar</Button>
              <Button variant="danger" onClick={confirmLossReason} loading={Boolean(movingDealId)} disabled={!lossReason.trim()}>Confirmar perda</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <DealDetailModal
        open={Boolean(selectedDeal)}
        onOpenChange={(open) => { if (!open) setSelectedDealId(undefined); }}
        workspaceId={workspace.id}
        deal={selectedDeal}
        pipeline={activePipeline}
        stages={orderedStages}
        contacts={contactsList}
        tasks={tasksList}
        proposals={proposalsList}
        members={members}
        teams={teamsList}
        onChanged={refresh}
        onMove={(deal, stage) => requestMoveDeal(deal, stage)}
        onCreateTask={(deal) => router.push(`/workspaces/${workspace.id}/tasks?dealId=${deal.id}${deal.contactId ? `&contactId=${deal.contactId}` : ""}`)}
        onCreateProposal={(deal) => router.push(`/workspaces/${workspace.id}/proposals?dealId=${deal.id}${deal.contactId ? `&contactId=${deal.contactId}` : ""}`)}
      />
    </main>
  );
}

function DealCard({
  deal,
  contact,
  stages,
  tasks,
  members,
  teams,
  moving,
  onOpen,
  onDragStart,
  onMove,
}: {
  deal: Deal;
  contact: Contact | undefined;
  stages: readonly PipelineStage[];
  tasks: readonly Task[];
  members: readonly { userId: string; name: string; email: string }[];
  teams: readonly Team[];
  moving: boolean;
  onOpen: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onMove: (stage: PipelineStage) => void;
}) {
  const moveTargets = stages.filter((stage) => stage.id !== deal.stageId);
  const nextTask = nextPendingTask(tasks, { dealId: deal.id });

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className={cn("group rounded-xl border border-border/70 bg-background px-3 py-3 shadow-sm transition hover:border-primary/40 hover:shadow-md md:cursor-grab md:active:cursor-grabbing", moving && "pointer-events-none opacity-60")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{contact?.name ?? deal.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{contact ? deal.title : deal.origin ?? "Sem contato vinculado"}</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Ações do negócio" onClick={(event) => event.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 p-2" onClick={(event) => event.stopPropagation()}>
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
      <p className="mt-3 text-lg font-semibold tabular-nums text-foreground">{formatCurrencyCents(deal.valueCents, deal.currency)}</p>
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
