"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Search, Sparkles, Video } from "lucide-react";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { FilterBar } from "@/components/FilterBar";
import { ListCard } from "@/components/ListCard";
import { MeetingDialogs, type MeetingDialogKind } from "@/components/meetings/MeetingDialogs";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAuth } from "@/contexts/auth-context";
import { useMeetings } from "@/features/meetings/hooks";
import { LIBRARY_VIEWS, libraryView, meetingAvailability } from "@/features/meetings/organization";
import { formatDuration, meetingDurationSeconds, meetingWhen, participantsSummary, STATUS_TONE_CLASS, statusTone } from "@/features/meetings/presentation";
import { MEETING_SOURCE_LABEL, MEETING_STATUS_LABEL, type MeetingListFilters, type MeetingListItem, type MeetingSource, type MeetingStatus } from "@/features/meetings/types";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Period = "all" | "7" | "30" | "90";
const PERIOD_LABEL: Record<Period, string> = { all: "Todo o período", "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias" };
const ANY = "all";

/** Telas estreitas: cartões em vez da tabela de nove colunas. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/**
 * Gravações (Fase 9) — a biblioteca ÚNICA de reuniões do workspace, de qualquer origem. As antigas
 * "Reuniões" e "Gravações" eram a mesma lista com um filtro fixo; agora são visões (`?visao=`) da
 * mesma tela: Todas, Gravadas, Com transcrição, Com análise da IA, Agendadas e Com falha. Busca,
 * filtros e paginação continuam os de antes.
 */
export function MeetingsCentral() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { state } = useAuth();
  const myUserId = state.status === "authenticated" ? state.user.id : undefined;
  const canRecord = state.status === "authenticated" && state.role !== "viewer";
  const view = libraryView(params.get("visao"));
  const narrow = useNarrow();
  const [dialog, setDialog] = useState<MeetingDialogKind | null>(null);
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState<string>(ANY);
  const [source, setSource] = useState<string>(ANY);
  const [owner, setOwner] = useState<string>(ANY);
  const [recording, setRecording] = useState<string>(ANY);
  const [transcript, setTranscript] = useState<string>(ANY);
  const debouncedSearch = useDebounce(search, 350);
  // Filtros que a visão já fixa não aparecem (nada de "Gravadas" + "Sem gravação" ao mesmo tempo).
  const fixed = view.filters;

  const filters = useMemo<MeetingListFilters>(() => {
    const from = period === "all" ? undefined : new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString();
    return {
      ...(status !== ANY ? { status: status as MeetingStatus } : {}),
      ...(source !== ANY ? { source: source as MeetingSource } : {}),
      ...(from ? { from } : {}),
      ...(recording !== ANY ? { hasRecording: recording === "yes" } : {}),
      ...(transcript !== ANY ? { hasTranscript: transcript === "yes" } : {}),
      ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
      ...fixed,
    };
  }, [status, source, period, recording, transcript, debouncedSearch, fixed]);

  const { data, error, isLoading, mutate } = useMeetings(workspace.id, filters);
  const items = useMemo(() => (data?.items ?? []).filter((item) => (owner === ANY || item.ownerUserId === owner) && (!view.only || view.only(item))), [data, owner, view]);
  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data?.items ?? []) map.set(item.ownerUserId, item.ownerUserId === myUserId ? "Você" : item.ownerName ?? "Outro membro");
    return [...map.entries()];
  }, [data, myUserId]);
  const { paginatedItems, currentPage, totalPages, totalItems, pageSize, setCurrentPage, resetPage, containerRef, availableHeight } = usePagination(items, narrow ? 8 : { auto: true });
  useEffect(() => { resetPage(); }, [filters, owner, view.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = Boolean(debouncedSearch.trim()) || period !== "all" || status !== ANY || source !== ANY || owner !== ANY || recording !== ANY || transcript !== ANY;
  const openMeeting = (item: MeetingListItem) => router.push(`/workspaces/${workspace.id}/meetings/central/${item.id}`);
  // Trocar de visão substitui o endereço: o Voltar sai da biblioteca, não percorre as visões.
  const selectView = (key: string) => {
    const next = new URLSearchParams(params.toString());
    if (key === "todas") next.delete("visao");
    else next.set("visao", key);
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };

  return (
    <main className="mx-auto max-w-[1280px] space-y-5 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Gravações"
        description="Todas as reuniões do workspace — gravadas, enviadas ou só agendadas — com a situação da gravação, da transcrição e da análise."
        actions={canRecord ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog("upload")}>Enviar gravação</Button>
            <Button onClick={() => setDialog("record")}>Gravar reunião do Meet</Button>
          </div>
        ) : undefined}
      />

      <nav aria-label="Visões da biblioteca" className="flex gap-1 overflow-x-auto rounded-xl border border-border/60 bg-card p-1 [scrollbar-width:none]" data-testid="library-views">
        {LIBRARY_VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={item.key === view.key ? "true" : undefined}
            data-view={item.key}
            onClick={() => selectView(item.key)}
            className={cn("min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3 text-sm transition-colors", item.key === view.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <FilterBar summary={data ? `${items.length} de ${data.total} reuniões` : undefined}>
        <div className="relative min-w-0 flex-1 basis-full sm:min-w-[220px] sm:basis-auto sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no título e na transcrição" className="pl-9" aria-label="Buscar reuniões" />
        </div>
        <FilterSelect id="meetings-period" label="Período" value={period} onChange={(value) => setPeriod(value as Period)} options={Object.entries(PERIOD_LABEL)} />
        {fixed.status ? null : <FilterSelect id="meetings-status" label="Status" value={status} onChange={setStatus} options={[[ANY, "Todos"], ...Object.entries(MEETING_STATUS_LABEL)]} />}
        <FilterSelect id="meetings-source" label="Origem" value={source} onChange={setSource} options={[[ANY, "Todas"], ...Object.entries(MEETING_SOURCE_LABEL)]} />
        <FilterSelect id="meetings-owner" label="Responsável" value={owner} onChange={setOwner} options={[[ANY, "Todos"], ...owners]} />
        {fixed.hasRecording !== undefined ? null : <FilterSelect id="meetings-recording" label="Gravação" value={recording} onChange={setRecording} options={[[ANY, "Todas"], ["yes", "Com gravação"], ["no", "Sem gravação"]]} />}
        {fixed.hasTranscript !== undefined ? null : <FilterSelect id="meetings-transcript" label="Transcrição" value={transcript} onChange={setTranscript} options={[[ANY, "Todas"], ["yes", "Com transcrição"], ["no", "Sem transcrição"]]} />}
      </FilterBar>

      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      {isLoading && !data ? (
        <div className="flex justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : null}

      {data && narrow ? (
        <div className="space-y-2" data-testid="meeting-cards">
          {paginatedItems.length === 0 ? <p className="rounded-xl border border-border/60 p-6 text-center text-sm text-muted-foreground">{filtered ? "Nenhuma reunião encontrada com estes filtros." : view.empty}</p> : null}
          {paginatedItems.map((item) => (
            <Link key={item.id} href={`/workspaces/${workspace.id}/meetings/central/${item.id}`} className="block rounded-xl border border-border/60 bg-card p-3 hover:bg-muted/40" data-testid="meeting-row">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-medium text-foreground">{item.title}</p>
                <StatusPill status={item.status} />
              </div>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{formatDateTime(meetingWhen(item))} · {MEETING_SOURCE_LABEL[item.source]}{meetingDurationSeconds(item) ? ` · ${formatDuration(meetingDurationSeconds(item))}` : ""}</p>
              <AvailabilityBadges item={item} />
            </Link>
          ))}
          {totalPages > 1 ? <TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} /> : null}
        </div>
      ) : null}

      {data && !narrow ? (
        <ListCard
          ref={containerRef}
          availableHeight={availableHeight}
          footer={<TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reunião</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Disponível</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{filtered ? "Nenhuma reunião encontrada com estes filtros." : view.empty}</TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => openMeeting(item)} data-testid="meeting-row">
                    <TableCell className="max-w-[280px]">
                      <Link href={`/workspaces/${workspace.id}/meetings/central/${item.id}`} onClick={(event) => event.stopPropagation()} className="block truncate font-medium text-foreground hover:underline">{item.title}</Link>
                      <p className="truncate text-xs text-muted-foreground">{participantsSummary(item)}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(meetingWhen(item))}</TableCell>
                    <TableCell className="tabular-nums">
                      {item.status === "recording" && (item.recordingStartedAt ?? item.botJoinedAt)
                        ? `~${formatDuration((Date.now() - Date.parse((item.recordingStartedAt ?? item.botJoinedAt)!)) / 1000)}`
                        : formatDuration(meetingDurationSeconds(item))}
                    </TableCell>
                    <TableCell><StatusPill status={item.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{MEETING_SOURCE_LABEL[item.source]}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{item.ownerUserId === myUserId ? "Você" : item.ownerName ?? "—"}</TableCell>
                    <TableCell><AvailabilityBadges item={item} compact /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ListCard>
      ) : null}

      <MeetingDialogs workspaceId={workspace.id} open={dialog} onClose={() => setDialog(null)} />
    </main>
  );
}

/** Gravação / transcrição / análise: o que o registro REALMENTE tem (agendada ≠ gravada). */
export function AvailabilityBadges({ item, compact = false }: { item: Pick<MeetingListItem, "status" | "hasRecording" | "transcriptStatus" | "hasAnalysis">; compact?: boolean }) {
  const availability = meetingAvailability(item);
  const badge = (on: boolean, label: string, Icon: typeof Video, key: string) => (
    <span key={key} data-availability={key} data-on={on ? "true" : "false"} title={label} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", on ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
      <Icon aria-hidden="true" className="h-3 w-3" />
      {compact ? <span className="sr-only">{label}</span> : label}
      {compact ? <span aria-hidden="true">{key === "recording" ? "Gravação" : key === "transcript" ? "Transcrição" : "Análise"}</span> : null}
    </span>
  );
  if (availability.scheduledOnly) {
    return <p className={cn("text-[11px] text-muted-foreground", !compact && "mt-2")} data-availability="scheduled">Agendada — ainda não gravada</p>;
  }
  return (
    <div className={cn("flex flex-wrap gap-1", !compact && "mt-2")}>
      {badge(availability.recording === "available", availability.recordingLabel, Video, "recording")}
      {badge(item.transcriptStatus === "completed", availability.transcriptLabel, FileText, "transcript")}
      {badge(item.hasAnalysis, availability.analysisLabel, Sparkles, "analysis")}
    </div>
  );
}

export function StatusPill({ status }: { status: MeetingStatus }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_TONE_CLASS[statusTone(status)])}>{MEETING_STATUS_LABEL[status]}</span>;
}

function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <div className="min-w-[140px] flex-1 sm:flex-none">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
