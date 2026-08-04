"use client";

import Link from "next/link";
import useSWR from "swr";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { listConversations } from "@/features/conversation/api";
import { listAssets } from "@/features/assets/data";
import { useTikTokOAuthStatus } from "@/features/tiktok/hooks";
import { useMetaOAuthStatus } from "@/features/meta/hooks";
import { useKwaiOAuthStatus } from "@/features/kwai/hooks";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { derivePublicationStatus } from "@/features/publication-history/types";
import { formatDate, formatRelativeTime } from "@/lib/format";

const NETWORK_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", kwai: "Kwai" };

/**
 * Workspace Home. O card "Conexões", o bloco de primeiros passos e "Últimas publicações" usam
 * dado real de publicação (TikTok/Meta/Kwai) — "Materiais" ainda vem do módulo simulado
 * (`features/assets/data.ts`).
 */
export default function WorkspaceHomePage() {
  const workspace = useCurrentWorkspace();
  const { data: publications } = useUnifiedPublications(workspace.id);
  const { data: conversations, error: conversationsError, mutate: mutateConversations } = useSWR(["home-conversations", workspace.id], () => listConversations(workspace.id));
  const { data: assets } = useSWR(["home-assets", workspace.id], () => listAssets(workspace.id));

  const { data: tiktokOAuth } = useTikTokOAuthStatus(workspace.id);
  const { data: metaOAuth } = useMetaOAuthStatus(workspace.id);
  const { data: kwaiOAuth } = useKwaiOAuthStatus(workspace.id);

  const oauthLoaded = tiktokOAuth !== undefined && metaOAuth !== undefined && kwaiOAuth !== undefined;
  const connectedAccounts = [
    ...(tiktokOAuth?.accounts ?? []).filter((account) => account.status === "active").map((account) => ({ network: "TikTok", name: account.displayName ?? account.openId })),
    ...(metaOAuth?.accounts ?? []).filter((account) => account.status === "active").map((account) => ({ network: account.providerId === "instagram" ? "Instagram" : "Facebook", name: account.displayName ?? account.providerSubjectId })),
    ...(kwaiOAuth?.accounts ?? []).filter((account) => account.status === "active").map((account) => ({ network: "Kwai", name: account.displayName ?? account.openId })),
  ];
  const hasAnyConnection = connectedAccounts.length > 0;
  const showOnboarding = oauthLoaded && (publications?.length ?? 0) === 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-ink">{workspace.name}</h1>
            <StatusBadge status={workspace.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">Criado em {formatDate(workspace.createdAt)}</p>
        </div>
      </div>

      {showOnboarding ? (
        <Card className="mb-6 p-5">
          <p className="mb-4 text-sm font-semibold text-ink">Primeiros passos</p>
          <ol className="space-y-3">
            <li className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${hasAnyConnection ? "bg-accent text-white" : "bg-surface-sunken text-ink-muted"}`}>
                  {hasAnyConnection ? "✓" : "1"}
                </span>
                <span className="text-sm text-ink">Conectar uma rede social (TikTok, Instagram, Facebook ou Kwai)</span>
              </div>
              {!hasAnyConnection ? (
                <Link href={`/workspaces/${workspace.id}/connections`}><Button>Conectar</Button></Link>
              ) : null}
            </li>
            <li className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-medium text-ink-muted">2</span>
                <span className={`text-sm ${hasAnyConnection ? "text-ink" : "text-ink-muted"}`}>Publicar seu primeiro conteúdo</span>
              </div>
              {hasAnyConnection ? (
                <Link href={`/workspaces/${workspace.id}/publish`}><Button>Publicar</Button></Link>
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
            <span className="text-sm font-semibold text-ink">Últimas conversas</span>
            <Link href={`/workspaces/${workspace.id}/chat`} className="text-xs font-medium text-accent hover:underline">
              Abrir Chat
            </Link>
          </CardHeader>
          <CardBody>
            {conversationsError ? (
              <ErrorState error={conversationsError} onRetry={() => mutateConversations()} />
            ) : !conversations ? null : conversations.length === 0 ? (
              <EmptyState title="Nenhuma conversa ainda" />
            ) : (
              <ul className="flex flex-col gap-3">
                {conversations.slice(0, 3).map((conversation) => (
                  <li key={conversation.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ink">{conversation.title ?? "Conversa sem título"}</span>
                    <span className="shrink-0 text-xs text-ink-faint">{formatRelativeTime(conversation.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
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
                description="Conecte TikTok, Instagram, Facebook ou Kwai para publicar direto pelo Vorix."
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
