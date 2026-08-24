"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import {
  contentTypeOf,
  derivePublicationStatus,
  PUBLICATION_DISPLAY_STATUS_LABEL,
  type PublicationContentType,
  type PublicationDisplayStatus,
  type PublicationNetwork,
  type UnifiedPublication,
} from "@/features/publication-history/types";
import { formatDateTime } from "@/lib/format";

function IconChevron({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NETWORK_LABEL: Record<PublicationNetwork, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };
const NETWORK_ICON: Record<PublicationNetwork, string> = { tiktok: "♪", instagram: "◎", facebook: "f", youtube: "▶" };
const FORMAT_LABEL: Record<PublicationContentType, string> = { image: "Imagem", video: "Vídeo", carousel: "Carrossel", text: "Texto" };
const FORMAT_ICON: Record<PublicationContentType, string> = { image: "▧", video: "▶", carousel: "▦", text: "¶" };
const FORMAT_GRADIENT: Record<PublicationContentType, string> = {
  image: "from-sky-500/70 via-indigo-500/55 to-emerald-500/65",
  video: "from-rose-500/70 via-orange-500/55 to-amber-500/65",
  carousel: "from-emerald-500/70 via-teal-500/55 to-cyan-500/65",
  text: "from-slate-600/70 via-zinc-500/55 to-slate-700/65",
};

const NETWORK_FILTERS: Array<{ value: PublicationNetwork | "all"; label: string }> = [
  { value: "all", label: "Todas as redes" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube Shorts" },
];

const STATUS_FILTERS: Array<{ value: PublicationDisplayStatus | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "published", label: "Publicados" },
  { value: "scheduled", label: "Agendados" },
  { value: "publishing", label: "Publicando" },
  { value: "failed", label: "Com erro" },
  { value: "cancelled", label: "Cancelados" },
];

const FORMAT_FILTERS: Array<{ value: PublicationContentType | "all"; label: string }> = [
  { value: "all", label: "Todos formatos" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "carousel", label: "Carrossel" },
  { value: "text", label: "Texto" },
];

type DateFilter = "all" | "upcoming" | "past" | "this_month";
type ViewMode = "grid" | "list";

const DATE_FILTERS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "Qualquer data" },
  { value: "upcoming", label: "Próximas" },
  { value: "this_month", label: "Este mês" },
  { value: "past", label: "Já publicadas" },
];

function matchesDate(iso: string | undefined, filter: DateFilter): boolean {
  if (filter === "all" || !iso) return true;
  const date = new Date(iso);
  const now = new Date();
  if (Number.isNaN(date.getTime())) return true;
  if (filter === "upcoming") return date.getTime() >= now.getTime();
  if (filter === "past") return date.getTime() < now.getTime();
  if (filter === "this_month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return true;
}

export default function ContentsPage() {
  const workspace = useCurrentWorkspace();
  const [search, setSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<PublicationNetwork | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PublicationDisplayStatus | "all">("all");
  const [formatFilter, setFormatFilter] = useState<PublicationContentType | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [selectedPost, setSelectedPost] = useState<UnifiedPublication | undefined>();
  const { data: publications, isLoading, error, mutate } = useUnifiedPublications(workspace.id);

  const stats = useMemo(() => {
    const statuses = (publications ?? []).map((publication) => derivePublicationStatus(publication));
    return {
      total: statuses.length,
      published: statuses.filter((status) => status === "published").length,
      scheduled: statuses.filter((status) => status === "scheduled").length,
      failed: statuses.filter((status) => status === "failed").length,
      cancelled: statuses.filter((status) => status === "cancelled").length,
    };
  }, [publications]);

  const activeFilterCount = [
    networkFilter !== "all",
    statusFilter !== "all",
    formatFilter !== "all",
    dateFilter !== "all",
    search.trim() !== "",
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (publications ?? [])
      .filter((publication) => (networkFilter === "all" ? true : publication.network === networkFilter))
      .filter((publication) => (statusFilter === "all" ? true : derivePublicationStatus(publication) === statusFilter))
      .filter((publication) => (formatFilter === "all" ? true : contentTypeOf(publication) === formatFilter))
      .filter((publication) => matchesDate(publication.scheduledAt ?? publication.publishedAt ?? publication.createdAt, dateFilter))
      .filter((publication) => (query ? titleOf(publication).toLowerCase().includes(query) || publication.text.toLowerCase().includes(query) : true));
  }, [publications, networkFilter, statusFilter, formatFilter, dateFilter, search]);

  async function cancel(post: UnifiedPublication) {
    setBusyId(post.id);
    try {
      await cancelUnifiedPublication(workspace.id, post.network, post.id);
      await mutate();
      setSelectedPost(undefined);
    } finally {
      setBusyId(undefined);
    }
  }

  const filters = (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_150px_150px_150px]">
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conteúdo" aria-label="Buscar conteúdo" className="w-full" />
      <FilterSelect label="Rede" value={networkFilter} onChange={(value) => setNetworkFilter(value as PublicationNetwork | "all")} options={NETWORK_FILTERS} />
      <FilterSelect label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as PublicationDisplayStatus | "all")} options={STATUS_FILTERS} />
      <FilterSelect label="Periodo" value={dateFilter} onChange={(value) => setDateFilter(value as DateFilter)} options={DATE_FILTERS} />
      <FilterSelect label="Formato" value={formatFilter} onChange={(value) => setFormatFilter(value as PublicationContentType | "all")} options={FORMAT_FILTERS} />
    </div>
  );

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Biblioteca</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Conteúdos</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">Veja, filtre e reutilize tudo que já foi criado ou publicado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface-raised p-1">
            <button type="button" onClick={() => setViewMode("grid")} className={viewModeButtonClass(viewMode === "grid")}>Grid</button>
            <button type="button" onClick={() => setViewMode("list")} className={viewModeButtonClass(viewMode === "list")}>Lista</button>
          </div>
          <Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>
        </div>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <StatPill label="Total" value={stats.total} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <StatPill label="Publicados" value={stats.published} active={statusFilter === "published"} onClick={() => setStatusFilter("published")} />
        <StatPill label="Agendados" value={stats.scheduled} active={statusFilter === "scheduled"} onClick={() => setStatusFilter("scheduled")} />
        <StatPill label="Com erro" value={stats.failed} active={statusFilter === "failed"} onClick={() => setStatusFilter("failed")} />
        <StatPill label="Cancelados" value={stats.cancelled} active={statusFilter === "cancelled"} onClick={() => setStatusFilter("cancelled")} />
      </div>

      <div className="mb-5">
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          className="flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          aria-expanded={filtersOpen}
        >
          Filtrar
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{activeFilterCount}</span>
          ) : null}
          <IconChevron className={`h-3 w-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
        </button>

        {filtersOpen ? (
          <div className="mt-2 rounded-2xl border border-border bg-surface-raised/50 p-3">
            {filters}
            {activeFilterCount > 0 ? (
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setNetworkFilter("all");
                    setStatusFilter("all");
                    setFormatFilter("all");
                    setDateFilter("all");
                  }}
                >
                  Limpar filtros
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !publications || publications.length === 0 ? (
        <EmptyState
          title="Nenhum conteúdo ainda"
          description="Quando algo for publicado ou agendado, a biblioteca aparece aqui."
          action={<Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-ink-muted">
          Nenhum conteúdo corresponde aos filtros aplicados.
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((post) => (
            <PublicationCard key={`${post.network}-${post.id}`} workspaceId={workspace.id} post={post} busy={busyId === post.id} onOpen={() => setSelectedPost(post)} onCancel={() => cancel(post)} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((post) => (
            <PublicationListItem key={`${post.network}-${post.id}`} workspaceId={workspace.id} post={post} busy={busyId === post.id} onOpen={() => setSelectedPost(post)} onCancel={() => cancel(post)} />
          ))}
        </div>
      )}

      {selectedPost ? (
        <PublicationDetailDrawer workspaceId={workspace.id} post={selectedPost} busy={busyId === selectedPost.id} onCancel={() => cancel(selectedPost)} onClose={() => setSelectedPost(undefined)} />
      ) : null}
    </main>
  );
}

function FilterSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" aria-label={label}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function StatPill({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-w-[128px] items-center justify-between gap-3 rounded-full border px-3 py-2 text-left transition ${active ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-raised/50 text-ink-muted hover:text-ink"}`}>
      <span className="text-xs font-medium">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </button>
  );
}

function PublicationCard({ workspaceId, post, busy, onOpen, onCancel }: { workspaceId: string; post: UnifiedPublication; busy: boolean; onOpen: () => void; onCancel: () => void }) {
  const format = contentTypeOf(post);
  const status = derivePublicationStatus(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const when = publicationDate(post);

  return (
    <article className="group min-w-0 overflow-hidden rounded-2xl border border-border bg-surface-raised/55 transition hover:border-accent/70 hover:shadow-lg">
      <button type="button" onClick={onOpen} className={`relative flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-5xl text-white/75 drop-shadow" aria-hidden>{FORMAT_ICON[format]}</span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">{NETWORK_ICON[post.network]} {NETWORK_LABEL[post.network]}</span>
        <span className="absolute right-3 top-3"><StatusBadge status={status} /></span>
      </button>
      <div className="p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 text-left">
            <h2 className="line-clamp-2 text-sm font-semibold text-ink">{titleOf(post)}</h2>
            <p className="mt-1 text-xs text-ink-muted">{when ? formatDateTime(when) : "Sem data"} · {FORMAT_LABEL[format]}</p>
          </button>
          <ActionsMenu workspaceId={workspaceId} post={post} busy={busy} onOpen={onOpen} onCancel={onCancel} />
        </div>
      </div>
    </article>
  );
}

function PublicationListItem({ workspaceId, post, busy, onOpen, onCancel }: { workspaceId: string; post: UnifiedPublication; busy: boolean; onOpen: () => void; onCancel: () => void }) {
  const format = contentTypeOf(post);
  const status = derivePublicationStatus(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const when = publicationDate(post);

  return (
    <article className="flex min-w-0 gap-3 rounded-2xl border border-border bg-surface-raised/55 p-3">
      <button type="button" onClick={onOpen} className={`relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-3xl text-white/75" aria-hidden>{FORMAT_ICON[format]}</span>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <NetworkBadge network={post.network} />
            <StatusBadge status={status} />
          </div>
          <button type="button" onClick={onOpen} className="min-w-0 text-left">
            <h2 className="line-clamp-2 text-sm font-semibold text-ink">{titleOf(post)}</h2>
            <p className="mt-1 text-xs text-ink-muted">{when ? formatDateTime(when) : "Sem data"} · {FORMAT_LABEL[format]}</p>
          </button>
        </div>
      </div>
      <ActionsMenu workspaceId={workspaceId} post={post} busy={busy} onOpen={onOpen} onCancel={onCancel} />
    </article>
  );
}

function ActionsMenu({ workspaceId, post, busy, onOpen, onCancel }: { workspaceId: string; post: UnifiedPublication; busy: boolean; onOpen: () => void; onCancel: () => void }) {
  const status = derivePublicationStatus(post);
  return (
    <details className="relative shrink-0">
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">•••</summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-border bg-surface-raised p-1 shadow-xl">
        <button type="button" onClick={onOpen} className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-surface-sunken">Abrir</button>
        <Link href={publishAgainHref(workspaceId, post)} className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface-sunken">Publicar novamente</Link>
        {status === "scheduled" ? (
          <button type="button" disabled={busy} onClick={onCancel} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-60">Cancelar agendamento</button>
        ) : null}
      </div>
    </details>
  );
}

function PublicationDetailDrawer({ workspaceId, post, busy, onClose, onCancel }: { workspaceId: string; post: UnifiedPublication; busy: boolean; onClose: () => void; onCancel: () => void }) {
  const format = contentTypeOf(post);
  const status = derivePublicationStatus(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const when = publicationDate(post);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Fechar detalhe" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-surface-raised p-4 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Conteúdo</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">{titleOf(post)}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-ink-muted hover:bg-surface-sunken">Fechar</button>
        </div>

        {thumbnail ? (
          // Peça inteira sem corte (mesmo achado ao vivo do review/page.tsx — `object-cover` numa
          // caixa de proporção fixa cortava peças que não são exatamente 4:3, ex.: Stories 9:16).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="mx-auto mb-5 max-h-[60vh] w-full rounded-2xl border border-border object-contain" />
        ) : (
          <div className={`relative mb-5 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
            <span className="text-6xl text-white/75" aria-hidden>{FORMAT_ICON[format]}</span>
          </div>
        )}

        <div className="mb-5 flex flex-wrap gap-2">
          <NetworkBadge network={post.network} />
          <StatusBadge status={status} />
          <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-muted">{FORMAT_LABEL[format]}</span>
          {post.placement === "story" ? <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-muted">Story</span> : null}
        </div>

        <div className="space-y-4">
          <DetailBlock label="Legenda" value={post.text || "Sem legenda"} />
          <DetailBlock label={status === "scheduled" ? "Agendado para" : status === "published" ? "Publicado em" : "Data"} value={when ? formatDateTime(when) : "Sem data"} />
          {post.timezone ? <DetailBlock label="Fuso" value={post.timezone} /> : null}
          <DetailBlock label="Histórico" value={PUBLICATION_DISPLAY_STATUS_LABEL[status]} />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={publishAgainHref(workspaceId, post)}><Button>Publicar novamente</Button></Link>
          {status === "scheduled" ? <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancelar agendamento</Button> : null}
        </div>
      </aside>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{value}</p>
    </div>
  );
}

function NetworkBadge({ network }: { network: PublicationNetwork }) {
  return <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-ink-muted">{NETWORK_ICON[network]} {NETWORK_LABEL[network]}</span>;
}

function viewModeButtonClass(active: boolean) {
  return `rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`;
}

function titleOf(post: UnifiedPublication): string {
  const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 96) : `${NETWORK_LABEL[post.network]} · ${FORMAT_LABEL[contentTypeOf(post)]}`;
}

function publicationDate(post: UnifiedPublication): string | undefined {
  return post.scheduledAt ?? post.publishedAt ?? post.createdAt;
}

function publishAgainHref(workspaceId: string, post: UnifiedPublication): string {
  return `/workspaces/${workspaceId}/publish?network=${post.network}&source=${encodeURIComponent(`${post.network}:${post.id}`)}`;
}
