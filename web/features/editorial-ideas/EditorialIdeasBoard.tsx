"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { PageHeader } from "@/components/PageHeader";
import { SortableHead } from "@/components/SortableHead";
import { StatsGrid } from "@/components/StatsGrid";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getExecutionRun } from "@/features/execution/api";
import { generateFromIdea } from "@/features/production-line/api";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import {
  buildEditorialCalendar,
  EDITORIAL_FORMAT_LABEL,
  EDITORIAL_STATUS_LABEL,
  EDITORIAL_STATUS_ORDER,
  getEditorialBrief,
  importEditorialPack,
  listEditorialIdeas,
  updateEditorialIdea,
  type EditorialIdea,
  type EditorialIdeaFormat,
  type EditorialIdeaStatus,
} from "./api";

type View = "list" | "calendar";
type SortKey = "id" | "title" | "category" | "status" | "date";

const STATUS_TONE: Record<EditorialIdeaStatus, string> = {
  available: "bg-muted text-muted-foreground",
  in_production: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  produced: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  published: "bg-primary/15 text-primary",
  archived: "bg-muted text-muted-foreground line-through",
};

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const formatDay = (date?: string) => (date ? WEEKDAY.format(new Date(`${date}T00:00:00Z`)) : "—");

function StatusPill({ status }: { status: EditorialIdeaStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{EDITORIAL_STATUS_LABEL[status]}</span>;
}

/** Estado editorial derivado da execução real do motor criativo (nunca adivinhado). */
function statusFromRun(state: string): EditorialIdeaStatus | "failed" | undefined {
  if (state === "waiting_for_approval") return "produced";
  if (state === "completed") return "approved";
  if (state === "failed" || state === "cancelled") return "failed";
  return undefined;
}

/**
 * Bolsão de pautas editoriais do workspace: acervo importado, estado editorial compartilhado,
 * calendário de 30 dias e envio de uma pauta por vez ao motor criativo existente. Nada é gerado
 * nem publicado sozinho — a peça gerada segue para a Revisão de sempre.
 */
export function EditorialIdeasBoard({ workspaceId }: { workspaceId: string }) {
  const [ideas, setIdeas] = useState<EditorialIdea[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<EditorialIdeaStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [formatFilter, setFormatFilter] = useState<EditorialIdeaFormat | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setIdeas(await listEditorialIdeas(workspaceId));
    } catch (cause) {
      setError(cause);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  // Pautas em produção acompanham a execução real: aguardando aprovação = produzida, concluída =
  // aprovada; falha volta a pauta para disponível.
  const syncedRuns = useRef(new Set<string>());
  useEffect(() => {
    if (!ideas) return;
    const pending = ideas.filter((idea) => idea.status === "in_production" && idea.executionRunId && !syncedRuns.current.has(idea.executionRunId)).slice(0, 15);
    if (pending.length === 0) return;
    void (async () => {
      const updates: EditorialIdea[] = [];
      for (const idea of pending) {
        syncedRuns.current.add(idea.executionRunId!);
        try {
          const detail = await getExecutionRun(workspaceId, idea.executionRunId!);
          const next = statusFromRun(detail.run.state);
          if (next === "failed") updates.push(await updateEditorialIdea(workspaceId, idea.id, { status: "available", executionRunId: null }));
          else if (next) updates.push(await updateEditorialIdea(workspaceId, idea.id, { status: next }));
        } catch { /* execução indisponível: a pauta continua como está */ }
      }
      if (updates.length) setIdeas((current) => current?.map((idea) => updates.find((update) => update.id === idea.id) ?? idea) ?? current);
    })();
  }, [ideas, workspaceId]);

  const categories = useMemo(() => [...new Set((ideas ?? []).map((idea) => idea.category))].sort(), [ideas]);
  const stats = useMemo(() => {
    const count = Object.fromEntries(EDITORIAL_STATUS_ORDER.map((status) => [status, 0])) as Record<EditorialIdeaStatus, number>;
    for (const idea of ideas ?? []) count[idea.status] += 1;
    return count;
  }, [ideas]);

  const visible = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return (ideas ?? []).filter((idea) =>
      (statusFilter === "all" || idea.status === statusFilter)
      && (categoryFilter === "all" || idea.category === categoryFilter)
      && (formatFilter === "all" || idea.format === formatFilter)
      && (!query || `${idea.externalId} ${idea.title} ${idea.concept} ${idea.approach}`.toLowerCase().includes(query)));
  }, [ideas, debouncedSearch, statusFilter, categoryFilter, formatFilter]);

  const { sorted, sort, onSort } = useSortedRows<EditorialIdea, SortKey>(
    visible,
    {
      id: (idea) => idea.externalId,
      title: (idea) => idea.title.toLowerCase(),
      category: (idea) => idea.category,
      status: (idea) => EDITORIAL_STATUS_ORDER.indexOf(idea.status),
      date: (idea) => idea.scheduledDate ?? idea.suggestedDate ?? "9999",
    },
    { key: "date", dir: "asc" },
  );
  const { currentPage, totalPages, paginatedItems, setCurrentPage, resetPage, totalItems, pageSize, containerRef, availableHeight } = usePagination(sorted, { auto: true });
  useEffect(() => { resetPage(); }, [debouncedSearch, statusFilter, categoryFilter, formatFilter, sort, resetPage]);

  const selected = ideas?.find((idea) => idea.id === selectedId) ?? null;
  const replace = (updated: EditorialIdea) => setIdeas((current) => current?.map((idea) => (idea.id === updated.id ? updated : idea)) ?? current);

  async function onImportFile(file: File) {
    setBusy("import");
    try {
      const pack = JSON.parse(await file.text()) as unknown;
      const result = await importEditorialPack(workspaceId, pack);
      toast.success(`${result.created} pauta(s) importada(s)${result.skipped ? `; ${result.skipped} já existiam e foram mantidas` : ""}.`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof SyntaxError ? "O arquivo não é um JSON válido." : cause instanceof Error ? cause.message : "Não foi possível importar o pacote.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onBuildCalendar() {
    setBusy("calendar");
    try {
      const result = await buildEditorialCalendar(workspaceId);
      setIdeas(result.ideas);
      setView("calendar");
      toast.success(result.scheduled ? `${result.scheduled} pauta(s) distribuídas nos próximos 30 dias, de segunda a sexta.` : "O calendário dos próximos 30 dias já está completo.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível montar o calendário.");
    } finally {
      setBusy(null);
    }
  }

  async function onStatusChange(idea: EditorialIdea, status: EditorialIdeaStatus) {
    setBusy(`status:${idea.id}`);
    try {
      replace(await updateEditorialIdea(workspaceId, idea.id, { status }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível mudar o estado.");
    } finally {
      setBusy(null);
    }
  }

  async function onScheduleChange(idea: EditorialIdea, scheduledDate: string | null) {
    setBusy(`date:${idea.id}`);
    try {
      replace(await updateEditorialIdea(workspaceId, idea.id, { scheduledDate }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível mudar a data.");
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate(idea: EditorialIdea) {
    setBusy(`generate:${idea.id}`);
    try {
      const brief = await getEditorialBrief(workspaceId, idea.id);
      const run = await generateFromIdea({ workspaceId, ...brief, channel: "instagram", aspectRatio: "4:5" });
      syncedRuns.current.delete(run.executionRunId);
      replace(await updateEditorialIdea(workspaceId, idea.id, { status: "in_production", executionRunId: run.executionRunId }));
      toast.success("Pauta enviada ao motor criativo. Acompanhe na Fila; a peça passa pela Revisão antes de qualquer publicação.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar a pauta ao motor criativo.");
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <PageHeader
      title="Pautas editoriais"
      description="O bolsão criativo do workspace: escolha uma pauta, envie ao motor criativo e acompanhe até a publicação."
      actions={
        <>
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportFile(file); }} />
          <Button variant="secondary" disabled={busy === "import"} onClick={() => fileInput.current?.click()}>{busy === "import" ? "Importando…" : "Importar pacote"}</Button>
          <Button disabled={busy === "calendar" || !ideas?.length} onClick={() => void onBuildCalendar()}>{busy === "calendar" ? "Montando…" : "Montar calendário de 30 dias"}</Button>
        </>
      }
    />
  );

  if (error && !ideas) return <>{header}<ErrorState error={error} onRetry={() => void load()} /></>;
  if (!ideas) return <>{header}<div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div></>;
  if (ideas.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="Nenhuma pauta neste workspace ainda"
          description="Importe um pacote de pautas (arquivo JSON no formato vorix.editorial-pack/v1). Reimportar o mesmo pacote nunca duplica pautas."
          action={<Button onClick={() => fileInput.current?.click()}>Importar pacote</Button>}
        />
      </>
    );
  }

  const scheduled = ideas.filter((idea) => idea.scheduledDate && idea.status !== "archived").sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));

  return (
    <>
      {header}
      <StatsGrid className="mb-4">
        {EDITORIAL_STATUS_ORDER.filter((status) => status !== "archived").map((status) => (
          <Card key={status}><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{EDITORIAL_STATUS_LABEL[status]}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{stats[status]}</p>
          </CardContent></Card>
        ))}
      </StatsGrid>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="min-w-56 flex-1">
              <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, código ou abordagem" />
            </div>
            <Select value={statusFilter} onValueChange={(value: EditorialIdeaStatus | "all") => setStatusFilter(value)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os estados</SelectItem>
                {EDITORIAL_STATUS_ORDER.map((status) => <SelectItem key={status} value={status}>{EDITORIAL_STATUS_LABEL[status]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={formatFilter} onValueChange={(value: EditorialIdeaFormat | "all") => setFormatFilter(value)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Formato" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os formatos</SelectItem>
                {(Object.keys(EDITORIAL_FORMAT_LABEL) as EditorialIdeaFormat[]).map((format) => <SelectItem key={format} value={format}>{EDITORIAL_FORMAT_LABEL[format]}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              {(["list", "calendar"] as const).map((option) => (
                <button key={option} type="button" onClick={() => setView(option)} className={`min-h-8 rounded-md px-3 text-sm font-medium ${view === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {option === "list" ? "Lista" : "Calendário"}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {view === "calendar" ? (
        scheduled.length === 0 ? (
          <EmptyState title="Nenhuma pauta no calendário" description="Monte o calendário de 30 dias: uma pauta por dia útil, alternando categorias e formatos." action={<Button onClick={() => void onBuildCalendar()}>Montar calendário de 30 dias</Button>} />
        ) : (
          <Card><CardContent className="divide-y divide-border p-0">
            {scheduled.map((idea) => (
              <button key={idea.id} type="button" onClick={() => setSelectedId(idea.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/50">
                <span className="w-24 shrink-0 text-sm font-medium tabular-nums text-foreground">{formatDay(idea.scheduledDate)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{idea.title}</span>
                <span className="text-xs text-muted-foreground">{idea.category} · {EDITORIAL_FORMAT_LABEL[idea.format]}</span>
                <StatusPill status={idea.status} />
              </button>
            ))}
          </CardContent></Card>
        )
      ) : (
        <ListCard ref={containerRef} availableHeight={availableHeight} footer={<TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} />}>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead columnKey="id" sort={sort} onSort={onSort}>Código</SortableHead>
                <SortableHead columnKey="title" sort={sort} onSort={onSort}>Pauta</SortableHead>
                <SortableHead columnKey="category" sort={sort} onSort={onSort}>Categoria</SortableHead>
                <TableHead>Formato</TableHead>
                <SortableHead columnKey="status" sort={sort} onSort={onSort}>Estado</SortableHead>
                <SortableHead columnKey="date" sort={sort} onSort={onSort} align="right">Data</SortableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma pauta com esses filtros. Limpe a busca ou troque o estado.</TableCell></TableRow>
              ) : paginatedItems.map((idea) => (
                <TableRow key={idea.id} className="cursor-pointer" onClick={() => setSelectedId(idea.id)}>
                  <TableCell className="tabular-nums text-muted-foreground">{idea.externalId}</TableCell>
                  <TableCell className="max-w-md">
                    <p className="truncate font-medium text-foreground">{idea.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{idea.approach}{idea.priority === "high" ? " · Prioridade alta" : ""}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{idea.category}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{EDITORIAL_FORMAT_LABEL[idea.format]}</TableCell>
                  <TableCell><StatusPill status={idea.status} /></TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{idea.scheduledDate ? formatDay(idea.scheduledDate) : idea.suggestedDate ? `sugerida ${formatDay(idea.suggestedDate)}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}

      {selected ? (
        <EditorialIdeaDetail
          idea={selected}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onStatusChange={(status) => void onStatusChange(selected, status)}
          onScheduleChange={(date) => void onScheduleChange(selected, date)}
          onGenerate={() => void onGenerate(selected)}
        />
      ) : null}
    </>
  );
}

function EditorialIdeaDetail({ idea, busy, onClose, onStatusChange, onScheduleChange, onGenerate }: {
  idea: EditorialIdea;
  busy: string | null;
  onClose: () => void;
  onStatusChange: (status: EditorialIdeaStatus) => void;
  onScheduleChange: (date: string | null) => void;
  onGenerate: () => void;
}) {
  const [date, setDate] = useState(idea.scheduledDate ?? "");
  useEffect(() => { setDate(idea.scheduledDate ?? ""); }, [idea.scheduledDate]);
  const isVideo = idea.format === "video";
  const generating = busy === `generate:${idea.id}`;
  const generateBlocked = isVideo ? "O motor de ideias gera imagem única e carrossel; pautas de vídeo seguem o roteiro para produção manual." : idea.status === "in_production" ? "Esta pauta já está em produção." : idea.status === "archived" ? "Reative a pauta antes de produzir." : null;
  const generateButton = <Button disabled={Boolean(generateBlocked) || generating} onClick={onGenerate}>{generating ? "Enviando…" : "Enviar ao motor criativo"}</Button>;

  return (
    <DetailModal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      eyebrow={`${idea.externalId} · ${idea.category}`}
      title={idea.title}
      description={
        <div className="flex flex-wrap gap-2">
          <StatusPill status={idea.status} />
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{EDITORIAL_FORMAT_LABEL[idea.format]}</span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{idea.approach}</span>
          {idea.priority === "high" ? <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-300">Prioridade alta</span> : null}
        </div>
      }
      srDescription="Proposta criativa completa da pauta editorial."
      widthStorageKey="vorix.editorial-ideas.detail.width"
      defaultWidthPercent={62}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {generateBlocked ? (
            <Tooltip><TooltipTrigger asChild><span tabIndex={0}>{generateButton}</span></TooltipTrigger><TooltipContent>{generateBlocked}</TooltipContent></Tooltip>
          ) : generateButton}
          <Select value={idea.status} onValueChange={(value: EditorialIdeaStatus) => onStatusChange(value)}>
            <SelectTrigger className="w-40" disabled={busy === `status:${idea.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>{EDITORIAL_STATUS_ORDER.map((status) => <SelectItem key={status} value={status}>{EDITORIAL_STATUS_LABEL[status]}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(idea.caption).then(() => toast.success("Legenda copiada.")); }}>Copiar legenda</Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <DetailBlock label="Objetivo comercial"><p className="text-sm text-foreground">{idea.commercialObjective}</p></DetailBlock>
          <DetailBlock label="Público-alvo"><p className="text-sm text-foreground">{idea.targetAudience}</p></DetailBlock>
        </div>
        <DetailBlock label="Conceito criativo"><p className="text-sm text-foreground">{idea.concept}</p></DetailBlock>
        <DetailBlock label="Mensagem principal"><p className="text-sm font-medium text-foreground">{idea.keyMessage}</p></DetailBlock>
        <div className="grid gap-4 md:grid-cols-2">
          <DetailBlock label="Direção visual"><p className="text-sm text-foreground">{idea.visualDirection}</p></DetailBlock>
          <DetailBlock label="Estrutura narrativa"><p className="text-sm text-foreground">{idea.narrativeStructure}</p></DetailBlock>
        </div>
        {idea.carouselScript ? (
          <DetailBlock label="Roteiro do carrossel">
            <ol className="space-y-2">{idea.carouselScript.map((slide, index) => (
              <li key={index} className="text-sm"><span className="font-medium tabular-nums text-foreground">{index + 1}. {slide.headline}</span><span className="block text-muted-foreground">{slide.body}</span></li>
            ))}</ol>
          </DetailBlock>
        ) : null}
        {idea.videoScript ? (
          <DetailBlock label="Roteiro do vídeo">
            <ol className="space-y-2">{idea.videoScript.map((scene, index) => (
              <li key={index} className="text-sm"><span className="font-medium tabular-nums text-foreground">{scene.time} · {scene.visual}</span><span className="block text-muted-foreground">{scene.text}</span></li>
            ))}</ol>
          </DetailBlock>
        ) : null}
        <DetailBlock label="Legenda completa"><p className="whitespace-pre-wrap break-words text-sm text-foreground">{idea.caption}</p></DetailBlock>
        <div className="grid gap-4 md:grid-cols-2">
          <DetailBlock label="Chamada para ação"><p className="text-sm text-foreground">{idea.cta}</p></DetailBlock>
          <DetailBlock label="Calendário">
            <p className="mb-2 text-xs text-muted-foreground">Data sugerida: {formatDay(idea.suggestedDate)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-44" />
              <Button variant="secondary" disabled={!date || date === idea.scheduledDate || busy === `date:${idea.id}`} onClick={() => onScheduleChange(date)}>Agendar</Button>
              {idea.scheduledDate ? <Button variant="ghost" disabled={busy === `date:${idea.id}`} onClick={() => onScheduleChange(null)}>Tirar do calendário</Button> : null}
            </div>
          </DetailBlock>
        </div>
      </div>
    </DetailModal>
  );
}
