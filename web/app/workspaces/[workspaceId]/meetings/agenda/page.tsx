"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Video } from "lucide-react";
import { toast } from "sonner";
import { AgendaEventDialog } from "@/components/meetings/AgendaEventDialog";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import {
  cancelAgendaEvent,
  completeAgendaEvent,
  resolveAgendaConflict,
  useAgendaEvents,
  useGoogleCalendarStatus,
  type CalendarEvent,
} from "@/features/meetings/agenda";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "day" | "list";
const VIEW_LABEL: Record<View, string> = { month: "Mês", week: "Semana", day: "Dia", list: "Lista" };
const HOUR_PX = 44;
const DAY_MS = 86_400_000;

// ── Datas (no fuso do navegador, como qualquer agenda) ─────────────────────────────────────────
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
function startOfWeek(date: Date): Date {
  const day = (date.getDay() + 6) % 7; // semana começa na segunda
  return addDays(startOfDay(date), -day);
}
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", options);
const timeFmt = fmt({ hour: "2-digit", minute: "2-digit" });

/** Dias (locais) que um evento ocupa — dia inteiro usa as datas do fuso do evento. */
function eventDays(event: CalendarEvent): string[] {
  if (event.allDay) {
    const toDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: event.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    const days: string[] = [];
    for (let day = new Date(`${toDate(event.startAt)}T12:00:00`); isoDate(day) < toDate(event.endAt); day = addDays(day, 1)) days.push(isoDate(day));
    return days.length ? days : [toDate(event.startAt)];
  }
  return [isoDate(new Date(event.startAt))];
}

function rangeFor(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === "day") return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
  if (view === "week") return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 7) };
  if (view === "list") return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 31) };
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  return { from: gridStart, to: addDays(gridStart, 42) };
}

function shift(view: View, anchor: Date, direction: 1 | -1): Date {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  if (view === "list") return addDays(anchor, 30 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

function title(view: View, anchor: Date): string {
  if (view === "day") return fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(anchor);
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return `${fmt({ day: "numeric", month: "short" }).format(start)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }).format(end)}`;
  }
  if (view === "list") return `A partir de ${fmt({ day: "numeric", month: "long" }).format(anchor)}`;
  return fmt({ month: "long", year: "numeric" }).format(anchor);
}

function eventTone(event: CalendarEvent): string {
  if (event.status === "cancelled") return "border-border bg-muted/40 text-muted-foreground line-through";
  if (event.status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
  if (event.syncState === "conflict") return "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300";
  return "border-primary/30 bg-primary/10 text-foreground dark:border-primary-glow/40";
}

export default function AgendaPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [editing, setEditing] = useState<{ event?: CalendarEvent; date?: string } | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const { data, error, isLoading, mutate } = useAgendaEvents(workspace.id, range.from.toISOString(), range.to.toISOString());
  const google = useGoogleCalendarStatus(workspace.id);
  const googleConnected = google.data?.status === "connected";
  const canWrite = state.status === "authenticated" && state.role !== "viewer";
  const events = data ?? [];
  const today = startOfDay(new Date());

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) for (const day of eventDays(event)) map.set(day, [...(map.get(day) ?? []), event]);
    return map;
  }, [events]);

  return (
    <main className="mx-auto max-w-[1280px] space-y-5 px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Agenda" description="Compromissos e reuniões. Com o Google Calendar conectado, tudo sincroniza nos dois sentidos." actions={canWrite ? <Button onClick={() => setEditing({ date: isoDate(view === "month" ? today : anchor) })}>Nova reunião</Button> : null} />

      {google.data?.status === "reconnect_required" ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="google-reconnect-banner">
          <span>Google Calendar precisa ser reconectado.</span>
          <Link href={`/workspaces/${workspace.id}/meetings/integrations`} className="font-medium underline">Reconectar</Link>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setAnchor(today)}>Hoje</Button>
          <Button variant="ghost" onClick={() => setAnchor(shift(view, anchor, -1))} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" onClick={() => setAnchor(shift(view, anchor, 1))} aria-label="Próximo"><ChevronRight className="h-4 w-4" /></Button>
          <h2 className="ml-1 text-base font-semibold capitalize text-foreground" data-testid="agenda-title">{title(view, anchor)}</h2>
        </div>
        <div className="flex rounded-lg bg-muted/50 p-1" role="tablist" aria-label="Visualização">
          {(Object.keys(VIEW_LABEL) as View[]).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)} className={cn("h-8 rounded-md px-3 text-sm font-medium transition", view === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {VIEW_LABEL[item]}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}

      <Card className={cn("overflow-hidden p-0", isLoading && !data && "opacity-60")} data-testid={`agenda-view-${view}`}>
        {view === "month" ? <MonthView anchor={anchor} byDay={byDay} today={today} onPickDay={(date) => canWrite && setEditing({ date })} onPick={setSelected} /> : null}
        {view === "week" || view === "day" ? <TimeGrid days={view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))} events={events} byDay={byDay} today={today} onPick={setSelected} /> : null}
        {view === "list" ? <ListView from={range.from} byDay={byDay} onPick={setSelected} /> : null}
      </Card>

      {editing ? (
        <AgendaEventDialog
          workspaceId={workspace.id}
          {...(editing.event ? { event: editing.event } : {})}
          {...(editing.date ? { defaultDate: editing.date } : {})}
          googleConnected={googleConnected}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setSelected(null);
            await mutate();
          }}
        />
      ) : null}

      {selected ? (
        <EventDetail
          workspaceId={workspace.id}
          event={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing({ event: selected })}
          onChanged={async () => {
            setSelected(null);
            await mutate();
          }}
        />
      ) : null}
    </main>
  );
}

function EventChip({ event, onPick }: { event: CalendarEvent; onPick: (event: CalendarEvent) => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onPick(event); }} className={cn("w-full truncate rounded border px-1.5 py-0.5 text-left text-xs", eventTone(event))} data-testid="agenda-event">
      {event.allDay ? "" : `${timeFmt.format(new Date(event.startAt))} `}
      {event.title}
    </button>
  );
}

function MonthView({ anchor, byDay, today, onPickDay, onPick }: { anchor: Date; byDay: Map<string, CalendarEvent[]>; today: Date; onPickDay: (date: string) => void; onPick: (event: CalendarEvent) => void }) {
  const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label) => <div key={label} className="py-2">{label}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const list = byDay.get(isoDate(day)) ?? [];
          const outside = day.getMonth() !== anchor.getMonth();
          return (
            <div key={isoDate(day)} onClick={() => onPickDay(isoDate(day))} className={cn("min-h-[104px] cursor-pointer space-y-1 border-b border-r border-border/40 p-1.5", outside && "bg-muted/20")}>
              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums", sameDay(day, today) ? "bg-primary text-primary-foreground dark:bg-primary-glow dark:text-background" : outside ? "text-muted-foreground" : "text-foreground")}>{day.getDate()}</span>
              {list.slice(0, 3).map((event) => <EventChip key={event.id} event={event} onPick={onPick} />)}
              {list.length > 3 ? <p className="px-1 text-[11px] text-muted-foreground">+{list.length - 3} mais</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({ days, events, byDay, today, onPick }: { days: Date[]; events: CalendarEvent[]; byDay: Map<string, CalendarEvent[]>; today: Date; onPick: (event: CalendarEvent) => void }) {
  const columns = `56px repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div>
      <div className="grid border-b border-border/60 bg-muted/30" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => (
          <div key={isoDate(day)} className={cn("py-2 text-center text-xs font-medium", sameDay(day, today) ? "text-primary dark:text-primary-glow" : "text-muted-foreground")}>
            {fmt({ weekday: "short", day: "numeric" }).format(day)}
          </div>
        ))}
      </div>
      <div className="grid border-b border-border/60" style={{ gridTemplateColumns: columns }}>
        <div className="py-1 pr-2 text-right text-[11px] text-muted-foreground">dia todo</div>
        {days.map((day) => (
          <div key={isoDate(day)} className="space-y-0.5 border-l border-border/40 p-1">
            {(byDay.get(isoDate(day)) ?? []).filter((event) => event.allDay).map((event) => <EventChip key={event.id} event={event} onPick={onPick} />)}
          </div>
        ))}
      </div>
      <div className="max-h-[620px] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: columns }}>
          <div>{Array.from({ length: 24 }, (_, hour) => <div key={hour} style={{ height: HOUR_PX }} className="pr-2 text-right text-[11px] tabular-nums text-muted-foreground">{String(hour).padStart(2, "0")}:00</div>)}</div>
          {days.map((day) => {
            const dayStart = startOfDay(day).getTime();
            const timed = events.filter((event) => !event.allDay && new Date(event.startAt).getTime() < dayStart + DAY_MS && new Date(event.endAt).getTime() > dayStart);
            return (
              <div key={isoDate(day)} className="relative border-l border-border/40" style={{ height: HOUR_PX * 24 }}>
                {Array.from({ length: 24 }, (_, hour) => <div key={hour} style={{ height: HOUR_PX }} className="border-b border-border/30" />)}
                {timed.map((event) => {
                  const start = Math.max(new Date(event.startAt).getTime(), dayStart);
                  const end = Math.min(new Date(event.endAt).getTime(), dayStart + DAY_MS);
                  const top = ((start - dayStart) / 3_600_000) * HOUR_PX;
                  const height = Math.max(20, ((end - start) / 3_600_000) * HOUR_PX - 2);
                  return (
                    <button key={event.id} type="button" onClick={() => onPick(event)} data-testid="agenda-event" className={cn("absolute left-1 right-1 overflow-hidden rounded border px-1.5 py-0.5 text-left text-xs", eventTone(event))} style={{ top, height }}>
                      <span className="block truncate font-medium">{event.title}</span>
                      <span className="block truncate tabular-nums opacity-80">{timeFmt.format(new Date(event.startAt))} – {timeFmt.format(new Date(event.endAt))}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListView({ from, byDay, onPick }: { from: Date; byDay: Map<string, CalendarEvent[]>; onPick: (event: CalendarEvent) => void }) {
  const days = Array.from({ length: 31 }, (_, i) => addDays(from, i)).filter((day) => (byDay.get(isoDate(day)) ?? []).length > 0);
  if (days.length === 0) return <p className="p-8 text-center text-sm text-muted-foreground">Nenhum compromisso nos próximos 30 dias.</p>;
  return (
    <ul className="divide-y divide-border/60">
      {days.map((day) => (
        <li key={isoDate(day)} className="grid gap-2 p-4 sm:grid-cols-[180px_1fr]">
          <p className="text-sm font-medium capitalize text-foreground">{fmt({ weekday: "long", day: "numeric", month: "short" }).format(day)}</p>
          <div className="space-y-1">
            {(byDay.get(isoDate(day)) ?? []).map((event) => (
              <button key={event.id} type="button" onClick={() => onPick(event)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50" data-testid="agenda-event">
                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{event.allDay ? "Dia todo" : `${timeFmt.format(new Date(event.startAt))}–${timeFmt.format(new Date(event.endAt))}`}</span>
                <span className={cn("min-w-0 truncate", event.status === "cancelled" && "line-through text-muted-foreground")}>{event.title}</span>
                {event.meetingId ? <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Com reunião" /> : null}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

const SYNC_LABEL: Record<string, string> = { ok: "Sincronizado com o Google", pending: "Aguardando envio ao Google", failed: "Falha ao sincronizar", conflict: "Conflito com o Google" };

function EventDetail({ workspaceId, event, canWrite, onClose, onEdit, onChanged }: { workspaceId: string; event: CalendarEvent; canWrite: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onChanged();
    } catch (error) {
      toast.error("Não foi possível concluir", { description: error instanceof ApiError || error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const open = event.status === "confirmed";
  const when = event.allDay
    ? `Dia todo · ${fmt({ day: "numeric", month: "long", timeZone: event.timezone }).format(new Date(event.startAt))}`
    : `${fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(event.startAt))}, ${timeFmt.format(new Date(event.startAt))}–${timeFmt.format(new Date(event.endAt))}`;
  return (
    <Modal title={event.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="capitalize text-muted-foreground">{when} <span className="normal-case">({event.timezone})</span></p>
        {event.status !== "confirmed" ? <p className="font-medium">{event.status === "done" ? "Concluído" : "Cancelado"}</p> : null}
        {event.location ? <p><span className="text-muted-foreground">Local: </span>{event.location}</p> : null}
        {event.meetLink ? <a href={event.meetLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline dark:text-primary-glow"><Video className="h-4 w-4" /> {event.meetLink.replace("https://", "")}</a> : event.wantsMeetLink && event.syncState === "pending" ? <p className="text-muted-foreground">O link do Meet será gerado na sincronização com o Google.</p> : null}
        {event.attendees.length ? <p><span className="text-muted-foreground">Participantes: </span>{event.attendees.join(", ")}</p> : null}
        {event.description ? <p className="whitespace-pre-line">{event.description}</p> : null}
        {event.googleRecurringEventId ? <p className="text-xs text-muted-foreground">Ocorrência de um evento recorrente do Google.</p> : null}
        {event.syncState ? <p className={cn("text-xs", event.syncState === "conflict" || event.syncState === "failed" ? "text-destructive" : "text-muted-foreground")} data-testid="agenda-sync-state">{SYNC_LABEL[event.syncState]}{event.lastSyncError ? ` — ${event.lastSyncError}` : ""}</p> : null}
        {event.syncState === "conflict" && canWrite ? (
          <div className="rounded-lg border border-rose-200 p-3 dark:border-rose-500/40">
            <p className="mb-2">O evento mudou no Google e no Vorix. {event.conflictRemote?.summary ? <>No Google: <b>{event.conflictRemote.summary}</b>.</> : null}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => run(() => resolveAgendaConflict(workspaceId, event.id, "local"), "Mantida a versão do Vorix")}>Manter a do Vorix</Button>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => resolveAgendaConflict(workspaceId, event.id, "remote"), "Aceita a versão do Google")}>Aceitar a do Google</Button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {event.meetingId ? <Link href={`/workspaces/${workspaceId}/meetings/central/${event.meetingId}`} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/50">Abrir reunião</Link> : null}
          {event.htmlLink ? <a href={event.htmlLink} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/50">Google <ExternalLink className="h-3.5 w-3.5" /></a> : null}
          {canWrite && open ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={onEdit}>Editar</Button>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => cancelAgendaEvent(workspaceId, event.id), "Evento cancelado")}>Cancelar evento</Button>
              <Button disabled={busy} onClick={() => run(() => completeAgendaEvent(workspaceId, event.id), "Evento concluído")}>Concluir</Button>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
