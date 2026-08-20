"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Textarea } from "@/components/Field";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { listAssets } from "@/features/assets/api";
import { MAX_IDEA_TEXT_LENGTH } from "@/features/production-line/api";
import { useTikTokOAuthStatus } from "@/features/tiktok/hooks";
import { useMetaOAuthStatus } from "@/features/meta/hooks";
import { useYouTubeOAuthStatus } from "@/features/youtube/hooks";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { derivePublicationStatus } from "@/features/publication-history/types";
import { formatDate } from "@/lib/format";

const NETWORK_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };

/**
 * Workspace Home, redesign "composer-first" — abre com o campo de ideia (mesmo destino de
 * `/create`, que faz a geração de verdade) em vez de um painel de métricas. Os cards abaixo
 * ("Conexões", "Últimas publicações", "Materiais da Marca") continuam existindo com dado real,
 * agora como contexto secundário — nunca a primeira coisa que a tela mostra.
 */
export default function WorkspaceHomePage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const { data: publications } = useUnifiedPublications(workspace.id);
  const { data: assets } = useSWR(["home-assets", workspace.id], () => listAssets(workspace.id));

  const { data: tiktokOAuth } = useTikTokOAuthStatus(workspace.id);
  const { data: metaOAuth } = useMetaOAuthStatus(workspace.id);
  const { data: youtubeOAuth } = useYouTubeOAuthStatus(workspace.id);

  const oauthLoaded = tiktokOAuth !== undefined && metaOAuth !== undefined && youtubeOAuth !== undefined;
  const connectedAccounts = [
    ...(tiktokOAuth?.accounts ?? []).filter((account) => account.status === "active").map((account) => ({ network: "TikTok", name: account.displayName ?? account.openId })),
    ...(metaOAuth?.accounts ?? []).filter((account) => account.status === "active").map((account) => ({ network: account.providerId === "instagram" ? "Instagram" : "Facebook", name: account.displayName ?? account.providerSubjectId })),
    ...(youtubeOAuth?.accounts ?? []).filter((account) => account.status === "active").map((account) => ({ network: "YouTube Shorts", name: account.displayName ?? account.channelId })),
  ];
  const hasAnyConnection = connectedAccounts.length > 0;
  const showOnboarding = oauthLoaded && (publications?.length ?? 0) === 0;

  function goToCreate() {
    const trimmed = draft.trim();
    const query = trimmed ? `?draft=${encodeURIComponent(trimmed)}` : "";
    router.push(`/workspaces/${workspace.id}/create${query}`);
  }

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-xl font-semibold text-ink">{workspace.name}</h1>
            <StatusBadge status={workspace.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">Criado em {formatDate(workspace.createdAt)}</p>
        </div>
      </div>

      <Card className="mb-6 border-accent/30 bg-accent-soft/40">
        <CardBody className="space-y-3">
          <div>
            <p className="font-display text-lg font-semibold text-ink">O que você quer publicar hoje?</p>
            <p className="mt-0.5 text-sm text-ink-muted">Descreva a ideia — a IA cuida da estratégia, da copy e da peça final.</p>
          </div>
          <Textarea
            rows={3}
            value={draft}
            maxLength={MAX_IDEA_TEXT_LENGTH}
            placeholder="Ex.: Criar um post anunciando nosso site, com tom direto e um CTA para visitar agora."
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) goToCreate();
            }}
            className="bg-surface"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">{draft.length}/{MAX_IDEA_TEXT_LENGTH} · Ctrl+Enter para continuar</p>
            <Button onClick={goToCreate}>Continuar</Button>
          </div>
        </CardBody>
      </Card>

      {showOnboarding ? (
        <Card className="mb-6 p-5">
          <p className="mb-4 text-sm font-semibold text-ink">Primeiros passos</p>
          <ol className="space-y-3">
            <li className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${hasAnyConnection ? "bg-accent text-white" : "bg-surface-sunken text-ink-muted"}`}>
                  {hasAnyConnection ? "✓" : "1"}
                </span>
                <span className="text-sm text-ink">Conectar uma rede social (TikTok, Instagram, Facebook ou YouTube)</span>
              </div>
              {!hasAnyConnection ? (
                <Link href={`/workspaces/${workspace.id}/connections`}><Button>Conectar</Button></Link>
              ) : null}
            </li>
            <li className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-medium text-ink-muted">2</span>
                <span className={`text-sm ${hasAnyConnection ? "text-ink" : "text-ink-muted"}`}>Configurar a linha de produção</span>
              </div>
              {hasAnyConnection ? (
                <Link href={`/workspaces/${workspace.id}/production`}><Button>Configurar</Button></Link>
              ) : null}
            </li>
          </ol>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-ink">Últimas publicações</span>
            <Link href={`/workspaces/${workspace.id}/campaigns`} className="text-xs font-medium text-accent hover:underline">
              Ver todas
            </Link>
          </CardHeader>
          <CardBody>
            {!publications ? null : publications.length === 0 ? (
              <EmptyState title="Nenhuma publicação ainda" />
            ) : (
              <ul className="flex flex-col gap-3">
                {publications.slice(0, 3).map((post) => (
                  <li key={`${post.network}-${post.id}`} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ink">{NETWORK_LABEL[post.network]} · {post.text || "Sem legenda"}</span>
                    <StatusBadge status={derivePublicationStatus(post)} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-ink">Linha de produção</span>
            <Link href={`/workspaces/${workspace.id}/production`} className="text-xs font-medium text-accent hover:underline">
              Configurar
            </Link>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-surface-sunken px-2 py-3">
                <p className="text-lg font-semibold text-ink">3</p>
                <p className="text-xs text-ink-muted">modelos base</p>
              </div>
              <div className="rounded-lg bg-surface-sunken px-2 py-3">
                <p className="text-lg font-semibold text-ink">10</p>
                <p className="text-xs text-ink-muted">skills</p>
              </div>
              <div className="rounded-lg bg-surface-sunken px-2 py-3">
                <p className="text-lg font-semibold text-ink">1</p>
                <p className="text-xs text-ink-muted">agenda</p>
              </div>
            </div>
            <Link href={`/workspaces/${workspace.id}/production`} className="mt-4 inline-flex">
              <Button>Programar produção</Button>
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-ink">Materiais da Marca</span>
            <Link href={`/workspaces/${workspace.id}/assets`} className="text-xs font-medium text-accent hover:underline">
              Ver biblioteca
            </Link>
          </CardHeader>
          <CardBody>
            <p className="text-2xl font-semibold text-ink">{assets?.length ?? "—"}</p>
            <p className="text-sm text-ink-muted">materiais disponíveis para a IA</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-ink">Conexões</span>
            <Link href={`/workspaces/${workspace.id}/connections`} className="text-xs font-medium text-accent hover:underline">
              Gerenciar →
            </Link>
          </CardHeader>
          <CardBody>
            {!oauthLoaded ? null : connectedAccounts.length === 0 ? (
              <EmptyState
                title="Nenhuma rede social conectada"
                description="Conecte TikTok, Instagram, Facebook ou YouTube para publicar direto pelo Vorix."
                action={<Link href={`/workspaces/${workspace.id}/connections`}><Button>Conectar rede social</Button></Link>}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {connectedAccounts.map((account, index) => (
                  <li key={`${account.network}-${index}`} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ink">{account.network} · {account.name}</span>
                    <StatusBadge status="active" />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
