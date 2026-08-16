"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import {
  contentTypeOf,
  derivePublicationStatus,
  type PublicationContentType,
  type PublicationDisplayStatus,
  type PublicationNetwork,
  type UnifiedPublication,
} from "@/features/publication-history/types";
import { formatDateTime } from "@/lib/format";

const NETWORK_LABEL: Record<PublicationNetwork, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };
const NETWORK_ICON: Record<PublicationNetwork, string> = { tiktok: "🎵", instagram: "📷", facebook: "👍", youtube: "▶" };
const FORMAT_LABEL: Record<PublicationContentType, string> = { image: "Imagem", video: "Vídeo", carousel: "Carrossel", text: "Texto" };
const FORMAT_ICON: Record<PublicationContentType, string> = { image: "🖼", video: "🎬", carousel: "🔄", text: "📝" };
const FORMAT_GRADIENT: Record<PublicationContentType, string> = {
  image: "from-blue-500/70 via-indigo-500/60 to-purple-500/70",
  video: "from-red-500/70 via-orange-500/60 to-amber-500/70",
  carousel: "from-emerald-500/70 via-teal-500/60 to-cyan-500/70",
  text: "from-slate-500/70 via-slate-400/60 to-slate-600/70",
};

const NETWORK_FILTERS: Array<{ value: PublicationNetwork | "all"; label: string }> = [
  { value: "all", label: "Todas as redes" },
  { value: "tiktok", label: "🎵 TikTok" },
  { value: "instagram", label: "📷 Instagram" },
  { value: "facebook", label: "👍 Facebook" },
  { value: "youtube", label: "▶ YouTube Shorts" },
];

const STATUS_FILTERS: Array<{ value: PublicationDisplayStatus | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "scheduled", label: "Agendado" },
  { value: "published", label: "Publicado" },
  { value: "failed", label: "Falhou" },
  { value: "cancelled", label: "Cancelado" },
];

const FORMAT_FILTERS: Array<{ value: PublicationContentType | "all"; label: string }> = [
  { value: "all", label: "Todos formatos" },
  { value: "image", label: "🖼 Imagem" },
  { value: "video", label: "🎬 Vídeo" },
  { value: "carousel", label: "🔄 Carrossel" },
];

type DateFilter = "all" | "upcoming" | "past" | "this_month";
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
  if (filter === "upcoming") return date.getTime() >= now.getTime();
  if (filter === "past") return date.getTime() < now.getTime();
  if (filter === "this_month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return true;
}

/**
 * Histórico real de publicações — tudo que já foi postado ou está agendado, unificado entre
 * TikTok/Instagram/Facebook/YouTube (antes esta tela mostrava 4 itens fixos simulados, sem nenhuma
 * ligação com o que de fato foi publicado). Filtra por rede social, status, formato e data.
 */
export default function PublicationsHistoryPage() {
  const workspace = useCurrentWorkspace();
  const [search, setSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<PublicationNetwork | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PublicationDisplayStatus | "all">("all");
  const [formatFilter, setFormatFilter] = useState<PublicationContentType | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [busyId, setBusyId] = useState<string | undefined>();
  const { data: publications, isLoading, error, mutate } = useUnifiedPublications(workspace.id);

  const stats = useMemo(() => {
    const list = (publications ?? []).map((p) => derivePublicationStatus(p));
    return {
      total: list.length,
      scheduled: list.filter((s) => s === "scheduled").length,
      published: list.filter((s) => s === "published").length,
      failed: list.filter((s) => s === "failed").length,
      cancelled: list.filter((s) => s === "cancelled").length,
    };
  }, [publications]);

  const filtered = useMemo(() => {
    const list = publications ?? [];
    return list
      .filter((p) => (networkFilter === "all" ? true : p.network === networkFilter))
      .filter((p) => (statusFilter === "all" ? true : derivePublicationStatus(p) === statusFilter))
      .filter((p) => (formatFilter === "all" ? true : contentTypeOf(p) === formatFilter))
      .filter((p) => matchesDate(p.scheduledAt ?? p.publishedAt, dateFilter))
      .filter((p) => (search ? p.text.toLowerCase().includes(search.toLowerCase()) : true));
  }, [publications, networkFilter, statusFilter, formatFilter, dateFilter, search]);

  async function cancel(post: UnifiedPublication) {
    setBusyId(post.id);
    try {
      await cancelUnifiedPublication(workspace.id, post.network, post.id);
      await mutate();
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Publicações"
        description="Tudo o que já foi postado ou está agendado nas suas redes sociais, em um só lugar."
        actions={<Link href={`/workspaces/${workspace.id}/publish`}><Button>+ Nova Publicação</Button></Link>}
      />

      <ScreenGuide
        title="Como acompanhar"
        description="Esta é a visão operacional das postagens: o que está agendado, publicado, cancelado ou com falha."
        items={[
          "Use os números do topo para ver o estado geral.",
          "Filtre por rede, status, formato ou período.",
          "Abra os cards para identificar legenda, data e formato.",
          "Cancele apenas publicações que ainda estão agendadas.",
        ]}
        aside={<p>Se uma publicação falhar, confira primeiro a conexão da rede social e depois tente reagendar.</p>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total" value={stats.total} tone="neutral" />
        <StatCard label="Agendado" value={stats.scheduled} tone="warning" />
        <StatCard label="Publicado" value={stats.published} tone="success" />
        <StatCard label="Falhou" value={stats.failed} tone="danger" />
        <StatCard label="Cancelado" value={stats.cancelled} tone="muted" />
      </div>

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised/40 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_160px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por legenda…"
            aria-label="Buscar publicações"
            className="w-full"
          />
          <select
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value as PublicationNetwork | "all")}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            aria-label="Filtrar por rede social"
          >
            {NETWORK_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            aria-label="Filtrar por data"
          >
            {DATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-muted">Status:</span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                statusFilter === f.value ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-muted">Formato:</span>
          {FORMAT_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFormatFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                formatFilter === f.value ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !publications || publications.length === 0 ? (
        <EmptyState
          title="Nenhuma publicação ainda"
          description="Publique o primeiro conteúdo ou conecte uma rede social para começar."
          action={<Link href={`/workspaces/${workspace.id}/publish`}><Button>+ Nova Publicação</Button></Link>}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-ink-muted">
          Nenhuma publicação corresponde aos filtros aplicados.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((post) => (
            <PublicationCard key={`${post.network}-${post.id}`} post={post} busy={busyId === post.id} onCancel={() => cancel(post)} />
          ))}
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "neutral" | "muted" | "warning" | "accent" | "success" | "danger" }) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-border bg-surface-raised/40 text-ink",
    muted: "border-status-archived/30 bg-status-archived-bg/40 text-status-archived",
    warning: "border-status-inactive/30 bg-status-inactive-bg/40 text-status-inactive",
    accent: "border-accent/30 bg-accent-soft/40 text-accent",
    success: "border-status-active/30 bg-status-active-bg/40 text-status-active",
    danger: "border-red-300/40 bg-red-50 text-red-700",
  };
  return (
    <div className={`min-w-0 rounded-xl border px-3 py-3 sm:px-4 ${toneClasses[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function PublicationCard({ post, busy, onCancel }: { post: UnifiedPublication; busy: boolean; onCancel: () => void }) {
  const format = contentTypeOf(post);
  const status = derivePublicationStatus(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const extraImages = format === "carousel" ? post.media.imageUrls.length - 1 : 0;
  const when = post.scheduledAt ?? post.publishedAt ?? post.createdAt;

  return (
    <article className="group min-w-0 overflow-hidden rounded-xl border border-border bg-surface-raised/40 transition hover:border-accent hover:shadow-lg">
      <div className={`relative flex aspect-square items-center justify-center bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-6xl opacity-80 drop-shadow-lg" aria-hidden>{FORMAT_ICON[format]}</span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
          {NETWORK_ICON[post.network]} {NETWORK_LABEL[post.network]}
        </span>
        <span className="absolute right-3 top-3"><StatusBadge status={status} /></span>
        {post.placement === "story" ? (
          <span className="absolute bottom-3 left-3 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">Story</span>
        ) : null}
        {extraImages > 0 ? (
          <span className="absolute bottom-3 right-3 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">+{extraImages}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1 p-3 sm:p-4">
        <p className="line-clamp-3 min-h-[3.75rem] break-words text-sm text-ink" title={post.text}>{post.text || "Sem legenda"}</p>
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-ink-muted">
          <span>{when ? formatDateTime(when) : "Sem data"}</span>
          <span className="shrink-0">{FORMAT_LABEL[format]}</span>
        </div>
        {status === "scheduled" ? (
          <Button variant="secondary" disabled={busy} onClick={onCancel} className="mt-2">Cancelar</Button>
        ) : null}
      </div>
    </article>
  );
}
