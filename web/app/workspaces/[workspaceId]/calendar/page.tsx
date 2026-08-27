"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import {
  contentTypeOf,
  derivePublicationStatus,
  PUBLICATION_DISPLAY_STATUS_LABEL,
  type PublicationDisplayStatus,
  type PublicationNetwork,
  type UnifiedPublication,
} from "@/features/publication-history/types";
import { formatDateTime } from "@/lib/format";

type CalendarView = "month" | "week" | "list";
type CalendarEvent = {
  post: UnifiedPublication;
  status: PublicationDisplayStatus;
  date: Date;
  title: string;
};

const VIEWS: readonly { id: CalendarView; label: string }[] = [
  { id: "month", label: "Mês" },
  { id: "week", label: "Semana" },
  { id: "list", label: "Lista" },
];

const NETWORK_LABEL: Record<PublicationNetwork, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube Shorts",
};

const NETWORK_ICON: Record<PublicationNetwork, string> = {
  tiktok: "♪",
  instagram: "◎",
  facebook: "f",
  youtube: "▶",
};

export default function CalendarPage() {
  const workspace = useCurrentWorkspace();
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [selected, setSelected] = useState<CalendarEvent | undefined>();
  const [confirmingCancel, setConfirmingCancel] = useState<CalendarEvent | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const { data: publications, isLoading, error, mutate } = useUnifiedPublications(workspace.id);

  const events = useMemo(() => (publications ?? []).map(toCalendarEvent).filter(isCalendarEvent).sort((a, b) => a.date.getTime() - b.date.getTime()), [publications]);
  const range = useMemo(() => rangeFor(cursor, view), [cursor, view]);
  const visibleEvents = useMemo(() => events.filter((event) => event.date >= range.from && event.date < range.to), [events, range]);
  const stats = useMemo(() => ({
    scheduled: visibleEvents.filter((event) => event.status === "scheduled").length,
    publishing: visibleEvents.filter((event) => event.status === "publishing").length,
    published: visibleEvents.filter((event) => event.status === "published").length,
    failed: visibleEvents.filter((event) => event.status === "failed").length,
    cancelled: visibleEvents.filter((event) => event.status === "cancelled").length,
  }), [visibleEvents]);

  async function cancel(event: CalendarEvent) {
    setBusyId(event.post.id);
    try {
      await cancelUnifiedPublication(workspace.id, event.post.network, event.post.id);
      await mutate();
      setSelected(undefined);
      setConfirmingCancel(undefined);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Calendário"
        description="Visualize e organize seus conteúdos publicados e agendados."
        actions={<Link href={`/workspaces/${workspace.id}/create`}><Button>+ Criar conteúdo</Button></Link>}
      />

      <Card className="mb-5 p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2">
            <Button variant="secondary" onClick={() => setCursor(new Date())}>Hoje</Button>
            <Button variant="secondary" aria-label="Período anterior" onClick={() => setCursor(shiftCursor(cursor, view, -1))}>{"<"}</Button>
            <p className="truncate text-center text-sm font-semibold capitalize text-foreground sm:text-base">{range.label}</p>
            <Button variant="secondary" aria-label="Próximo período" onClick={() => setCursor(shiftCursor(cursor, view, 1))}>{">"}</Button>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            {VIEWS.map((item) => (
              <button key={item.id} type="button" onClick={() => setView(item.id)} className={viewButtonClass(view === item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <StatsGrid className="mb-5">
        <Stat label="Agendado" value={stats.scheduled} tone="accent" />
        <Stat label="Publicando" value={stats.publishing} tone="accent" />
        <Stat label="Publicado" value={stats.published} tone="green" />
        <Stat label="Falhou" value={stats.failed} tone="red" />
        <Stat label="Cancelado" value={stats.cancelled} tone="neutral" />
      </StatsGrid>

      {isLoading ? (
        <CalendarSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : events.length === 0 ? (
        <EmptyState
          title="Seu calendário está livre"
          description="Crie ou agende conteúdos para visualizar sua programação aqui."
          action={<Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>}
        />
      ) : visibleEvents.length === 0 ? (
        <EmptyState
          title="Nada neste período"
          description="Use as setas para navegar por outros períodos ou crie um novo conteúdo."
          action={<Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>}
        />
      ) : view === "list" ? (
        <EventAgenda events={visibleEvents} onSelect={setSelected} />
      ) : view === "week" ? (
        <WeekBoard cursor={cursor} events={visibleEvents} onSelect={setSelected} />
      ) : (
        <MonthBoard cursor={cursor} events={visibleEvents} onSelect={setSelected} />
      )}

      {selected ? (
        <EventDrawer
          workspaceId={workspace.id}
          event={selected}
          busy={busyId === selected.post.id}
          onRequestCancel={() => setConfirmingCancel(selected)}
          onClose={() => setSelected(undefined)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmingCancel !== undefined}
        title="Cancelar publicação"
        description={`Tem certeza que deseja cancelar "${confirmingCancel?.title ?? ""}"? A publicação agendada não vai mais sair.`}
        confirmLabel="Cancelar publicação"
        cancelLabel="Voltar"
        variant="danger"
        busy={confirmingCancel ? busyId === confirmingCancel.post.id : false}
        onConfirm={() => confirmingCancel && cancel(confirmingCancel)}
        onCancel={() => setConfirmingCancel(undefined)}
      />
    </main>
  );
}

function MonthBoard({ cursor, events, onSelect }: { cursor: Date; events: readonly CalendarEvent[]; onSelect: (event: CalendarEvent) => void }) {
  const cells = monthCells(cursor);
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card sm:grid sm:grid-cols-7">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => (
          <div key={day} className="border-b border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</div>
        ))}
        {cells.map((day) => {
          const dayEvents = events.filter((event) => sameDay(event.date, day));
          const isMuted = day.getMonth() !== cursor.getMonth();
          return (
            <div key={day.toISOString()} className={`min-h-32 border-b border-r border-border p-2 last:border-r-0 ${isMuted ? "bg-card/45" : "bg-card"}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${sameDay(day, new Date()) ? "rounded-full bg-primary px-2 py-0.5 text-primary-foreground" : isMuted ? "text-muted-foreground/70" : "text-muted-foreground"}`}>{day.getDate()}</span>
                {dayEvents.length > 3 ? <span className="text-[10px] text-muted-foreground/70">+{dayEvents.length - 3}</span> : null}
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((event) => <CalendarEventButton key={`${event.post.network}-${event.post.id}`} event={event} onClick={() => onSelect(event)} compact />)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:hidden">
        {groupByDate(events).map((group) => (
          <Card key={group.key} className="p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
            <div className="space-y-2">{group.items.map((event) => <CalendarEventButton key={`${event.post.network}-${event.post.id}`} event={event} onClick={() => onSelect(event)} />)}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function WeekBoard({ cursor, events, onSelect }: { cursor: Date; events: readonly CalendarEvent[]; onSelect: (event: CalendarEvent) => void }) {
  const days = weekCells(cursor);
  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {days.map((day) => {
        const dayEvents = events.filter((event) => sameDay(event.date, day));
        return (
          <Card key={day.toISOString()} className="p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day.toLocaleDateString("pt-BR", { weekday: "short" })}</p>
                <p className="text-lg font-semibold text-foreground">{day.getDate()}</p>
              </div>
              {sameDay(day, new Date()) ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary dark:text-primary-glow">Hoje</span> : null}
            </div>
            {dayEvents.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Livre</p> : <div className="space-y-2">{dayEvents.map((event) => <CalendarEventButton key={`${event.post.network}-${event.post.id}`} event={event} onClick={() => onSelect(event)} />)}</div>}
          </Card>
        );
      })}
    </div>
  );
}

function EventAgenda({ events, onSelect }: { events: readonly CalendarEvent[]; onSelect: (event: CalendarEvent) => void }) {
  const groups = groupAgenda(events);
  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-2 text-sm font-semibold text-foreground">{group.label}</h2>
          <div className="grid gap-2">
            {group.items.map((event) => <CalendarEventButton key={`${event.post.network}-${event.post.id}`} event={event} onClick={() => onSelect(event)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function CalendarEventButton({ event, onClick, compact = false }: { event: CalendarEvent; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`w-full min-w-0 rounded-xl border border-border bg-card p-2 text-left transition hover:border-primary hover:bg-primary/5 ${compact ? "" : "sm:p-3"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <PublicationThumb post={event.post} size={compact ? "sm" : "md"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{event.date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
          <p className="truncate text-sm font-medium text-foreground">{event.title}</p>
          <p className="truncate text-xs text-muted-foreground">{NETWORK_LABEL[event.post.network]}</p>
        </div>
        <span className="hidden shrink-0 sm:inline-flex"><StatusBadge status={event.status} /></span>
      </div>
      <span className="mt-2 inline-flex sm:hidden"><StatusBadge status={event.status} /></span>
    </button>
  );
}

function EventDrawer({ workspaceId, event, busy, onClose, onRequestCancel }: { workspaceId: string; event: CalendarEvent; busy: boolean; onClose: () => void; onRequestCancel: () => void }) {
  const statusLabel = PUBLICATION_DISPLAY_STATUS_LABEL[event.status];
  const retryHref = publishHref(workspaceId, event.post);
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Fechar detalhe" onClick={onClose} />
      <aside className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-full sm:max-w-xl sm:rounded-none sm:border-l sm:border-t-0 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary dark:text-primary-glow">Conteúdo</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">{event.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-muted-foreground hover:bg-muted">Fechar</button>
        </div>

        <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex aspect-[4/3] items-center justify-center bg-muted">
            <PublicationPreview post={event.post} />
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <NetworkBadge network={event.post.network} />
          <StatusBadge status={event.status} />
          {event.post.placement === "story" ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Story</span> : null}
        </div>

        <div className="space-y-3">
          <Detail label="Horário" value={`${formatDateTime(event.date.toISOString())}${event.post.timezone ? ` (${event.post.timezone})` : ""}`} />
          <Detail label="Status" value={statusLabel} />
          <Detail label="Legenda" value={event.post.text || "Sem legenda"} />
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href={contentHref(workspaceId)}><Button className="w-full sm:w-auto">Abrir conteúdo</Button></Link>
          {event.status === "scheduled" ? <Button variant="secondary" disabled={busy} onClick={onRequestCancel}>Cancelar</Button> : null}
          {event.status === "scheduled" ? <Link href={retryHref}><Button variant="secondary" className="w-full sm:w-auto">Ajustar no Publicar</Button></Link> : null}
          {event.status === "published" ? <Link href={`/workspaces/${workspaceId}/analytics`}><Button variant="secondary" className="w-full sm:w-auto">Ver resultado</Button></Link> : null}
          {event.status === "failed" ? <Link href={retryHref}><Button variant="secondary" className="w-full sm:w-auto">Tentar novamente</Button></Link> : null}
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "accent" | "green" | "red" | "neutral" }) {
  const toneClass =
    tone === "green" ? "text-success" :
    tone === "red" ? "text-destructive" :
    tone === "accent" ? "text-primary dark:text-primary-glow" :
    "text-muted-foreground";
  return (
    <Card className="p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </Card>
  );
}

function CalendarSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{value}</p>
    </div>
  );
}

function PublicationThumb({ post, size = "md" }: { post: UnifiedPublication; size?: "sm" | "md" }) {
  const image = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const className = size === "sm" ? "h-9 w-9" : "h-12 w-12";
  return (
    <span className={`flex shrink-0 overflow-hidden rounded-lg bg-muted ${className}`}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">{contentTypeOf(post) === "video" ? "▶" : "▧"}</span>
      )}
    </span>
  );
}

function PublicationPreview({ post }: { post: UnifiedPublication }) {
  const image = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt="" className="h-full w-full object-cover" />
    );
  }
  return <span className="text-5xl text-muted-foreground/70">{contentTypeOf(post) === "video" ? "▶" : "▧"}</span>;
}

function NetworkBadge({ network }: { network: PublicationNetwork }) {
  return <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{NETWORK_ICON[network]} {NETWORK_LABEL[network]}</span>;
}

function toCalendarEvent(post: UnifiedPublication): CalendarEvent | undefined {
  const status = derivePublicationStatus(post);
  if (status === "draft") return undefined;
  const rawDate = post.scheduledAt ?? post.publishedAt ?? post.cancelledAt ?? (status === "publishing" || status === "failed" ? post.createdAt : undefined);
  if (!rawDate) return undefined;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return undefined;
  return { post, status, date, title: titleOf(post) };
}

function isCalendarEvent(event: CalendarEvent | undefined): event is CalendarEvent {
  return event !== undefined;
}

function titleOf(post: UnifiedPublication): string {
  const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 72) : `${NETWORK_LABEL[post.network]} · ${contentTypeOf(post)}`;
}

function contentHref(workspaceId: string) {
  return `/workspaces/${workspaceId}/campaigns`;
}

function publishHref(workspaceId: string, post: UnifiedPublication) {
  return `/workspaces/${workspaceId}/publish?network=${post.network}&source=${encodeURIComponent(`${post.network}:${post.id}`)}`;
}

function rangeFor(cursor: Date, view: CalendarView) {
  if (view === "week") {
    const from = startOfWeek(cursor);
    const to = addDays(from, 7);
    return { from, to, label: `${from.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} - ${addDays(to, -1).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}` };
  }
  if (view === "list") {
    const from = startOfDay(cursor);
    const to = addDays(from, 60);
    const isToday = sameDay(from, new Date());
    return { from, to, label: isToday ? "Próximos 60 dias" : `${from.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} - ${addDays(to, -1).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}` };
  }
  const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return { from, to, label: cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) };
}

function shiftCursor(cursor: Date, view: CalendarView, direction: number) {
  if (view === "week") return addDays(cursor, 7 * direction);
  if (view === "list") return addDays(cursor, 30 * direction);
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

function monthCells(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function weekCells(cursor: Date) {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function groupByDate(events: readonly CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.date.toISOString().slice(0, 10);
    map.set(key, [...(map.get(key) ?? []), event]);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: new Date(`${key}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }),
    items,
  }));
}

function groupAgenda(events: readonly CalendarEvent[]) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const groups = [
    { label: "Hoje", items: events.filter((event) => sameDay(event.date, today)) },
    { label: "Amanhã", items: events.filter((event) => sameDay(event.date, tomorrow)) },
    { label: "Esta semana", items: events.filter((event) => event.date > tomorrow && event.date < weekEnd) },
    { label: "Próximos", items: events.filter((event) => event.date >= weekEnd) },
  ];
  return groups.filter((group) => group.items.length > 0);
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, diff));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function viewButtonClass(active: boolean) {
  return `rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;
}
