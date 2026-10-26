"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, History, LayoutList, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { GuardedButton } from "@/components/GuardedButton";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMyAccess } from "@/features/auth/access";
import { approveSocialPost, cancelSocialDestination, cancelSocialPost, decideLateSocialDestination, publishSocialPostNow, rescheduleSocialPost, resolveUnknownSocialDestination, retrySocialDestination } from "@/features/social/api";
import { NetworkMark, StatePill } from "@/features/social/components";
import { useSocialPost, useSocialPosts, useSocialSettings } from "@/features/social/hooks";
import {
  ACTION_PERMISSION,
  allowedActions,
  dayKey,
  DESTINATION_STATE_META,
  destinationActionLabel,
  destinationStatusLine,
  formatDateTime,
  formatTime,
  groupPostsByDay,
  localInputsIn,
  monthGrid,
  NETWORK_LABEL,
  POST_STATE_META,
  postAnchor,
  postTitle,
  zonedToUtc,
} from "@/features/social/presentation";
import type { SocialDestinationAction, SocialDestinationView, SocialPostView } from "@/features/social/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Calendário das publicações sociais: estado do post e de cada rede, ações por destino. */
export default function SocialCalendarPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-xl" />}>
      <SocialCalendar />
    </Suspense>
  );
}

function SocialCalendar() {
  const workspace = useCurrentWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const timezone = useSocialSettings(workspace.id).data?.timezone ?? "America/Sao_Paulo";
  const today = localInputsIn(timezone, new Date()).date;
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [view, setView] = useState<"month" | "list">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "month"));
  const range = useMemo(() => {
    const from = zonedToUtc(`${cursor.year}-${String(cursor.month).padStart(2, "0")}-01T00:00`, timezone);
    const next = cursor.month === 12 ? { year: cursor.year + 1, month: 1 } : { year: cursor.year, month: cursor.month + 1 };
    const to = zonedToUtc(`${next.year}-${String(next.month).padStart(2, "0")}-01T00:00`, timezone);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [cursor, timezone]);
  const posts = useSocialPosts(workspace.id, range);
  const byDay = useMemo(() => groupPostsByDay(posts.data?.posts ?? [], timezone), [posts.data, timezone]);
  const selectedId = params.get("post") ?? undefined;
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.year, cursor.month - 1, 1)));

  const open = (postId: string | undefined) => router.replace(postId ? `/workspaces/${workspace.id}/social/calendar?post=${encodeURIComponent(postId)}` : `/workspaces/${workspace.id}/social/calendar`);
  const shift = (delta: number) => setCursor(({ year, month }) => {
    const index = year * 12 + (month - 1) + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  });

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Calendário de publicações"
        description="Acompanhe o que está agendado e o resultado em cada rede."
        actions={<Button asChild><Link href={`/workspaces/${workspace.id}/social/compose`}><Plus className="h-4 w-4" /> Criar publicação</Link></Button>}
      />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => shift(-1)}><ChevronLeft /></Button>
          <p className="min-w-40 text-center text-sm font-semibold capitalize tabular-nums">{monthLabel}</p>
          <Button variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => shift(1)}><ChevronRight /></Button>
          <Button variant="secondary" size="sm" onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}>Hoje</Button>
        </div>
        <ToggleGroup type="single" value={view} onValueChange={(value) => value && setView(value as "month" | "list")}>
          <ToggleGroupItem value="month" aria-label="Visão de mês"><CalendarDays className="h-4 w-4" /> Mês</ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Visão de lista"><LayoutList className="h-4 w-4" /> Lista</ToggleGroupItem>
        </ToggleGroup>
      </Card>

      {posts.error ? <ErrorState error={posts.error} onRetry={() => void posts.mutate()} /> : null}
      {!posts.data && !posts.error ? <Skeleton className="h-[480px] w-full rounded-xl" /> : null}
      {posts.data && posts.data.posts.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title="Nenhuma publicação neste mês" description="Crie uma publicação para Instagram, Facebook ou TikTok e acompanhe tudo por aqui." action={<Button asChild><Link href={`/workspaces/${workspace.id}/social/compose`}>Crie sua primeira publicação</Link></Button>} />
      ) : null}

      {posts.data && posts.data.posts.length > 0 && view === "month" ? (
        <Card className="overflow-hidden p-0" data-testid="social-calendar-month">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-xs font-medium text-muted-foreground">{WEEKDAYS.map((day) => <div key={day} className="py-2">{day}</div>)}</div>
          {monthGrid(cursor.year, cursor.month).map((week, index) => (
            <div key={index} className="grid grid-cols-7 border-b border-border last:border-b-0">
              {week.map((day, position) => (
                <div key={day ?? `empty-${position}`} className={cn("min-h-28 border-r border-border p-1.5 last:border-r-0", !day && "bg-muted/20")}>
                  {day ? <p className={cn("mb-1 text-xs tabular-nums", day === today ? "font-semibold text-primary" : "text-muted-foreground")}>{Number(day.slice(8))}</p> : null}
                  <div className="space-y-1">
                    {(day ? byDay.get(day) ?? [] : []).slice(0, 3).map((post) => <PostChip key={post.id} post={post} timezone={timezone} onOpen={() => open(post.id)} />)}
                    {day && (byDay.get(day)?.length ?? 0) > 3 ? <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setView("list")}>+{(byDay.get(day)?.length ?? 0) - 3} mais</button> : null}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Card>
      ) : null}

      {posts.data && posts.data.posts.length > 0 && view === "list" ? (
        <div className="space-y-4" data-testid="social-calendar-list">
          {[...byDay.entries()].map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</h2>
              <div className="space-y-2">{items.map((post) => <PostRow key={post.id} post={post} timezone={timezone} onOpen={() => open(post.id)} />)}</div>
            </section>
          ))}
        </div>
      ) : null}

      {selectedId ? <PostDetail workspaceId={workspace.id} postId={selectedId} timezone={timezone} onClose={() => open(undefined)} onChanged={() => void posts.mutate()} /> : null}
    </div>
  );
}

function PostChip({ post, timezone, onOpen }: { post: SocialPostView; timezone: string; onOpen: () => void }) {
  const meta = POST_STATE_META[post.state];
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1 text-left text-[11px] hover:bg-muted" aria-label={`${postTitle(post)} — ${meta.label}`}>
      <span className="tabular-nums text-muted-foreground">{formatTime(postAnchor(post), timezone)}</span>
      <span className="flex -space-x-1">{[...new Set(post.destinations.map((destination) => destination.network))].map((network) => <NetworkMark key={network} network={network} size="sm" className="h-4 w-4 rounded [&_svg]:h-2.5 [&_svg]:w-2.5" />)}</span>
      <span className={cn("ml-auto h-1.5 w-1.5 shrink-0 rounded-full", meta.tone === "emerald" ? "bg-emerald-500" : meta.tone === "rose" ? "bg-rose-500" : meta.tone === "amber" ? "bg-amber-500" : meta.tone === "sky" ? "bg-sky-500" : meta.tone === "violet" ? "bg-violet-500" : "bg-muted-foreground")} />
    </button>
  );
}

function PostRow({ post, timezone, onOpen }: { post: SocialPostView; timezone: string; onOpen: () => void }) {
  const meta = POST_STATE_META[post.state];
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left hover:bg-muted/40 sm:flex-row sm:items-center">
      <span className="w-14 shrink-0 text-sm font-semibold tabular-nums">{formatTime(postAnchor(post), timezone)}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{postTitle(post)}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        {post.destinations.map((destination) => <StatePill key={destination.id} tone={DESTINATION_STATE_META[destination.state].tone} label={NETWORK_LABEL[destination.network]} />)}
      </span>
      <StatePill label={meta.label} tone={meta.tone} />
    </button>
  );
}

function PostDetail({ workspaceId, postId, timezone, onClose, onChanged }: { workspaceId: string; postId: string; timezone: string; onClose: () => void; onChanged: () => void }) {
  const { data: post, error, mutate } = useSocialPost(workspaceId, postId);
  const { can } = useMyAccess();
  const [section, setSection] = useState("overview");
  const [busy, setBusy] = useState<string | undefined>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [resolving, setResolving] = useState<SocialDestinationView | undefined>();

  useEffect(() => setSection("overview"), [postId]);

  async function run(key: string, action: () => Promise<SocialPostView>, success: string) {
    setBusy(key);
    try {
      const updated = await action();
      await mutate(updated, { revalidate: false });
      onChanged();
      toast.success(success);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Algo deu errado. Tente novamente.");
    } finally {
      setBusy(undefined);
    }
  }

  function destinationAction(destination: SocialDestinationView, action: SocialDestinationAction) {
    const label = NETWORK_LABEL[destination.network];
    if (action === "retry") return run(`${destination.id}:retry`, () => retrySocialDestination(workspaceId, destination.id), `Nova tentativa no ${label} na fila.`);
    if (action === "cancel") return run(`${destination.id}:cancel`, () => cancelSocialDestination(workspaceId, destination.id), `Publicação no ${label} cancelada.`);
    if (action === "confirm_late") return run(`${destination.id}:late`, () => decideLateSocialDestination(workspaceId, destination.id, "publish"), `Vai sair no ${label} em instantes.`);
    if (action === "skip_late") return run(`${destination.id}:skip`, () => decideLateSocialDestination(workspaceId, destination.id, "skip"), `Não será publicada no ${label}.`);
    if (action === "resolve_unknown") { setResolving(destination); return; }
    return undefined;
  }

  if (error) return <Modal title="Publicação" onClose={onClose}><ErrorState error={error} onRetry={() => void mutate()} /></Modal>;
  if (!post) return <Modal title="Publicação" onClose={onClose}><Skeleton className="h-40 w-full" /></Modal>;

  const meta = POST_STATE_META[post.state];
  const first = post.destinations[0];
  const futureScheduled = post.state === "SCHEDULED" && !!post.scheduledAt && post.scheduledAt > new Date().toISOString();
  const cancellable = post.destinations.some((destination) => destination.actions.includes("cancel"));

  return (
    <>
      <DetailModal
        open
        onOpenChange={(value) => { if (!value) onClose(); }}
        eyebrow="Publicação"
        title={postTitle(post)}
        description={<div className="flex flex-wrap gap-2"><StatePill label={meta.label} tone={meta.tone} />{post.destinations.map((destination) => <NetworkMark key={destination.id} network={destination.network} size="sm" />)}</div>}
        srDescription="Detalhes e status da publicação em cada rede."
        widthStorageKey="vorix.social.post.width"
        defaultWidthPercent={60}
        sections={[{ value: "overview", label: "Visão geral" }, { value: "history", label: "Histórico", icon: History }]}
        value={section}
        onValueChange={setSection}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {post.requiresApproval ? <GuardedButton allowed={can("publication:approve")} blockedReason="Só quem aprova publicações pode aprovar." loading={busy === "approve"} onClick={() => void run("approve", () => approveSocialPost(workspaceId, post.id), "Publicação aprovada.")}>Aprovar</GuardedButton> : null}
            {futureScheduled ? <GuardedButton allowed={can(ACTION_PERMISSION.publish_now)} blockedReason="Você não tem permissão para publicar." loading={busy === "now"} onClick={() => void run("now", () => publishSocialPostNow(workspaceId, post.id), "Publicação enviada.")}>Publicar agora</GuardedButton> : null}
            {futureScheduled ? <GuardedButton variant="secondary" allowed={can(ACTION_PERMISSION.reschedule)} blockedReason="Você não tem permissão para reagendar." onClick={() => setRescheduling(true)}>Reagendar</GuardedButton> : null}
            {cancellable ? <GuardedButton variant="ghost" allowed={can(ACTION_PERMISSION.cancel_post)} blockedReason="Você não tem permissão para cancelar." onClick={() => setConfirmCancel(true)}>Cancelar publicação</GuardedButton> : null}
          </div>
        }
      >
        {section === "overview" ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-xl border border-border bg-muted">
                {first?.media[0] ? (first.media[0].kind === "video"
                  ? <video src={first.media[0].url} className="aspect-square w-full object-cover" controls muted playsInline preload="metadata" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={first.media[0].url} alt="" className="aspect-square w-full object-cover" />) : <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">Sem mídia</div>}
              </div>
              <div className="space-y-4">
                <DetailBlock label="Horário"><p className="text-sm tabular-nums">{formatDateTime(post.scheduledAt ?? post.createdAt, post.timezone ?? timezone)}{post.timezone ? <span className="text-muted-foreground"> · {post.timezone.replace(/_/g, " ")}</span> : null}</p></DetailBlock>
                <DetailBlock label="Legenda"><p className="whitespace-pre-wrap break-words text-sm">{first?.caption || "Sem legenda"}</p>{first?.hashtags.length ? <p className="mt-1 text-sm text-sky-600 dark:text-sky-400">{first.hashtags.map((tag) => `#${tag}`).join(" ")}</p> : null}</DetailBlock>
              </div>
            </div>
            <DetailBlock label="Redes">
              <ul className="space-y-3" data-testid="social-destinations">
                {post.destinations.map((destination) => {
                  const stateMeta = DESTINATION_STATE_META[destination.state];
                  const actions = allowedActions(destination.actions, can);
                  return (
                    <li key={destination.id} className="rounded-lg border border-border p-3" data-testid={`social-destination-status-${destination.network}`}>
                      <div className="flex flex-wrap items-center gap-3">
                        <NetworkMark network={destination.network} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{destinationStatusLine(destination.network, destination.state)}</p>
                          <p className="text-xs text-muted-foreground">{destination.formatLabel}{destination.username ? ` · @${destination.username}` : ""}{destination.publishedAt ? ` · ${formatDateTime(destination.publishedAt, timezone)}` : ""}</p>
                        </div>
                        <StatePill label={stateMeta.label} tone={stateMeta.tone} />
                      </div>
                      {destination.problem ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{destination.problem}</p> : null}
                      {destination.state === "RECONCILIATION_REQUIRED" ? <p className="mt-2 text-sm text-muted-foreground">O envio aconteceu, mas a rede não confirmou a tempo. O Vorix não repete para não duplicar — confira na rede e confirme aqui.</p> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {destination.externalUrl ? <Button size="sm" variant="secondary" asChild><a href={destination.externalUrl} target="_blank" rel="noreferrer">Ver no {NETWORK_LABEL[destination.network]}</a></Button> : null}
                        {actions.map((action) => action === "reconnect"
                          ? <Button key={action} size="sm" asChild><Link href={`/workspaces/${workspaceId}/social/integrations`}>{destinationActionLabel(action, destination.network)}</Link></Button>
                          : <Button key={action} size="sm" variant={action === "retry" || action === "confirm_late" || action === "resolve_unknown" ? "primary" : "ghost"} loading={busy?.startsWith(`${destination.id}:`)} onClick={() => void destinationAction(destination, action)}>{destinationActionLabel(action, destination.network)}</Button>)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </DetailBlock>
          </div>
        ) : (
          <ol className="space-y-3" data-testid="social-history">
            {post.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                <div>
                  <p className="text-sm">{entry.label}{entry.network ? ` · ${NETWORK_LABEL[entry.network]}` : ""}{entry.scheduledFor ? ` para ${formatDateTime(entry.scheduledFor, timezone)}` : ""}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{formatDateTime(entry.at, timezone)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DetailModal>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar esta publicação?"
        description="As redes que ainda não publicaram não vão publicar. O que já saiu continua publicado."
        confirmLabel="Cancelar publicação"
        cancelLabel="Voltar"
        variant="danger"
        busy={busy === "cancel"}
        onConfirm={async () => { await run("cancel", () => cancelSocialPost(workspaceId, post.id), "Publicação cancelada."); setConfirmCancel(false); }}
        onCancel={() => setConfirmCancel(false)}
      />

      {rescheduling ? <RescheduleModal post={post} timezone={post.timezone ?? timezone} busy={busy === "reschedule"} onClose={() => setRescheduling(false)} onSave={async (date, time) => { await run("reschedule", () => rescheduleSocialPost(workspaceId, post.id, `${date}T${time}`, post.timezone ?? timezone), "Publicação reagendada."); setRescheduling(false); }} /> : null}

      {resolving ? <ResolveUnknownModal destination={resolving} busy={busy === "resolve"} onClose={() => setResolving(undefined)} onResolve={async (outcome, url) => { await run("resolve", () => resolveUnknownSocialDestination(workspaceId, resolving.id, outcome, url), outcome === "published" ? "Publicação confirmada." : "Marcada como não publicada. Você pode tentar novamente."); setResolving(undefined); }} /> : null}
    </>
  );
}

function RescheduleModal({ post, timezone, busy, onClose, onSave }: { post: SocialPostView; timezone: string; busy: boolean; onClose: () => void; onSave: (date: string, time: string) => Promise<void> }) {
  const initial = localInputsIn(timezone, new Date(post.scheduledAt ?? Date.now()));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const inPast = zonedToUtc(`${date}T${time}`, timezone).getTime() < Date.now();
  return (
    <Modal title="Reagendar publicação" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-sm"><span className="block font-medium">Data</span><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Nova data" /></label>
          <label className="space-y-1 text-sm"><span className="block font-medium">Hora</span><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} aria-label="Nova hora" /></label>
        </div>
        <p className="text-xs text-muted-foreground">Fuso: {timezone.replace(/_/g, " ")}. Todas as redes desta publicação mudam juntas.</p>
        {inPast ? <p className="text-sm text-rose-600">Escolha um horário no futuro.</p> : null}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={inPast || dayKey(new Date().toISOString(), timezone) > date} onClick={() => void onSave(date, time)}>Salvar novo horário</Button></div>
      </div>
    </Modal>
  );
}

function ResolveUnknownModal({ destination, busy, onClose, onResolve }: { destination: SocialDestinationView; busy: boolean; onClose: () => void; onResolve: (outcome: "published" | "not_published", url?: string) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const label = NETWORK_LABEL[destination.network];
  return (
    <Modal title={`A publicação saiu no ${label}?`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Abra a conta no {label} e confira se a publicação apareceu. Se saiu, o Vorix registra como publicada sem enviar de novo. Se não saiu, você poderá tentar novamente.</p>
        <label className="block space-y-1 text-sm"><span className="font-medium">Link da publicação (opcional)</span><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={`https://www.${destination.network}.com/...`} /></label>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" loading={busy} onClick={() => void onResolve("not_published")}>Não saiu</Button>
          <Button loading={busy} onClick={() => void onResolve("published", /^https:\/\//.test(url) ? url : undefined)}>Sim, saiu</Button>
        </div>
      </div>
    </Modal>
  );
}
