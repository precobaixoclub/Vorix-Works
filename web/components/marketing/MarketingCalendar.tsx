"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarDays, ChevronLeft, ChevronRight, Lightbulb, List, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/Button";
import { ChannelIcon } from "@/components/ChannelIcon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { listEditorialIdeas } from "@/features/editorial-ideas/api";
import { editorialDateLabel } from "@/features/editorial-ideas/picker-model";
import {
  buildCalendarItems,
  CALENDAR_STATUS_LABEL,
  CALENDAR_STATUS_ORDER,
  countByStatus,
  filterCalendarItems,
  groupByDay,
  inRange,
  monthCells,
  PLANNING_STATUSES,
  rangeFor,
  sameDay,
  shiftCursor,
  startOfDay,
  type CalendarFilter,
  type CalendarItem,
  type CalendarStatus,
  type CalendarView,
} from "@/features/marketing/calendar-model";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import type { PublicationNetwork } from "@/features/publication-history/types";
import { PostDetail } from "@/features/social/PostDetail";
import { useSocialSettings } from "@/features/social/hooks";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LinkifiedText } from "@/components/LinkifiedText";

const NETWORK_LABEL: Record<PublicationNetwork, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts" };
const NETWORK_FILTERS: { value: PublicationNetwork | "all"; label: string }[] = [{ value: "all", label: "Todas as redes" }, ...(Object.keys(NETWORK_LABEL) as PublicationNetwork[]).map((value) => ({ value, label: NETWORK_LABEL[value] }))];
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Cor discreta por situação (ponto + borda). Planejamento usa borda tracejada: não é publicação. */
const STATUS_DOT: Record<CalendarStatus, string> = {
  planned: "bg-amber-400",
  in_production: "bg-sky-400",
  awaiting_review: "bg-amber-500",
  awaiting_approval: "bg-violet-500",
  scheduled: "bg-sky-500",
  publishing: "bg-amber-500",
  published: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/60",
  draft: "bg-muted-foreground/60",
};

/**
 * Calendário único do Marketing (Reorganização de UX — Fase 5): substitui "Calendário" e
 * "Calendário de publicações". Mostra as publicações reais (todas as redes, uma entrada por
 * publicação) e, numa camada à parte, as ideias do Bolsão com data editorial. Detalhe de cada item
 * com as ações que já existiam (as do compositor social por rede; cancelar/ajustar no estúdio para
 * os registros legados). Nenhum agendamento novo: só leitura dos serviços atuais.
 */
export function MarketingCalendar() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const base = `/workspaces/${workspace.id}`;
  const timezone = useSocialSettings(workspace.id).data?.timezone ?? "America/Sao_Paulo";
  const publications = useUnifiedPublications(workspace.id);
  const ideas = useSWR(["create-hub-ideas", workspace.id], () => listEditorialIdeas(workspace.id), { revalidateOnFocus: true });

  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [filter, setFilter] = useState<CalendarFilter>(() => ({ network: "all", status: isStatus(params.get("status")) ? (params.get("status") as CalendarStatus) : "all", showIdeas: true }));
  const [legacy, setLegacy] = useState<Extract<CalendarItem, { kind: "publication" }> | undefined>();
  const [idea, setIdea] = useState<Extract<CalendarItem, { kind: "idea" }> | undefined>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const postId = params.get("post") ?? undefined;

  // No celular a agenda (lista) é a leitura natural; no desktop, o mês.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("list");
  }, []);

  const items = useMemo(() => buildCalendarItems(publications.data, ideas.data), [publications.data, ideas.data]);
  const range = useMemo(() => rangeFor(cursor, view), [cursor, view]);
  const inPeriod = useMemo(() => inRange(filterCalendarItems(items, { ...filter, status: "all" }), range), [items, filter, range]);
  const visible = useMemo(() => (filter.status === "all" ? inPeriod : inPeriod.filter((item) => item.status === filter.status)), [inPeriod, filter.status]);
  const counts = useMemo(() => countByStatus(inPeriod), [inPeriod]);

  const openPost = (id: string | undefined) => router.replace(id ? `${base}/calendar?post=${encodeURIComponent(id)}` : `${base}/calendar`, { scroll: false });
  function open(item: CalendarItem) {
    if (item.kind === "idea") setIdea(item);
    else if (item.social) openPost(item.postId);
    else setLegacy(item);
  }

  async function cancelLegacy() {
    if (!legacy) return;
    setBusy(true);
    try {
      const post = legacy.posts[0]!;
      await cancelUnifiedPublication(workspace.id, post.network, post.id);
      await publications.mutate();
      setLegacy(undefined);
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
  }

  const loading = (!publications.data && !publications.error) || (!ideas.data && !ideas.error);
  const statusChips = CALENDAR_STATUS_ORDER.filter((status) => status !== "draft" && (counts[status] ?? 0) > 0);

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-8" data-testid="marketing-calendar">
      <PageHeader
        title="Calendário"
        description="Planejamento editorial e publicações reais num só lugar. Ideia planejada não é publicação agendada."
        actions={<Button asChild><Link href={`${base}/create`}><Plus className="h-4 w-4" /> Criar conteúdo</Link></Button>}
      />

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setCursor(new Date())}>Hoje</Button>
          <Button variant="ghost" size="icon" aria-label="Período anterior" onClick={() => setCursor((current) => shiftCursor(current, view, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-foreground sm:min-w-44 sm:flex-none" data-testid="calendar-period">{range.label}</p>
          <Button variant="ghost" size="icon" aria-label="Próximo período" onClick={() => setCursor((current) => shiftCursor(current, view, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Rede" value={filter.network} onChange={(value) => setFilter({ ...filter, network: value as CalendarFilter["network"] })} options={NETWORK_FILTERS} />
          <FilterSelect label="Situação" value={filter.status} onChange={(value) => setFilter({ ...filter, status: value as CalendarFilter["status"] })} options={[{ value: "all", label: "Todas as situações" }, ...CALENDAR_STATUS_ORDER.filter((status) => status !== "draft").map((status) => ({ value: status, label: CALENDAR_STATUS_LABEL[status] }))]} />
          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground">
            <input type="checkbox" checked={filter.showIdeas} onChange={(event) => setFilter({ ...filter, showIdeas: event.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            Ideias planejadas
          </label>
          <div role="radiogroup" aria-label="Visualização" className="inline-flex rounded-lg border border-border p-0.5">
            {([["month", "Mês", CalendarDays], ["week", "Semana", CalendarDays], ["list", "Lista", List]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" role="radio" aria-checked={view === value} onClick={() => setView(value)} className={cn("inline-flex min-h-[36px] items-center gap-1 rounded-md px-2.5 text-xs font-medium", view === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="calendar-status-chips">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="inline-block h-3 w-5 rounded border border-dashed border-amber-500" /> Planejado (ideia)</span>
        <span className="mr-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="inline-block h-3 w-5 rounded border border-border bg-card" /> Publicação</span>
        {statusChips.map((status) => (
          <button key={status} type="button" data-status={status} aria-pressed={filter.status === status} onClick={() => setFilter({ ...filter, status: filter.status === status ? "all" : status })} className={cn("inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors", filter.status === status ? "border-foreground/40 bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
            {CALENDAR_STATUS_LABEL[status]} <span className="tabular-nums">{counts[status]}</span>
          </button>
        ))}
      </div>

      {publications.error ? <div className="mb-4"><ErrorState error={publications.error} onRetry={() => void publications.mutate()} /></div> : null}
      {ideas.error ? <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">As ideias planejadas não carregaram agora. <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline dark:text-primary-glow" onClick={() => void ideas.mutate()}><RotateCw className="h-3 w-3" /> Tentar de novo</button></p> : null}

      {loading ? (
        <Skeleton className="h-[480px] w-full rounded-2xl" />
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title="Seu calendário está livre" description="Planeje ideias com data no Bolsão ou crie e agende um conteúdo para vê-los aqui." action={<Button asChild variant="secondary"><Link href={`${base}/create`}>Criar conteúdo</Link></Button>} />
      ) : visible.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title="Nada neste período" description="Mude o período ou os filtros, ou crie um novo conteúdo." />
      ) : view === "list" ? (
        <Agenda items={visible} onOpen={open} />
      ) : view === "week" ? (
        <WeekGrid start={range.from} items={visible} onOpen={open} />
      ) : (
        <>
          <MonthGrid cursor={cursor} items={visible} onOpen={open} onMore={(day) => { setCursor(day); setView("week"); }} />
          <div className="sm:hidden"><Agenda items={visible} onOpen={open} /></div>
        </>
      )}

      {postId ? <PostDetail workspaceId={workspace.id} postId={postId} timezone={timezone} onClose={() => openPost(undefined)} onChanged={() => void publications.mutate()} /> : null}

      {legacy ? (
        <DetailModal
          open
          onOpenChange={(value) => { if (!value) setLegacy(undefined); }}
          eyebrow="Publicação"
          title={legacy.title}
          description={<div className="flex flex-wrap items-center gap-2">{legacy.networks.map((network) => <ChannelIcon key={network} channel={network} label={NETWORK_LABEL[network]} showLabel />)}<StatusPill status={legacy.status} /></div>}
          srDescription="Detalhes da publicação no calendário."
          widthStorageKey="vorix.calendar.event.width"
          defaultWidthPercent={58}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button asChild><Link href={`${base}/campaigns`}>Ver na biblioteca</Link></Button>
              {legacy.status === "scheduled" ? <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar publicação</Button> : null}
              {legacy.status === "scheduled" || legacy.status === "failed" ? <Button asChild variant="secondary"><Link href={`${base}/publish?network=${legacy.posts[0]!.network}&source=${encodeURIComponent(`${legacy.posts[0]!.network}:${legacy.posts[0]!.id}`)}`}>{legacy.status === "failed" ? "Tentar novamente no estúdio avançado" : "Ajustar no estúdio avançado"}</Link></Button> : null}
            </div>
          }
        >
          <div className="space-y-5">
            {legacy.thumb ? <img src={legacy.thumb} alt="" className="max-h-[360px] w-full rounded-xl bg-muted object-contain" /> : null}
            <DetailBlock label="Data e hora da publicação"><p className="text-sm">{formatDateTime(legacy.date.toISOString())}</p></DetailBlock>
            <DetailBlock label="Legenda"><p className="whitespace-pre-wrap break-words text-sm">{legacy.posts[0]!.text ? <LinkifiedText text={legacy.posts[0]!.text} /> : "Sem legenda"}</p></DetailBlock>
          </div>
        </DetailModal>
      ) : null}

      {idea ? (
        <DetailModal
          open
          onOpenChange={(value) => { if (!value) setIdea(undefined); }}
          eyebrow="Ideia planejada"
          title={idea.title}
          description={<StatusPill status={idea.status} />}
          srDescription="Ideia do Bolsão com data editorial."
          widthStorageKey="vorix.calendar.idea.width"
          defaultWidthPercent={48}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {idea.status === "planned" ? <Button asChild><Link href={`${base}/create?modo=ia&ideia=${encodeURIComponent(idea.idea.id)}`}>Criar com esta ideia</Link></Button> : null}
              {idea.status === "in_production" ? <Button asChild><Link href={`${base}/production`}>Acompanhar produção</Link></Button> : null}
              {idea.status === "awaiting_review" ? <Button asChild><Link href={`${base}/review`}>Revisar</Link></Button> : null}
              <Button asChild variant="secondary"><Link href={`${base}/ideias`}>Abrir no Bolsão</Link></Button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="rounded-xl border border-dashed border-amber-500/60 bg-amber-500/5 px-3 py-2 text-sm text-foreground" data-testid="idea-planning-note">
              Esta é uma <strong>ideia planejada</strong> para {editorialDateLabel(idea.idea) ?? "esta data"} (data editorial). Ainda não existe publicação agendada para ela.
            </p>
            {idea.idea.keyMessage ? <DetailBlock label="Mensagem principal"><p className="text-sm">{idea.idea.keyMessage}</p></DetailBlock> : null}
          </div>
        </DetailModal>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar publicação"
        description={`A publicação "${legacy?.title ?? ""}" não vai mais sair.`}
        confirmLabel="Cancelar publicação"
        cancelLabel="Voltar"
        variant="danger"
        busy={busy}
        onConfirm={() => void cancelLegacy()}
        onCancel={() => setConfirmCancel(false)}
      />
    </main>
  );
}

function isStatus(value: string | null): value is CalendarStatus {
  return Boolean(value) && (CALENDAR_STATUS_ORDER as readonly string[]).includes(value!);
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[] }) {
  return (
    <label className="inline-flex min-w-0 items-center">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-[40px] min-w-0 max-w-[11rem] rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/45">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function StatusPill({ status }: { status: CalendarStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", PLANNING_STATUSES.has(status) ? "border-dashed border-amber-500/70" : "border-border", status === "failed" ? "text-destructive" : "text-foreground")} data-pill={status}>
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {CALENDAR_STATUS_LABEL[status]}
    </span>
  );
}

function timeLabel(item: CalendarItem): string {
  if (item.kind === "idea") return "Planejado";
  return item.date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Item compacto da grade (mês/semana): ponto de status, hora e título — sem poluir o dia. */
function Chip({ item, onOpen }: { item: CalendarItem; onOpen: (item: CalendarItem) => void }) {
  const planning = item.kind === "idea";
  return (
    <button type="button" onClick={() => onOpen(item)} data-item={item.key} data-kind={item.kind} data-status={item.status} title={`${CALENDAR_STATUS_LABEL[item.status]} · ${item.title}`} className={cn("flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-muted", planning ? "border-dashed border-amber-500/60" : "border-border bg-card", item.status === "failed" && "border-destructive/50")}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[item.status])} />
      {planning ? <Lightbulb aria-hidden="true" className="h-3 w-3 shrink-0 text-amber-500" /> : <span className="shrink-0 tabular-nums text-muted-foreground">{timeLabel(item)}</span>}
      <span className="min-w-0 truncate text-foreground">{item.title}</span>
    </button>
  );
}

function MonthGrid({ cursor, items, onOpen, onMore }: { cursor: Date; items: readonly CalendarItem[]; onOpen: (item: CalendarItem) => void; onMore: (day: Date) => void }) {
  const cells = monthCells(cursor);
  const today = new Date();
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card sm:grid sm:grid-cols-7" data-testid="calendar-month">
      {WEEKDAYS.map((day) => <div key={day} className="border-b border-border px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{day}</div>)}
      {cells.map((day) => {
        const dayItems = items.filter((item) => sameDay(item.date, day));
        const muted = day.getMonth() !== cursor.getMonth();
        return (
          <div key={day.toISOString()} className={cn("min-h-[112px] min-w-0 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0", muted && "bg-muted/25")}>
            <p className={cn("mb-1 text-xs tabular-nums", sameDay(day, today) ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-semibold text-primary-foreground dark:bg-primary-glow dark:text-background" : muted ? "text-muted-foreground/60" : "text-muted-foreground")}>{day.getDate()}</p>
            <div className="space-y-1">
              {dayItems.slice(0, 3).map((item) => <Chip key={item.key} item={item} onOpen={onOpen} />)}
              {dayItems.length > 3 ? <button type="button" onClick={() => onMore(day)} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">+{dayItems.length - 3} mais</button> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekGrid({ start, items, onOpen }: { start: Date; items: readonly CalendarItem[]; onOpen: (item: CalendarItem) => void }) {
  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  return (
    <>
      <div className="hidden gap-2 sm:grid sm:grid-cols-7" data-testid="calendar-week">
        {days.map((day, index) => (
          <div key={day.toISOString()} className="min-w-0 rounded-xl border border-border bg-card p-2">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{WEEKDAYS[index]} <span className="tabular-nums">{day.getDate()}</span></p>
            <div className="space-y-1">{items.filter((item) => sameDay(item.date, day)).map((item) => <Chip key={item.key} item={item} onOpen={onOpen} />)}</div>
          </div>
        ))}
      </div>
      <div className="sm:hidden"><Agenda items={items} onOpen={onOpen} /></div>
    </>
  );
}

function Agenda({ items, onOpen }: { items: readonly CalendarItem[]; onOpen: (item: CalendarItem) => void }) {
  const today = startOfDay(new Date());
  return (
    <ol className="space-y-4" data-testid="calendar-list">
      {groupByDay(items).map((group) => (
        <li key={group.day.toISOString()}>
          <p className={cn("mb-2 text-xs font-semibold capitalize", sameDay(group.day, today) ? "text-primary dark:text-primary-glow" : "text-muted-foreground")}>
            {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(group.day)}
          </p>
          <div className="space-y-2">
            {group.items.map((item) => (
              <button key={item.key} type="button" onClick={() => onOpen(item)} data-item={item.key} data-kind={item.kind} data-status={item.status} className={cn("flex min-h-[56px] w-full min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left transition-colors hover:bg-muted/50", item.kind === "idea" ? "border-dashed border-amber-500/60" : "border-border bg-card", item.status === "failed" && "border-destructive/50")}>
                {item.kind === "publication" ? (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {item.thumb ? <img src={item.thumb} alt="" className="h-full w-full object-cover" /> : <CalendarDays className="h-4 w-4 text-muted-foreground" />}
                  </span>
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500"><Lightbulb className="h-4 w-4" /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-medium text-foreground sm:line-clamp-1">{item.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{timeLabel(item)}</span>
                    {item.networks.map((network) => <ChannelIcon key={network} channel={network} label={NETWORK_LABEL[network]} />)}
                    <StatusPill status={item.status} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
