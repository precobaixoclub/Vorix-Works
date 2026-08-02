"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { NewCampaignModal } from "@/features/campaigns/components/NewCampaignModal";
import { useCampaigns } from "@/features/campaigns/hooks";
import { formatDate } from "@/lib/format";

const FORMAT_LABEL: Record<string, string> = { image: "Imagem", video: "Vídeo", carousel: "Carrossel", story: "Story", reel: "Reel" };
const ORIGIN_LABEL: Record<string, string> = { manual: "Manual", ai_suggested: "Sugerido por IA" };

export default function CampaignsPage() {
  const workspace = useCurrentWorkspace();
  const [isCreating, setIsCreating] = useState(false);
  const { data: campaigns, isLoading, error, mutate } = useCampaigns(workspace.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        title="Central de Campanhas"
        description="Campanhas deste Espaço de Trabalho — ainda sem geração automática de conteúdo."
        actions={<Button onClick={() => setIsCreating(true)}>+ Nova Campanha</Button>}
      />

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !campaigns || campaigns.length === 0 ? (
        <EmptyState title="Nenhuma campanha ainda" action={<Button onClick={() => setIsCreating(true)}>+ Nova Campanha</Button>} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-4 py-3 font-medium">Campanha</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Formato</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Origem</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{campaign.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={campaign.status} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{FORMAT_LABEL[campaign.format]}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatDate(campaign.scheduledDate)}</td>
                  <td className="px-4 py-3 text-ink-muted">{ORIGIN_LABEL[campaign.origin]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
