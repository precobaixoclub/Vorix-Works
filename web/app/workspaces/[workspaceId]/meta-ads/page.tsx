"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { formatDateTime } from "@/lib/format";
import { syncMetaAdCampaigns } from "@/features/meta-ads/api";
import { useMetaAdAccounts, useMetaAdCampaignTree } from "@/features/meta-ads/hooks";
import type { MetaAdCampaign, MetaAdEntityStatus } from "@/features/meta-ads/types";

function money(value: number | undefined, currency: string): string {
  if (value === undefined) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function statusOf(status: MetaAdEntityStatus): "connected" | "needs_attention" | "disconnected" {
  if (status === "ACTIVE") return "connected";
  if (status === "PAUSED") return "needs_attention";
  return "disconnected";
}

export default function MetaAdsPage() {
  const workspace = useCurrentWorkspace();
  const { data: accountsData, isLoading: accountsLoading, error: accountsError } = useMetaAdAccounts(workspace.id, true);
  const accounts = useMemo(() => accountsData?.accounts.filter((account) => account.isActive) ?? [], [accountsData]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const activeAccountId = selectedAccountId ?? accounts[0]?.id;
  const activeAccount = accounts.find((account) => account.id === activeAccountId);

  const { data: tree, isLoading: treeLoading, error: treeError, mutate: refetchTree } = useMetaAdCampaignTree(workspace.id, activeAccountId);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | undefined>();

  async function handleSync() {
    if (!activeAccountId) return;
    setSyncing(true);
    setFeedback(undefined);
    try {
      const result = await syncMetaAdCampaigns(workspace.id, activeAccountId);
      await refetchTree();
      setFeedback(`Sincronizado: ${result.campaignsSynced} campanha(s), ${result.adSetsSynced} conjunto(s) de anúncios, ${result.adsSynced} anúncio(s).`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  if (accountsLoading) {
    return (
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-accent" /></div>
      </main>
    );
  }

  if (accountsError) {
    return (
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <ErrorState error={accountsError} />
      </main>
    );
  }

  if (accounts.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <PageHeader title="Anúncios" description="Campanhas de Facebook/Instagram gerenciadas através da Marketing API." />
        <EmptyState
          title="Nenhuma conta de anúncio conectada"
          description="Conecte uma conta do Meta Ads para ver e sincronizar campanhas aqui."
          action={<Link href={`/workspaces/${workspace.id}/connections`}><Button>Ir para Conexões</Button></Link>}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Anúncios"
        description="Campanhas, conjuntos de anúncios e anúncios sincronizados da Marketing API. Números seguem a mesma janela de atribuição do Ads Manager (7 dias clique, 1 dia visualização)."
        actions={
          <>
            {accounts.length > 1 ? (
              <select
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={activeAccountId}
                onChange={(event) => setSelectedAccountId(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            ) : null}
            <Button disabled={syncing || !activeAccountId} onClick={handleSync}>{syncing ? "Sincronizando..." : "Sincronizar"}</Button>
          </>
        }
      />

      {feedback ? <Card className="mb-4 border-accent/30 bg-accent-soft/30 p-3"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      {activeAccount ? (
        <p className="mb-4 text-xs text-ink-muted">
          Conta: {activeAccount.name} ({activeAccount.accountId}) · {activeAccount.currency}
          {activeAccount.lastSyncedAt ? ` · última sincronização ${formatDateTime(activeAccount.lastSyncedAt)}` : ""}
        </p>
      ) : null}

      {treeLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-accent" /></div>
      ) : treeError ? (
        <ErrorState error={treeError} onRetry={() => refetchTree()} />
      ) : !tree || tree.campaigns.length === 0 ? (
        <EmptyState title="Nenhuma campanha sincronizada ainda" description="Clique em Sincronizar para importar campanhas desta conta." />
      ) : (
        <div className="grid gap-3">
          {tree.campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.id}
              campaign={campaign}
              currency={activeAccount?.currency ?? "BRL"}
              expanded={expandedCampaignId === campaign.id}
              onToggle={() => setExpandedCampaignId(expandedCampaignId === campaign.id ? undefined : campaign.id)}
              adSets={tree.adSets.filter((adSet) => adSet.campaignId === campaign.id)}
              ads={tree.ads}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function CampaignRow({ campaign, currency, expanded, onToggle, adSets, ads }: {
  campaign: MetaAdCampaign;
  currency: string;
  expanded: boolean;
  onToggle: () => void;
  adSets: readonly import("@/features/meta-ads/types").MetaAdSet[];
  ads: readonly import("@/features/meta-ads/types").MetaAdEntity[];
}) {
  return (
    <Card className="overflow-hidden p-0">
      <button type="button" onClick={onToggle} className="flex w-full flex-col gap-2 p-4 text-left sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">{campaign.name}</h3>
            <StatusBadge status={statusOf(campaign.status)} />
          </div>
          <p className="mt-1 text-xs text-ink-muted">{campaign.objective ?? "—"} · {adSets.length} conjunto{adSets.length === 1 ? "" : "s"} de anúncios</p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-sm">
          <div className="text-right">
            <p className="font-medium text-ink">{money(campaign.spend, currency)}</p>
            <p className="text-xs text-ink-muted">{campaign.impressions ?? 0} impressões · {campaign.clicks ?? 0} cliques</p>
          </div>
          <span className="text-ink-muted">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-border bg-surface/70 p-3 sm:p-4">
          {adSets.length === 0 ? (
            <p className="text-xs text-ink-muted">Nenhum conjunto de anúncios nesta campanha.</p>
          ) : (
            <div className="grid gap-2">
              {adSets.map((adSet) => (
                <div key={adSet.id} className="rounded-xl border border-border bg-surface-raised p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink">{adSet.name}</p>
                      <StatusBadge status={statusOf(adSet.status)} />
                    </div>
                    <p className="text-sm text-ink">{money(adSet.spend, currency)}</p>
                  </div>
                  <div className="mt-2 grid gap-1.5 border-t border-border pt-2">
                    {ads.filter((ad) => ad.adSetId === adSet.id).map((ad) => (
                      <div key={ad.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-ink-muted">{ad.name}</span>
                          <StatusBadge status={statusOf(ad.status)} />
                        </div>
                        <span className="text-ink-muted">{money(ad.spend, currency)} · {ad.impressions ?? 0} impr.</span>
                      </div>
                    ))}
                    {ads.filter((ad) => ad.adSetId === adSet.id).length === 0 ? <p className="text-xs text-ink-muted">Nenhum anúncio neste conjunto.</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
