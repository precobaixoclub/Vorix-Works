"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { NewCampaignModal } from "@/features/campaigns/components/NewCampaignModal";
import { useCampaigns } from "@/features/campaigns/hooks";
import type { Campaign, CampaignFormat, CampaignStatus } from "@/features/campaigns/types";
import { formatDate } from "@/lib/format";

const FORMAT_LABEL: Record<CampaignFormat, string> = {
  image: "Imagem",
  video: "Vídeo",
  carousel: "Carrossel",
  story: "Story",
  reel: "Reel",
};

const FORMAT_ICON: Record<CampaignFormat, string> = {
  image: "🖼",
  video: "🎬",
  carousel: "🔄",
  story: "⚡",
  reel: "📱",
};

// Gradientes de placeholder por formato — vira preview real quando o pipeline de IA estiver ligado.
const FORMAT_GRADIENT: Record<CampaignFormat, string> = {
  image: "from-blue-500/70 via-indigo-500/60 to-purple-500/70",
  video: "from-red-500/70 via-orange-500/60 to-amber-500/70",
  carousel: "from-emerald-500/70 via-teal-500/60 to-cyan-500/70",
  story: "from-pink-500/70 via-fuchsia-500/60 to-purple-500/70",
  reel: "from-purple-500/70 via-pink-500/60 to-rose-500/70",
};

const ORIGIN_LABEL: Record<string, string> = { manual: "Manual", ai_suggested: "Sugerido por IA" };

const STATUS_FILTERS: Array<{ value: CampaignStatus | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "draft", label: "Rascunho" },
  { value: "scheduled", label: "Agendado" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluído" },
];

const FORMAT_FILTERS: Array<{ value: CampaignFormat | "all"; label: string }> = [
  { value: "all", label: "Todos formatos" },
  { value: "image", label: "🖼 Imagem" },
  { value: "video", label: "🎬 Vídeo" },
  { value: "carousel", label: "🔄 Carrossel" },
  { value: "story", label: "⚡ Story" },
  { value: "reel", label: "📱 Reel" },
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

export default function CampaignsPage() {
  const workspace = useCurrentWorkspace();
  const [isCreating, setIsCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">("all");
  const [formatFilter, setFormatFilter] = useState<CampaignFormat | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const { data: campaigns, isLoading, error, mutate } = useCampaigns(workspace.id);

  const stats = useMemo(() => {
    const list = campaigns ?? [];
    return {
      total: list.length,
      draft: list.filter((c) => c.status === "draft").length,
      scheduled: list.filter((c) => c.status === "scheduled").length,
      in_progress: list.filter((c) => c.status === "in_progress").length,
      completed: list.filter((c) => c.status === "completed").length,
    };
  }, [campaigns]);

  const filtered = useMemo(() => {
    const list = campaigns ?? [];
    return list
      .filter((c) => (statusFilter === "all" ? true : c.status === statusFilter))
      .filter((c) => (formatFilter === "all" ? true : c.format === formatFilter))
      .filter((c) => matchesDate(c.scheduledDate, dateFilter))
      .filter((c) => (search ? c.name.toLowerCase().includes(search.toLowerCase()) : true))
      .sort((a, b) => {
        const da = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
        const db = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
        return db - da;
      });
  }, [campaigns, statusFilter, formatFilter, dateFilter, search]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title="Central de Publicações"
        description="Todo o conteúdo criado para as redes sociais desta marca — passado, presente e futuro em um só lugar."
        actions={<Button onClick={() => setIsCreating(true)}>+ Nova Publicação</Button>}
      />

      {/* Stats de topo */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total" value={stats.total} tone="neutral" />
        <StatCard label="Rascunho" value={stats.draft} tone="muted" />
        <StatCard label="Agendado" value={stats.scheduled} tone="warning" />
        <StatCard label="Em andamento" value={stats.in_progress} tone="accent" />
        <StatCard label="Concluído" value={stats.completed} tone="success" />
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome…"
            aria-label="Buscar publicações"
            className="max-w-xs"
          />
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            aria-label="Filtrar por data"
          >
            {DATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
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

      {/* Grid de publicações */}
      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !campaigns || campaigns.length === 0 ? (
        <EmptyState
          title="Nenhuma publicação ainda"
          description="Crie sua primeira peça ou peça para a IA sugerir algo no Chat."
          action={<Button onClick={() => setIsCreating(true)}>+ Nova Publicação</Button>}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-ink-muted">
          Nenhuma publicação corresponde aos filtros aplicados.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((campaign) => (
            <PublicationCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      )}

      {isCreating ? (
        <NewCampaignModal
          workspaceId={workspace.id}
          onClose={() => setIsCreating(false)}
          onCreated={() => {
            setIsCreating(false);
            mutate();
          }}
        />
      ) : null}
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "neutral" | "muted" | "warning" | "accent" | "success" }) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-border bg-surface-raised/40 text-ink",
    muted: "border-status-archived/30 bg-status-archived-bg/40 text-status-archived",
    warning: "border-status-inactive/30 bg-status-inactive-bg/40 text-status-inactive",
    accent: "border-accent/30 bg-accent-soft/40 text-accent",
    success: "border-status-active/30 bg-status-active-bg/40 text-status-active",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClasses[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function PublicationCard({ campaign }: { campaign: Campaign }) {
  const gradient = FORMAT_GRADIENT[campaign.format];
  const icon = FORMAT_ICON[campaign.format];
  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-surface-raised/40 transition hover:border-accent hover:shadow-lg">
      <div className={`relative flex aspect-square items-center justify-center bg-gradient-to-br ${gradient}`}>
        <span className="text-6xl opacity-80 drop-shadow-lg" aria-hidden>
          {icon}
        </span>
        <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
          {FORMAT_LABEL[campaign.format]}
        </span>
        <span className="absolute right-3 top-3">
          <StatusBadge status={campaign.status} />
        </span>
        {campaign.origin === "ai_suggested" ? (
          <span className="absolute bottom-3 left-3 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
            ✨ IA
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-4">
        <h3 className="truncate text-sm font-semibold text-ink" title={campaign.name}>
          {campaign.name}
        </h3>
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>{formatDate(campaign.scheduledDate) || "Sem data"}</span>
          <span>{ORIGIN_LABEL[campaign.origin]}</span>
        </div>
      </div>
    </article>
  );
}
