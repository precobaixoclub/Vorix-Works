"use client";

import { FormEvent, useMemo, useState } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useProviders } from "@/features/providers/hooks";
import { cancelOccurrence, cancelSchedule, createSchedule, pauseSchedule, recoverScheduling, reprocessDeadLetter, rescheduleOccurrence, resumeSchedule, runScheduling } from "@/features/scheduling/api";
import { useCalendarEntries, useSchedule, useSchedules, useSchedulingDeadLetters, useSchedulingHealth } from "@/features/scheduling/hooks";
import type { CalendarEntry, CreateSchedulePayload } from "@/features/scheduling/types";
import { formatDateTime } from "@/lib/format";

const VIEW_LABELS = { month: "Mês", week: "Semana", day: "Dia" } as const;
const STATUS_OPTIONS = ["pending", "claimed", "dispatched", "cancelled", "missed", "failed", "dead_lettered"] as const;
const STATUS_OPTION_LABEL: Record<(typeof STATUS_OPTIONS)[number], string> = {
  pending: "Pendente",
  claimed: "Reivindicado",
  dispatched: "Despachado",
  cancelled: "Cancelado",
  missed: "Perdido",
  failed: "Falhou",
  dead_lettered: "Não entregue",
};

export default function CalendarPage() {
  const workspace = useCurrentWorkspace();
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<keyof typeof VIEW_LABELS>("month");
  const [providerId, setProviderId] = useState("");
  const [status, setStatus] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [form, setForm] = useState<CreateSchedulePayload>({
    workspaceId: workspace.id,
    publicationPlanId: "",
    publicationCandidateId: "",
    providerId: "dry_run",
    targetId: "",
    scheduledAt: localInputValue(new Date(Date.now() + 60 * 60_000)),
    timezone: "America/Sao_Paulo",
    missedPolicy: "manual_review",
    maxAttempts: 3,
  });
  const [recurring, setRecurring] = useState(false);
  const [rescheduleAt, setRescheduleAt] = useState(localInputValue(new Date(Date.now() + 2 * 60 * 60_000)));

  const range = useMemo(() => rangeFor(cursor, view), [cursor, view]);
  const { data: providers } = useProviders();
  const { data: schedules } = useSchedules(workspace.id, { providerId: providerId || undefined });
  const { data: entries, error: entriesError, mutate: mutateEntries } = useCalendarEntries(workspace.id, range.from, range.to, { providerId: providerId || undefined, status: status || undefined });
  const { data: health } = useSchedulingHealth(workspace.id);
  const { data: deadLetters } = useSchedulingDeadLetters(workspace.id);
  const { data: selected } = useSchedule(workspace.id, selectedScheduleId);

  async function refresh() {
    await Promise.all([
      mutate((key) => Array.isArray(key) && ["calendar", "schedules", "schedule", "scheduling-health", "scheduling-dead-letters"].includes(String(key[0]))),
    ]);
  }

  async function runAction(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
      await refresh();
    } finally {
      setBusy(undefined);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: CreateSchedulePayload = recurring
      ? { ...form, workspaceId: workspace.id, scheduledAt: undefined, recurrence: { frequency: "daily", startAt: form.scheduledAt ?? "", count: 5, interval: 1, windowDays: 30 } }
      : { ...form, workspaceId: workspace.id, recurrence: undefined };
    await runAction("create", async () => {
      const result = await createSchedule(payload);
      setSelectedScheduleId(result.schedule.id);
    });
  }

  const visibleEntries = entries ?? [];

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Calendário Editorial" description="Acompanhe o que está agendado, publicado, cancelado ou com falha." />

      <ScreenGuide
        title="Quando usar"
        description="Use esta tela para conferir datas e resolver pendências. Para criar a linha automática, use Produção."
        items={[
          "Troque entre mês, semana e dia.",
          "Filtre por rede ou status.",
          "Clique em um item do calendário para ver detalhes.",
          "Use processar pendentes somente se a fila estiver parada.",
        ]}
        aside={<p>Campos com ID são de diagnóstico. Normalmente o próprio sistema preenche esses dados quando cria uma publicação.</p>}
      />

      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-ink-muted">Agendamentos ativos</p><p className="text-2xl font-semibold text-ink">{health?.metrics.schedulesActiveTotal ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Ocorrências no período</p><p className="text-2xl font-semibold text-ink">{visibleEntries.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Conflitos</p><p className="text-2xl font-semibold text-ink">{health?.metrics.scheduleConflictsTotal ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Não entregues</p><p className="text-2xl font-semibold text-ink">{deadLetters?.length ?? 0}</p></Card>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:w-auto">
          <Button variant="secondary" aria-label="Período anterior" onClick={() => setCursor(shiftCursor(cursor, view, -1))}>{"<"}</Button>
          <span className="min-w-0 text-center text-sm font-medium text-ink">{range.label}</span>
          <Button variant="secondary" aria-label="Próximo período" onClick={() => setCursor(shiftCursor(cursor, view, 1))}>{">"}</Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          {(Object.keys(VIEW_LABELS) as (keyof typeof VIEW_LABELS)[]).map((mode) => (
            <button key={mode} className={`rounded-md px-3 py-1.5 text-xs font-medium ${view === mode ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:text-ink"}`} onClick={() => setView(mode)} type="button">
              {VIEW_LABELS[mode]}
            </button>
          ))}
          <select className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink sm:flex-none" value={providerId} onChange={(event) => setProviderId(event.target.value)}>
            <option value="">Todos os provedores</option>
            {(providers ?? []).map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.displayName}</option>)}
          </select>
          <select className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink sm:flex-none" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{STATUS_OPTION_LABEL[item]}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {entriesError ? <ErrorState error={entriesError} onRetry={() => mutateEntries()} /> : <CalendarBoard view={view} cursor={cursor} entries={visibleEntries} onSelect={setSelectedScheduleId} />}

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">Fila temporal</p>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={!!busy} onClick={() => runAction("recover", () => recoverScheduling(workspace.id))}>Recuperar</Button>
                <Button disabled={!!busy} onClick={() => runAction("run", () => runScheduling(workspace.id))}>Processar pendentes</Button>
              </div>
            </div>
            {health ? (
              <div className="grid gap-3 md:grid-cols-3">
                {health.checks.map((check) => (
                  <div key={check.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-ink">{check.id}</p>
                      <StatusBadge status={check.status} />
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">{check.safeMessage}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink-muted">Carregando saúde.</p>}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-ink">Novo agendamento</p>
            <form className="space-y-3" onSubmit={submit}>
              <Field label="ID do Plano de Publicação" value={form.publicationPlanId} onChange={(value) => setForm({ ...form, publicationPlanId: value })} />
              <Field label="ID do Candidato" value={form.publicationCandidateId} onChange={(value) => setForm({ ...form, publicationCandidateId: value })} />
              <Field label="ID do Alvo" value={form.targetId} onChange={(value) => setForm({ ...form, targetId: value })} />
              <div>
                <Label>Provedor</Label>
                <select className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={form.providerId} onChange={(event) => setForm({ ...form, providerId: event.target.value })}>
                  {(providers ?? [{ providerId: "dry_run", displayName: "Simulação" }]).map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.displayName}</option>)}
                </select>
              </div>
              <Field label="Horário local" type="datetime-local" value={form.scheduledAt ?? ""} onChange={(value) => setForm({ ...form, scheduledAt: value })} />
              <Field label="Fuso horário (IANA)" value={form.timezone} onChange={(value) => setForm({ ...form, timezone: value })} />
              <Field label="Referência de credencial" value={form.credentialReferenceId ?? ""} onChange={(value) => setForm({ ...form, credentialReferenceId: value || undefined })} />
              <div className="flex items-center justify-between rounded-lg border border-border p-2">
                <span className="text-sm text-ink">Recorrência diária</span>
                <input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} />
              </div>
              <Button disabled={!!busy} type="submit">Criar agendamento</Button>
            </form>
          </Card>

          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-ink">Agendamentos</p>
            <EventList
              items={(schedules ?? []).map((schedule) => ({
                id: schedule.id,
                title: schedule.providerId,
                detail: `${schedule.status} · ${schedule.scheduledAtLocal ?? schedule.scheduledAtUtc ?? schedule.createdAt}`,
                status: schedule.status,
                onClick: () => setSelectedScheduleId(schedule.id),
              }))}
            />
          </Card>

          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-ink">Detalhe</p>
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{selected.schedule.id}</p>
                  <StatusBadge status={selected.schedule.status} />
                </div>
                <p className="text-xs text-ink-muted">{selected.schedule.providerId} · {selected.schedule.timezone}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={!!busy} onClick={() => runAction("pause", () => pauseSchedule(workspace.id, selected.schedule.id))}>Pausar</Button>
                  <Button variant="secondary" disabled={!!busy} onClick={() => runAction("resume", () => resumeSchedule(workspace.id, selected.schedule.id))}>Retomar</Button>
                  <Button variant="secondary" disabled={!!busy} onClick={() => runAction("cancel", () => cancelSchedule(workspace.id, selected.schedule.id))}>Cancelar</Button>
                </div>
                <div className="flex gap-2">
                  <Input type="datetime-local" value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} />
                  <Button variant="secondary" disabled={!!busy || selected.occurrences.length === 0} onClick={() => runAction("reschedule", () => rescheduleOccurrence(workspace.id, selected.schedule.id, { occurrenceId: selected.occurrences[0]?.id, scheduledAt: rescheduleAt, timezone: selected.schedule.timezone }))}>Reagendar</Button>
                </div>
                <EventList items={selected.occurrences.slice(0, 6).map((occurrence) => ({ id: occurrence.id, title: occurrence.localDateTime, detail: `${occurrence.providerId} · ${formatDateTime(occurrence.dueAtUtc)}`, status: occurrence.status, onClick: () => runAction(`cancel-occ:${occurrence.id}`, () => cancelOccurrence(workspace.id, occurrence.id)) }))} />
              </div>
            ) : <p className="text-sm text-ink-muted">Selecione um agendamento.</p>}
          </Card>

          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-ink">Não entregues</p>
            <EventList items={(deadLetters ?? []).map((letter) => ({ id: letter.id, title: letter.failureCode, detail: `${letter.occurrenceId} · ${letter.lastError}`, status: letter.reprocessedAt ? "completed" : "failed", onClick: () => runAction(`dead:${letter.id}`, () => reprocessDeadLetter(workspace.id, letter.id)) }))} />
          </Card>
        </aside>
      </div>
    </main>
  );
}

function CalendarBoard({ view, cursor, entries, onSelect }: { view: "month" | "week" | "day"; cursor: Date; entries: readonly CalendarEntry[]; onSelect: (scheduleId: string) => void }) {
  const cells = buildCells(cursor, view);
  if (entries.length === 0) return <EmptyState title="Sem ocorrências" description="Não há publicações agendadas para o período e filtros selecionados." />;
  return (
    <div className={`grid overflow-hidden rounded-lg border border-border bg-surface-raised ${view === "day" ? "grid-cols-1" : "grid-cols-7"}`}>
      {cells.map((cell) => {
        const dayEntries = entries.filter((entry) => sameUtcDay(entry.occurrence.dueAtUtc, cell));
        return (
          <div key={cell.toISOString()} className="min-h-32 border-b border-r border-border p-2 last:border-r-0">
            <p className="mb-2 text-xs font-medium text-ink-muted">{cell.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</p>
            <div className="space-y-1">
              {dayEntries.slice(0, 5).map((entry) => (
                <button key={entry.occurrence.id} className="w-full rounded-md bg-surface-sunken px-2 py-1 text-left hover:bg-accent-soft" onClick={() => onSelect(entry.schedule.id)} type="button">
                  <span className="block truncate text-xs font-medium text-ink">{entry.schedule.providerId}</span>
                  <span className="block truncate text-[10px] text-ink-muted">{entry.occurrence.localDateTime} · {entry.conflicts.length} conflito(s)</span>
                </button>
              ))}
              {dayEntries.length > 5 ? <p className="text-[10px] text-ink-faint">+{dayEntries.length - 5}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function EventList({ items }: { items: readonly { id: string; title: string; detail: string; status: string; onClick?: () => void }[] }) {
  if (items.length === 0) return <p className="text-sm text-ink-muted">Nenhum item.</p>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button key={item.id} type="button" onClick={item.onClick} className="w-full rounded-lg border border-border p-2 text-left hover:bg-surface-sunken">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-ink">{item.title}</p>
            <StatusBadge status={item.status} />
          </div>
          <p className="mt-1 truncate text-xs text-ink-muted">{item.detail}</p>
        </button>
      ))}
    </div>
  );
}

function rangeFor(cursor: Date, view: "month" | "week" | "day") {
  if (view === "day") {
    const from = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    const to = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1));
    return { from: from.toISOString(), to: to.toISOString(), label: cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) };
  }
  if (view === "week") {
    const from = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - cursor.getDay()));
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 7));
    return { from: from.toISOString(), to: to.toISOString(), label: `${from.toLocaleDateString("pt-BR")} - ${to.toLocaleDateString("pt-BR")}` };
  }
  const from = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), 1));
  const to = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  return { from: from.toISOString(), to: to.toISOString(), label: cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) };
}

function shiftCursor(cursor: Date, view: "month" | "week" | "day", direction: number) {
  if (view === "day") return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + direction);
  if (view === "week") return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7 * direction);
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

function buildCells(cursor: Date, view: "month" | "week" | "day") {
  if (view === "day") return [new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()))];
  const start = view === "week"
    ? new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - cursor.getDay()))
    : new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth(), 1 - new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay()));
  return Array.from({ length: view === "week" ? 7 : 42 }, (_, index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index)));
}

function sameUtcDay(iso: string, date: Date) {
  const item = new Date(iso);
  return item.getUTCFullYear() === date.getUTCFullYear() && item.getUTCMonth() === date.getUTCMonth() && item.getUTCDate() === date.getUTCDate();
}

function localInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
