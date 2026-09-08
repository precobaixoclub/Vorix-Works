"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createDeal, moveDealStage } from "@/features/crm/api";
import { useDeals, useDealsSummary, usePipelines, usePipelineStages } from "@/features/crm/hooks";
import type { Deal, PipelineStage } from "@/features/crm/types";
import { formatCurrencyCents, formatRelativeTime } from "@/lib/format";
import { useDebounce } from "@/hooks/useDebounce";

function stageDotClass(stage: PipelineStage): string {
  if (stage.isWon) return "bg-emerald-500";
  if (stage.isLost) return "bg-rose-500";
  return "bg-sky-500";
}

function DealCard({ deal, onDragStart }: { deal: Deal; onDragStart: (event: React.DragEvent) => void }) {
  return (
    <Card
      draggable
      onDragStart={onDragStart}
      className="cursor-grab select-none p-3 shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:cursor-grabbing"
    >
      <p className="truncate text-sm font-medium text-foreground">{deal.title}</p>
      {deal.origin ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{deal.origin}</p> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium tabular-nums text-muted-foreground">{formatCurrencyCents(deal.valueCents, deal.currency)}</span>
        <span className="text-xs text-muted-foreground">{formatRelativeTime(deal.lastStageChangedAt)}</span>
      </div>
    </Card>
  );
}

export default function DealsPage() {
  const workspace = useCurrentWorkspace();
  const { data: pipelines } = usePipelines(workspace.id);
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const debouncedOwner = useDebounce(ownerUserId, 300);

  useEffect(() => {
    if (!pipelineId && pipelines && pipelines.length > 0) setPipelineId(pipelines[0].id);
  }, [pipelines, pipelineId]);

  const { data: stages } = usePipelineStages(pipelineId, workspace.id);
  const filterParams = { pipelineId, search: debouncedSearch || undefined, ownerUserId: debouncedOwner || undefined };
  const { data: deals, error, isLoading, mutate: mutateDeals } = useDeals(workspace.id, filterParams);
  const { data: summary, mutate: mutateSummary } = useDealsSummary(workspace.id, pipelineId, { search: debouncedSearch || undefined, ownerUserId: debouncedOwner || undefined });

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [valueReais, setValueReais] = useState("");
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);

  const [hoveredStageId, setHoveredStageId] = useState<string | undefined>();
  const [lossPrompt, setLossPrompt] = useState<{ dealId: string; stageId: string } | undefined>();
  const [lossReason, setLossReason] = useState("");

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const deal of deals ?? []) {
      const list = map.get(deal.stageId) ?? [];
      list.push(deal);
      map.set(deal.stageId, list);
    }
    return map;
  }, [deals]);

  const summaryByStage = useMemo(() => {
    const map = new Map<string, { count: number; valueCentsSum: number }>();
    for (const item of summary ?? []) map.set(item.stageId, item);
    return map;
  }, [summary]);

  async function refresh() {
    await Promise.all([mutateDeals(), mutateSummary()]);
  }

  async function handleCreate() {
    if (!pipelineId || !stages || stages.length === 0) return;
    setBusy(true);
    try {
      const cents = Math.round(Number(valueReais.replace(",", ".")) * 100) || 0;
      await createDeal({ workspaceId: workspace.id, pipelineId, stageId: stages[0].id, title: title.trim(), valueCents: cents, origin: origin.trim() || undefined });
      setCreateOpen(false);
      setTitle("");
      setValueReais("");
      setOrigin("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDrop(targetStage: PipelineStage, dealId: string) {
    setHoveredStageId(undefined);
    if (targetStage.isLost) {
      setLossPrompt({ dealId, stageId: targetStage.id });
      return;
    }
    await moveDealStage(dealId, workspace.id, targetStage.id);
    await refresh();
  }

  async function confirmLossReason() {
    if (!lossPrompt || !lossReason.trim()) return;
    await moveDealStage(lossPrompt.dealId, workspace.id, lossPrompt.stageId, lossReason.trim());
    setLossPrompt(undefined);
    setLossReason("");
    await refresh();
  }

  return (
    <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Negócios"
        description="Kanban de vendas — arraste um negócio entre as etapas para atualizar o funil."
        actions={<Button onClick={() => setCreateOpen(true)} disabled={!pipelineId}>Novo negócio</Button>}
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2">
          {pipelines && pipelines.length > 1 ? (
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Pipeline" /></SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título" className="max-w-xs" />
          <Input value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} placeholder="ID do responsável" className="max-w-xs" />
        </CardBody>
      </Card>

      {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
      {error ? <ErrorState error={error} onRetry={() => refresh()} /> : null}
      {!isLoading && !error && stages && stages.length === 0 ? (
        <EmptyState title="Nenhuma etapa configurada" description="Este pipeline ainda não tem etapas." />
      ) : null}

      {stages && stages.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            const stageSummary = summaryByStage.get(stage.id);
            return (
              <div
                key={stage.id}
                onDragOver={(event) => { event.preventDefault(); setHoveredStageId(stage.id); }}
                onDragLeave={() => setHoveredStageId((current) => (current === stage.id ? undefined : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  const dealId = event.dataTransfer.getData("text/plain");
                  if (dealId) void handleDrop(stage, dealId);
                }}
                className={`flex max-h-full w-72 flex-shrink-0 flex-col rounded-xl transition-colors ${hoveredStageId === stage.id ? "bg-primary/5" : "bg-muted/30"}`}
              >
                <div className="flex shrink-0 items-center gap-2 p-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${stageDotClass(stage)}`} />
                  <span className="truncate text-sm font-medium text-foreground">{stage.name}</span>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{stageSummary?.count ?? stageDeals.length}</span>
                </div>
                <p className="shrink-0 px-3 pb-2 text-xs tabular-nums text-muted-foreground">{formatCurrencyCents(stageSummary?.valueCentsSum ?? 0)}</p>
                <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {stageDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onDragStart={(event) => event.dataTransfer.setData("text/plain", deal.id)}
                    />
                  ))}
                  {stageDeals.length === 0 ? <p className="px-1 py-4 text-center text-xs text-muted-foreground">Sem negócios</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {createOpen ? (
        <Modal title="Novo negócio" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="deal-title">Título</Label>
              <Input id="deal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Venda de pacote anual" />
            </div>
            <div>
              <Label htmlFor="deal-value">Valor (R$)</Label>
              <Input id="deal-value" value={valueReais} onChange={(event) => setValueReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label htmlFor="deal-origin">Origem (opcional)</Label>
              <Input id="deal-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Ex.: whatsapp, indicação" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreate} loading={busy} disabled={!title.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {lossPrompt ? (
        <Modal title="Motivo da perda" onClose={() => { setLossPrompt(undefined); setLossReason(""); }}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Descreva por que este negócio foi perdido — isso fica registrado no histórico.</p>
            <div>
              <Label htmlFor="loss-reason">Motivo</Label>
              <Textarea id="loss-reason" value={lossReason} onChange={(event) => setLossReason(event.target.value)} placeholder="Ex.: sem orçamento, foi com concorrente..." rows={3} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setLossPrompt(undefined); setLossReason(""); }}>Cancelar</Button>
              <Button variant="danger" onClick={confirmLossReason} disabled={!lossReason.trim()}>Confirmar perda</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
