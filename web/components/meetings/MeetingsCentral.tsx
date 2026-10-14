"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
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
import { formatBytes, formatDuration, meetingDurationSeconds, meetingWhen, participantsSummary, STATUS_TONE_CLASS, statusTone } from "@/features/meetings/presentation";
import { MEETING_SOURCE_LABEL, MEETING_STATUS_LABEL, TRANSCRIPT_STATUS_LABEL, type MeetingListFilters, type MeetingSource, type MeetingStatus } from "@/features/meetings/types";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Period = "all" | "7" | "30" | "90";
const PERIOD_LABEL: Record<Period, string> = { all: "Todo o período", "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias" };
const ANY = "all";

/**
 * Central de Reuniões — TODAS as reuniões do workspace, de qualquer origem (manual, link,
 * "gravar agora", upload, Agenda). Consulta `meetings`, nunca só a Agenda. "Gravações" é a mesma
 * Central com o filtro de gravação fixo.
 */
export function MeetingsCentral({ mode }: { mode: "all" | "recordings" }) {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const { state } = useAuth();
  const myUserId = state.status === "authenticated" ? state.user.id : undefined;
  const [dialog, setDialog] = useState<MeetingDialogKind | null>(null);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState<string>(ANY);
  const [source, setSource] = useState<string>(ANY);
  const [owner, setOwner] = useState<string>(ANY);
  const [recording, setRecording] = useState<string>(ANY);
  const [transcript, setTranscript] = useState<string>(ANY);
  const debouncedSearch = useDebounce(search, 350);

  const filters = useMemo<MeetingListFilters>(() => {
    const from = period === "all" ? undefined : new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString();
    return {
      ...(status !== ANY ? { status: status as MeetingStatus } : {}),
      ...(source !== ANY ? { source: source as MeetingSource } : {}),
      ...(from ? { from } : {}),
      ...(mode === "recordings" ? { hasRecording: true } : recording !== ANY ? { hasRecording: recording === "yes" } : {}),
      ...(transcript !== ANY ? { hasTranscript: transcript === "yes" } : {}),
      ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
    };
  }, [status, source, period, mode, recording, transcript, debouncedSearch]);

  const { data, error, isLoading, mutate } = useMeetings(workspace.id, filters);
  const items = useMemo(() => (data?.items ?? []).filter((item) => owner === ANY || item.ownerUserId === owner), [data, owner]);
  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data?.items ?? []) map.set(item.ownerUserId, item.ownerUserId === myUserId ? "Você" : item.ownerName ?? "Outro membro");
    return [...map.entries()];
  }, [data, myUserId]);
  const { paginatedItems, currentPage, totalPages, totalItems, pageSize, setCurrentPage, resetPage, containerRef, availableHeight } = usePagination(items, { auto: true });
  useEffect(() => { resetPage(); }, [filters, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = Boolean(debouncedSearch.trim()) || period !== "all" || status !== ANY || source !== ANY || owner !== ANY || recording !== ANY || transcript !== ANY;

  return (
    <main className="mx-auto max-w-[1280px] space-y-6 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={mode === "recordings" ? "Gravações" : "Reuniões"}
        description={mode === "recordings" ? "Todas as gravações do workspace, com transcrição e resumo quando prontos." : "Todas as reuniões do workspace, de qualquer origem: agendadas, gravadas agora ou enviadas."}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog("upload")}>Enviar gravação</Button>
            {mode === "all" ? <Button variant="secondary" onClick={() => setDialog("new")}>Nova reunião</Button> : null}
            <Button onClick={() => setDialog("record")}>Gravar agora</Button>
          </div>
        }
      />

      <FilterBar summary={data ? `${items.length} de ${data.total} reuniões` : undefined}>
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no título e na transcrição" className="pl-9" aria-label="Buscar reuniões" />
        </div>
        <FilterSelect id="meetings-period" label="Período" value={period} onChange={(value) => setPeriod(value as Period)} options={Object.entries(PERIOD_LABEL)} />
        <FilterSelect id="meetings-status" label="Status" value={status} onChange={setStatus} options={[[ANY, "Todos"], ...Object.entries(MEETING_STATUS_LABEL)]} />
        <FilterSelect id="meetings-source" label="Origem" value={source} onChange={setSource} options={[[ANY, "Todas"], ...Object.entries(MEETING_SOURCE_LABEL)]} />
        <FilterSelect id="meetings-owner" label="Responsável" value={owner} onChange={setOwner} options={[[ANY, "Todos"], ...owners]} />
        {mode === "all" ? <FilterSelect id="meetings-recording" label="Gravação" value={recording} onChange={setRecording} options={[[ANY, "Todas"], ["yes", "Com gravação"], ["no", "Sem gravação"]]} /> : null}
        <FilterSelect id="meetings-transcript" label="Transcrição" value={transcript} onChange={setTranscript} options={[[ANY, "Todas"], ["yes", "Com transcrição"], ["no", "Sem transcrição"]]} />
      </FilterBar>

      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      {isLoading && !data ? (
        <div className="flex justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : null}

      {data ? (
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
                <TableHead>Gravação</TableHead>
                <TableHead>Transcrição</TableHead>
                <TableHead>Resumo IA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    {filtered ? "Nenhuma reunião encontrada com estes filtros." : mode === "recordings" ? "Nenhuma gravação ainda. Grave uma reunião ou envie um arquivo." : "Nenhuma reunião ainda. Grave agora, envie uma gravação ou registre uma reunião."}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => router.push(`/workspaces/${workspace.id}/meetings/central/${item.id}`)} data-testid="meeting-row">
                    <TableCell className="max-w-[280px]">
                      <p className="truncate font-medium text-foreground">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{participantsSummary(item)}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(meetingWhen(item))}</TableCell>
                    <TableCell className="tabular-nums">{formatDuration(meetingDurationSeconds(item))}</TableCell>
                    <TableCell><StatusPill status={item.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{MEETING_SOURCE_LABEL[item.source]}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{item.ownerUserId === myUserId ? "Você" : item.ownerName ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{item.hasRecording ? formatBytes(item.recordingBytes) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{item.transcriptStatus ? TRANSCRIPT_STATUS_LABEL[item.transcriptStatus] : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{item.hasAnalysis ? "Disponível" : "—"}</TableCell>
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

export function StatusPill({ status }: { status: MeetingStatus }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_TONE_CLASS[statusTone(status)])}>{MEETING_STATUS_LABEL[status]}</span>;
}

function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <div className="min-w-[150px]">
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
