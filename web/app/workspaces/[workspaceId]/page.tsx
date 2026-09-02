"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ClipboardCheck, Factory, FolderOpen } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { StatsGrid } from "@/components/StatsGrid";
import { HubCard, type HubItem } from "@/components/HubPage";
import { KpiCard, num } from "@/components/DashboardKit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRunState } from "@/features/execution/types";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import {
  contentTypeOf,
  derivePublicationStatus,
  type UnifiedPublication,
} from "@/features/publication-history/types";
import { formatDate } from "@/lib/format";

const IN_PROGRESS_STATES: readonly ExecutionRunState[] = ["created", "validating", "ready", "running"];
const GENERATED_STATES: readonly ExecutionRunState[] = ["waiting_for_approval", "completed"];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function WorkspaceHomePage() {
  const router = useRouter();
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
  const loading = runsLoading || publicationsLoading;

  const shortcuts: HubItem[] = [
    {
      id: "production",
      title: "Produção",
      tagline: "Fluxo de criação",
      description: "Abrir tanque, rotina e geração de conteúdos.",
      icon: Factory,
      route: `/workspaces/${workspace.id}/production`,
      accent: "emerald",
    },
    {
      id: "review",
      title: "Revisão",
      tagline: "Aprovação",
      description: `${awaitingReviewCount} conteúdo(s) aguardando aprovação.`,
      icon: ClipboardCheck,
      route: `/workspaces/${workspace.id}/review`,
      accent: "amber",
    },
    {
      id: "campaigns",
      title: "Conteúdos",
      tagline: "Histórico",
      description: "Ver histórico, publicados e agendados.",
      icon: FolderOpen,
      route: `/workspaces/${workspace.id}/campaigns`,
      accent: "violet",
    },
    {
      id: "calendar",
      title: "Calendário",
      tagline: "Agenda",
      description: `${scheduledCount} publicação(ões) agendada(s).`,
      icon: CalendarClock,
      route: `/workspaces/${workspace.id}/calendar`,
      accent: "sky",
    },
  ];

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{workspace.name}</h1>
            <StatusBadge status={workspace.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumo dos últimos 30 dias e atalhos para continuar a operação.
          </p>
        </div>
        <p className="text-xs text-muted-foreground/70">Espaço criado em {formatDate(workspace.createdAt)}</p>
      </header>

      <section className="mt-6">
        <StatsGrid>
          <KpiCard
            label="Gerados em 30 dias"
            value={loading ? "…" : num(generatedLast30)}
            hint="Execuções concluídas ou aguardando aprovação"
          />
          <KpiCard
            label="Em produção"
            value={runsLoading ? "…" : num(inProductionCount)}
            hint="Execuções rodando ou preparadas agora"
          />
          <KpiCard
            label="Aguardando revisão"
            value={runsLoading ? "…" : num(awaitingReviewCount)}
            hint="Conteúdos que precisam de aprovação"
          />
          <KpiCard
            label="Publicados em 30 dias"
            value={loading ? "…" : num(publishedLast30)}
            hint={`${recentByType.image} imagem(ns) · ${recentByType.carousel} carrossel(is) · ${recentByType.video} vídeo(s)`}
            accent="positive"
          />
        </StatsGrid>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-foreground">Continuar a operação</h2>
        <div className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {shortcuts.map((item, i) => (
            <HubCard
              key={item.id}
              item={item}
              order={i + 1}
              onClick={() => router.push(item.route)}
              ctaLabel="Abrir"
            />
          ))}
        </div>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Métricas gerais</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pt-0 sm:grid-cols-2 lg:grid-cols-5">
            <CompactMetric label="Execuções totais" value={realRuns.length} loading={runsLoading} />
            <CompactMetric label="Conteúdos no histórico" value={publications?.length ?? 0} loading={publicationsLoading} />
            <CompactMetric label="Agendados" value={scheduledCount} loading={publicationsLoading} />
            <CompactMetric label="Publicados nos últimos 30 dias" value={publishedLast30} loading={publicationsLoading} />
            <CompactMetric
              label="Falhas nos últimos 30 dias"
              value={failedLast30}
              loading={runsLoading}
              accent={failedLast30 > 0 ? "negative" : "default"}
            />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function CompactMetric({
  label,
  value,
  loading,
  accent = "default",
}: {
  label: string;
  value: number;
  loading?: boolean;
  accent?: "default" | "negative";
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-semibold tabular-nums ${accent === "negative" ? "text-destructive" : "text-foreground"}`}
      >
        {loading ? "…" : num(value)}
      </span>
    </div>
  );
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
