"use client";

import Link from "next/link";
import { useMemo } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRun, ExecutionRunState } from "@/features/execution/types";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import {
  contentTypeOf,
  derivePublicationStatus,
  type UnifiedPublication,
} from "@/features/publication-history/types";
import { formatDate, formatDateTime } from "@/lib/format";

const NETWORK_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube Shorts",
};
const IN_PROGRESS_STATES: readonly ExecutionRunState[] = ["created", "validating", "ready", "running"];
const GENERATED_STATES: readonly ExecutionRunState[] = ["waiting_for_approval", "completed"];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type Shortcut = {
  href: string;
  label: string;
  description: string;
  icon: string;
};

type ActivityItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  date: string;
  href: string;
};

export default function WorkspaceHomePage() {
  const workspace = useCurrentWorkspace();
  const { data: publications, isLoading: publicationsLoading } = useUnifiedPublications(workspace.id);
  const { data: executionRuns, isLoading: runsLoading } = useExecutionRuns(workspace.id);

  const now = Date.now();
  const cutoff = now - THIRTY_DAYS_MS;
  const realRuns = useMemo(() => (executionRuns ?? []).filter((run) => run.mode === "real"), [executionRuns]);
  const recentRuns = useMemo(() => realRuns.filter((run) => isWithinLast30Days(run.createdAt, cutoff, now)), [cutoff, now, realRuns]);
  const recentPublications = useMemo(
    () => (publications ?? []).filter((post) => isWithinLast30Days(publicationActivityDate(post), cutoff, now)),
    [cutoff, now, publications],
  );

  const generatedLast30 = recentRuns.filter((run) => GENERATED_STATES.includes(run.state)).length;
  const inProductionCount = realRuns.filter((run) => IN_PROGRESS_STATES.includes(run.state)).length;
  const awaitingReviewCount = realRuns.filter((run) => run.state === "waiting_for_approval").length;
  const failedLast30 = recentRuns.filter((run) => run.state === "failed" || run.state === "cancelled").length;
  const scheduledCount = (publications ?? []).filter((post) => derivePublicationStatus(post) === "scheduled").length;
  const publishedLast30 = recentPublications.filter((post) => derivePublicationStatus(post) === "published").length;
  const recentByType = countContentTypes(recentPublications);
  const recentActivity = buildRecentActivity(workspace.id, recentRuns, recentPublications).slice(0, 6);
  const loading = runsLoading || publicationsLoading;

  const shortcuts: Shortcut[] = [
    {
      href: `/workspaces/${workspace.id}/production`,
      label: "Produção",
      description: "Abrir tanque, rotina e geração de conteúdos.",
      icon: "▤",
    },
    {
      href: `/workspaces/${workspace.id}/review`,
      label: "Revisão",
      description: `${awaitingReviewCount} conteúdo(s) aguardando aprovação.`,
      icon: "✓",
    },
    {
      href: `/workspaces/${workspace.id}/campaigns`,
      label: "Conteúdos",
      description: "Ver histórico, publicados e agendados.",
      icon: "▥",
    },
    {
      href: `/workspaces/${workspace.id}/calendar`,
      label: "Calendário",
      description: `${scheduledCount} publicação(ões) agendada(s).`,
      icon: "□",
    },
  ];

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{workspace.name}</h1>
            <StatusBadge status={workspace.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Resumo dos últimos 30 dias e atalhos para continuar a operação.
          </p>
        </div>
        <p className="text-xs text-ink-faint">Espaço criado em {formatDate(workspace.createdAt)}</p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Gerados em 30 dias"
          value={generatedLast30}
          description="Execuções concluídas ou aguardando aprovação"
          loading={loading}
        />
        <MetricCard
          label="Em produção"
          value={inProductionCount}
          description="Execuções rodando ou preparadas agora"
          loading={runsLoading}
        />
        <MetricCard
          label="Aguardando revisão"
          value={awaitingReviewCount}
          description="Conteúdos que precisam de aprovação"
          loading={runsLoading}
        />
        <MetricCard
          label="Publicados em 30 dias"
          value={publishedLast30}
          description={`${recentByType.image} imagem(ns) · ${recentByType.carousel} carrossel(is) · ${recentByType.video} vídeo(s)`}
          loading={loading}
        />
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-4">
        {shortcuts.map((shortcut) => (
          <Link
            key={shortcut.href}
            href={shortcut.href}
            className="group rounded-xl border border-border bg-surface-raised p-4 transition hover:-translate-y-0.5 hover:bg-surface"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-sunken text-sm font-semibold text-accent">
              {shortcut.icon}
            </div>
            <p className="mt-3 font-semibold text-ink group-hover:text-accent">{shortcut.label}</p>
            <p className="mt-1 text-sm text-ink-muted">{shortcut.description}</p>
          </Link>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold text-ink">Atividade recente</h2>
            <p className="text-sm text-ink-muted">Últimos movimentos do workspace nos últimos 30 dias.</p>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <EmptyLine text="Carregando dados..." />
            ) : recentActivity.length === 0 ? (
              <EmptyLine text="Nenhuma geração ou publicação nos últimos 30 dias." />
            ) : (
              recentActivity.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{item.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusBadge status={item.status} />
                    <p className="mt-1 text-[11px] text-ink-faint">{formatDateTime(item.date)}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-4">
          <h2 className="font-semibold text-ink">Métricas gerais</h2>
          <div className="mt-4 grid gap-2">
            <CompactMetric label="Execuções totais" value={realRuns.length} loading={runsLoading} />
            <CompactMetric label="Conteúdos no histórico" value={publications?.length ?? 0} loading={publicationsLoading} />
            <CompactMetric label="Agendados" value={scheduledCount} loading={publicationsLoading} />
            <CompactMetric label="Publicados nos últimos 30 dias" value={publishedLast30} loading={publicationsLoading} />
            <CompactMetric label="Falhas nos últimos 30 dias" value={failedLast30} loading={runsLoading} />
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  description,
  loading,
}: {
  label: string;
  value: number;
  description: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-ink">{loading ? "..." : value}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </div>
  );
}

function CompactMetric({ label, value, loading }: { label: string; value: number; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2.5">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{loading ? "..." : value}</span>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-ink-muted">{text}</p>;
}

function isWithinLast30Days(iso: string | undefined, cutoff: number, now: number): boolean {
  if (!iso) return false;
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now;
}

function publicationActivityDate(post: UnifiedPublication): string {
  return post.publishedAt ?? post.scheduledAt ?? post.createdAt;
}

function countContentTypes(posts: readonly UnifiedPublication[]) {
  return posts.reduce(
    (acc, post) => {
      const type = contentTypeOf(post);
      if (type === "image") acc.image += 1;
      if (type === "carousel") acc.carousel += 1;
      if (type === "video") acc.video += 1;
      return acc;
    },
    { image: 0, carousel: 0, video: 0 },
  );
}

function buildRecentActivity(
  workspaceId: string,
  runs: readonly ExecutionRun[],
  publications: readonly UnifiedPublication[],
): ActivityItem[] {
  const runItems: ActivityItem[] = runs.map((run) => ({
    id: `run-${run.id}`,
    title: `Execução ${run.id.slice(0, 8)}`,
    description: run.state === "waiting_for_approval" ? "Conteúdo gerado aguardando revisão" : "Fluxo de produção",
    status: run.state,
    date: run.finishedAt ?? run.updatedAt ?? run.createdAt,
    href: `/workspaces/${workspaceId}/execution/${run.id}`,
  }));
  const publicationItems: ActivityItem[] = publications.map((post) => ({
    id: `post-${post.network}-${post.id}`,
    title: post.text || "Conteúdo sem legenda",
    description: `${NETWORK_LABEL[post.network]} · ${contentTypeLabel(contentTypeOf(post))}`,
    status: derivePublicationStatus(post),
    date: publicationActivityDate(post),
    href: `/workspaces/${workspaceId}/campaigns`,
  }));

  return [...runItems, ...publicationItems]
    .filter((item) => item.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function contentTypeLabel(type: ReturnType<typeof contentTypeOf>): string {
  if (type === "image") return "Imagem";
  if (type === "carousel") return "Carrossel";
  if (type === "video") return "Vídeo";
  return "Texto";
}
