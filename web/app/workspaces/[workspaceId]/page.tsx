"use client";

import Link from "next/link";
import useSWR from "swr";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { listCampaigns } from "@/features/campaigns/data";
import { listConversations } from "@/features/conversation/api";
import { listAssets } from "@/features/assets/data";
import { formatDate, formatRelativeTime } from "@/lib/format";

/**
 * Workspace Home — Sprint 04, Fase 2. `campaignIds`/status de integração vêm do Workspace real
 * (API); campanhas/quantidade de assets ainda vêm dos módulos simulados (`features/*data.ts`,
 * Sprint 04). "Últimas conversas" passou a usar dados REAIS a partir da Sprint 06
 * (`features/conversation/api.ts`) — Conversation ganhou endpoint próprio, Chat (mock) não.
 */
export default function WorkspaceHomePage() {
  const workspace = useCurrentWorkspace();
  const { data: campaigns } = useSWR(["home-campaigns", workspace.id], () => listCampaigns(workspace.id));
  const { data: conversations, error: conversationsError, mutate: mutateConversations } = useSWR(["home-conversations", workspace.id], () => listConversations(workspace.id));
  const { data: assets } = useSWR(["home-assets", workspace.id], () => listAssets(workspace.id));

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-ink">Últimas campanhas</span>
            <Link href={`/workspaces/${workspace.id}/campaigns`} className="text-xs font-medium text-accent hover:underline">
              Ver todas
            </Link>
          </CardHeader>
          <CardBody>
            {!campaigns ? null : campaigns.length === 0 ? (
              <EmptyState title="Nenhuma campanha ainda" />
            ) : (
              <ul className="flex flex-col gap-3">
                {campaigns.slice(0, 3).map((campaign) => (
                  <li key={campaign.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ink">{campaign.name}</span>
                    <StatusBadge status={campaign.status} />
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
            <span className="text-sm font-semibold text-ink">Ativos</span>
            <Link href={`/workspaces/${workspace.id}/assets`} className="text-xs font-medium text-accent hover:underline">
              Ver biblioteca
            </Link>
          </CardHeader>
          <CardBody>
            <p className="text-2xl font-semibold text-ink">{assets?.length ?? "—"}</p>
            <p className="text-sm text-ink-muted">ativos registrados</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-ink">Integrações</span>
          </CardHeader>
          <CardBody>
            {workspace.integrations.length === 0 ? (
              <EmptyState title="Nenhuma integração conectada" description="Conectar redes sociais chega em uma sprint futura." />
            ) : (
              <ul className="flex flex-col gap-3">
                {workspace.integrations.map((integration) => (
                  <li key={integration.id} className="flex items-center justify-between gap-2">
                    <span className="text-sm capitalize text-ink">{integration.channel}</span>
                    <StatusBadge status={integration.status} />
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
