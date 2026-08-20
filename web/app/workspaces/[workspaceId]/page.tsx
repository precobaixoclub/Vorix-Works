"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRunState } from "@/features/execution/types";
import { useTikTokOAuthStatus } from "@/features/tiktok/hooks";
import { useMetaOAuthStatus } from "@/features/meta/hooks";
import { useYouTubeOAuthStatus } from "@/features/youtube/hooks";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { contentTypeOf, derivePublicationStatus, type UnifiedPublication } from "@/features/publication-history/types";
import { IdeaComposer } from "@/features/production-line/components/IdeaComposer";
import { formatDate, formatDateTime } from "@/lib/format";

const NETWORK_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };
const IN_PROGRESS_STATES: readonly ExecutionRunState[] = ["created", "validating", "ready", "running"];
const ONBOARDING_DISMISSED_KEY_PREFIX = "vorix.home.onboarding-dismissed.";

/**
 * Redesign "IA-first / composer-first" (padrão visual de referência do Vorix) — o composer é o
 * único elemento dominante da tela; tudo abaixo é contexto compacto, nunca métrica inventada. Os
 * blocos antigos de "Materiais"/"Conexões" saíram daqui de propósito: são navegação, não conteúdo
 * de Home. O card "Linha de produção" com números fixos (3/10/1) também saiu — não existe dado
 * real por trás dele.
 */
export default function WorkspaceHomePage() {
  const workspace = useCurrentWorkspace();
  const { data: publications } = useUnifiedPublications(workspace.id);
  const { data: executionRuns } = useExecutionRuns(workspace.id);

  const { data: tiktokOAuth } = useTikTokOAuthStatus(workspace.id);
  const { data: metaOAuth } = useMetaOAuthStatus(workspace.id);
  const { data: youtubeOAuth } = useYouTubeOAuthStatus(workspace.id);
  const oauthLoaded = tiktokOAuth !== undefined && metaOAuth !== undefined && youtubeOAuth !== undefined;
  const hasAnyConnection =
    (tiktokOAuth?.accounts ?? []).some((account) => account.status === "active") ||
    (metaOAuth?.accounts ?? []).some((account) => account.status === "active") ||
    (youtubeOAuth?.accounts ?? []).some((account) => account.status === "active");

  const [onboardingDismissed, setOnboardingDismissed] = useState(true);
  useEffect(() => {
    setOnboardingDismissed(window.localStorage.getItem(`${ONBOARDING_DISMISSED_KEY_PREFIX}${workspace.id}`) === "true");
  }, [workspace.id]);
  function dismissOnboarding() {
    window.localStorage.setItem(`${ONBOARDING_DISMISSED_KEY_PREFIX}${workspace.id}`, "true");
    setOnboardingDismissed(true);
  }
  const showOnboarding = !onboardingDismissed && oauthLoaded && (publications?.length ?? 0) === 0;

  const realRuns = (executionRuns ?? []).filter((run) => run.mode === "real");
  const awaitingReviewCount = realRuns.filter((run) => run.state === "waiting_for_approval").length;
  const inProductionCount = realRuns.filter((run) => IN_PROGRESS_STATES.includes(run.state)).length;
  const scheduledCount = (publications ?? []).filter((post) => derivePublicationStatus(post) === "scheduled").length;

  const recentContent = publications?.slice(0, 5) ?? [];
  const upcoming = (publications ?? [])
    .filter((post): post is UnifiedPublication & { scheduledAt: string } => Boolean(post.scheduledAt) && derivePublicationStatus(post) === "scheduled")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 4);

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="text-sm font-medium text-ink-muted">{workspace.name}</h2>
        <StatusBadge status={workspace.status} />
        <span className="text-xs text-ink-faint">· Criado em {formatDate(workspace.createdAt)}</span>
      </div>

      <IdeaComposer workspaceId={workspace.id} />

      {showOnboarding ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-surface-raised px-4 py-3 text-sm">
          <span className="text-ink-muted">Primeiros passos:</span>
          <Link
            href={`/workspaces/${workspace.id}/connections`}
            className={hasAnyConnection ? "text-ink-faint line-through" : "font-medium text-accent hover:underline"}
          >
            1. Conectar uma rede social
          </Link>
          <Link
            href={`/workspaces/${workspace.id}/production`}
            className={`font-medium ${hasAnyConnection ? "text-accent hover:underline" : "text-ink-faint"}`}
          >
            2. Configurar a linha de produção
          </Link>
          <button type="button" onClick={dismissOnboarding} aria-label="Dispensar" className="ml-auto text-ink-faint hover:text-ink">×</button>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
        <Link href={`/workspaces/${workspace.id}/review`} className="rounded-xl bg-surface-raised px-3 py-3.5 text-center hover:bg-surface-sunken sm:px-4 sm:text-left">
          <p className="text-xl font-semibold text-ink sm:text-2xl">{awaitingReviewCount}</p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">Aguardando revisão</p>
        </Link>
        <Link href={`/workspaces/${workspace.id}/production`} className="rounded-xl bg-surface-raised px-3 py-3.5 text-center hover:bg-surface-sunken sm:px-4 sm:text-left">
          <p className="text-xl font-semibold text-ink sm:text-2xl">{inProductionCount}</p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">Em produção</p>
        </Link>
        <Link href={`/workspaces/${workspace.id}/campaigns`} className="rounded-xl bg-surface-raised px-3 py-3.5 text-center hover:bg-surface-sunken sm:px-4 sm:text-left">
          <p className="text-xl font-semibold text-ink sm:text-2xl">{scheduledCount}</p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">Agendados</p>
        </Link>
      </div>

      {recentContent.length > 0 ? (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-ink">Conteúdos recentes</h3>
            <Link href={`/workspaces/${workspace.id}/campaigns`} className="text-xs font-medium text-accent hover:underline">Ver todos</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {recentContent.map((post) => {
              const thumbnail = post.media.thumbnailUrl ?? post.media.imageUrls[0];
              return (
                <Link
                  key={`${post.network}-${post.id}`}
                  href={`/workspaces/${workspace.id}/campaigns`}
                  className="group overflow-hidden rounded-xl bg-surface-raised"
                >
                  <div className="aspect-square overflow-hidden bg-surface-sunken">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl text-ink-faint" aria-hidden="true">
                        {contentTypeOf(post) === "video" ? "🎬" : "📝"}
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-medium text-ink">{post.text || "Sem legenda"}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-1.5">
                      <span className="truncate text-[11px] text-ink-muted">{NETWORK_LABEL[post.network]}</span>
                      <StatusBadge status={derivePublicationStatus(post)} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-8">
          <h3 className="mb-3 font-display text-base font-semibold text-ink">Próximas publicações</h3>
          <div className="flex flex-col gap-2">
            {upcoming.map((post) => {
              const thumbnail = post.media.thumbnailUrl ?? post.media.imageUrls[0];
              return (
                <Link
                  key={`${post.network}-${post.id}`}
                  href={`/workspaces/${workspace.id}/calendar`}
                  className="flex items-center gap-3 rounded-xl bg-surface-raised p-2.5 hover:bg-surface-sunken"
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-base text-ink-faint" aria-hidden="true">📅</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{post.text || "Sem legenda"}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{NETWORK_LABEL[post.network]} · {formatDateTime(post.scheduledAt)}</p>
                  </div>
                  <StatusBadge status="scheduled" />
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </main>
  );
}
