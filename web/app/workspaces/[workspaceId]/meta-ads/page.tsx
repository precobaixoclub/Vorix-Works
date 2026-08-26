"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { formatDateTime } from "@/lib/format";
import {
  createMetaAd,
  createMetaAdCampaign,
  createMetaAdSet,
  syncMetaAdCampaigns,
  updateMetaAd,
  updateMetaAdCampaign,
  updateMetaAdSet,
} from "@/features/meta-ads/api";
import { useMetaAdAccounts, useMetaAdCampaignTree } from "@/features/meta-ads/hooks";
import type { MetaAdCampaign, MetaAdEntity, MetaAdEntityStatus, MetaAdSet } from "@/features/meta-ads/types";

const OBJECTIVES = [
  { value: "OUTCOME_AWARENESS", label: "Reconhecimento" },
  { value: "OUTCOME_TRAFFIC", label: "Tráfego" },
  { value: "OUTCOME_ENGAGEMENT", label: "Engajamento" },
  { value: "OUTCOME_LEADS", label: "Cadastros" },
  { value: "OUTCOME_SALES", label: "Vendas" },
  { value: "OUTCOME_APP_PROMOTION", label: "Promoção de app" },
];

const OPTIMIZATION_GOALS = [
  { value: "LINK_CLICKS", label: "Cliques no link" },
  { value: "LANDING_PAGE_VIEWS", label: "Visualizações da página de destino" },
  { value: "IMPRESSIONS", label: "Impressões" },
  { value: "REACH", label: "Alcance" },
  { value: "OFFSITE_CONVERSIONS", label: "Conversões" },
  { value: "THRUPLAY", label: "Reproduções de vídeo" },
];

const BILLING_EVENTS = [
  { value: "IMPRESSIONS", label: "Impressões" },
  { value: "LINK_CLICKS", label: "Cliques no link" },
];

const CALL_TO_ACTIONS = [
  { value: "LEARN_MORE", label: "Saiba mais" },
  { value: "SHOP_NOW", label: "Comprar agora" },
  { value: "SIGN_UP", label: "Cadastre-se" },
  { value: "CONTACT_US", label: "Fale conosco" },
  { value: "BOOK_TRAVEL", label: "Reserve agora" },
  { value: "DOWNLOAD", label: "Baixar" },
];

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
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [newAdSetForCampaign, setNewAdSetForCampaign] = useState<MetaAdCampaign | undefined>();
  const [newAdForAdSet, setNewAdForAdSet] = useState<MetaAdSet | undefined>();

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

  async function handleToggleCampaignStatus(campaign: MetaAdCampaign) {
    const nextStatus = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await updateMetaAdCampaign(workspace.id, campaign.id, { status: nextStatus });
      await refetchTree();
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível alterar o status da campanha.");
    }
  }

  async function handleToggleAdSetStatus(adSet: MetaAdSet) {
    const nextStatus = adSet.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await updateMetaAdSet(workspace.id, adSet.id, { status: nextStatus });
      await refetchTree();
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível alterar o status do conjunto de anúncios.");
    }
  }

  async function handleToggleAdStatus(ad: MetaAdEntity) {
    const nextStatus = ad.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await updateMetaAd(workspace.id, ad.id, { status: nextStatus });
      await refetchTree();
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível alterar o status do anúncio.");
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
            <Button variant="secondary" disabled={syncing || !activeAccountId} onClick={handleSync}>{syncing ? "Sincronizando..." : "Sincronizar"}</Button>
            <Button disabled={!activeAccountId} onClick={() => setNewCampaignOpen(true)}>+ Nova campanha</Button>
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
        <EmptyState title="Nenhuma campanha ainda" description="Crie uma campanha nova ou clique em Sincronizar para importar campanhas já existentes desta conta." />
      ) : (
        <div className="grid gap-3">
          {tree.campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.id}
              campaign={campaign}
              currency={activeAccount?.currency ?? "BRL"}
              expanded={expandedCampaignId === campaign.id}
              onToggle={() => setExpandedCampaignId(expandedCampaignId === campaign.id ? undefined : campaign.id)}
              onToggleStatus={() => handleToggleCampaignStatus(campaign)}
              onNewAdSet={() => setNewAdSetForCampaign(campaign)}
              adSets={tree.adSets.filter((adSet) => adSet.campaignId === campaign.id)}
              ads={tree.ads}
              onToggleAdSetStatus={handleToggleAdSetStatus}
              onToggleAdStatus={handleToggleAdStatus}
              onNewAd={(adSet) => setNewAdForAdSet(adSet)}
            />
          ))}
        </div>
      )}

      {newCampaignOpen && activeAccountId ? (
        <NewCampaignModal
          workspaceId={workspace.id}
          adAccountId={activeAccountId}
          onClose={() => setNewCampaignOpen(false)}
          onCreated={async () => {
            setNewCampaignOpen(false);
            await refetchTree();
            setFeedback("Campanha criada — pausada, pronta pra revisar antes de ativar.");
          }}
        />
      ) : null}

      {newAdSetForCampaign ? (
        <NewAdSetModal
          workspaceId={workspace.id}
          campaign={newAdSetForCampaign}
          onClose={() => setNewAdSetForCampaign(undefined)}
          onCreated={async () => {
            setNewAdSetForCampaign(undefined);
            await refetchTree();
            setFeedback("Conjunto de anúncios criado — pausado, pronto pra revisar antes de ativar.");
          }}
        />
      ) : null}

      {newAdForAdSet ? (
        <NewAdModal
          workspaceId={workspace.id}
          adSet={newAdForAdSet}
          onClose={() => setNewAdForAdSet(undefined)}
          onCreated={async () => {
            setNewAdForAdSet(undefined);
            await refetchTree();
            setFeedback("Anúncio criado — pausado, pronto pra revisar antes de ativar.");
          }}
        />
      ) : null}
    </main>
  );
}

function CampaignRow({ campaign, currency, expanded, onToggle, onToggleStatus, onNewAdSet, adSets, ads, onToggleAdSetStatus, onToggleAdStatus, onNewAd }: {
  campaign: MetaAdCampaign;
  currency: string;
  expanded: boolean;
  onToggle: () => void;
  onToggleStatus: () => void;
  onNewAdSet: () => void;
  adSets: readonly MetaAdSet[];
  ads: readonly MetaAdEntity[];
  onToggleAdSetStatus: (adSet: MetaAdSet) => void;
  onToggleAdStatus: (ad: MetaAdEntity) => void;
  onNewAd: (adSet: MetaAdSet) => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex w-full flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">{campaign.name}</h3>
            <StatusBadge status={statusOf(campaign.status)} />
          </div>
          <p className="mt-1 text-xs text-ink-muted">{campaign.objective ?? "—"} · {adSets.length} conjunto{adSets.length === 1 ? "" : "s"} de anúncios</p>
        </button>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <div className="text-right">
            <p className="font-medium text-ink">{money(campaign.spend, currency)}</p>
            <p className="text-xs text-ink-muted">{campaign.impressions ?? 0} impressões · {campaign.clicks ?? 0} cliques</p>
          </div>
          {!campaign.deletedAt ? (
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onToggleStatus}>
              {campaign.status === "ACTIVE" ? "Pausar" : "Ativar"}
            </Button>
          ) : null}
          <button type="button" onClick={onToggle} className="text-ink-muted">{expanded ? "▾" : "▸"}</button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-border bg-surface/70 p-3 sm:p-4">
          <div className="mb-3 flex justify-end">
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={!!campaign.deletedAt} onClick={onNewAdSet}>+ Conjunto de anúncios</Button>
          </div>
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
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-ink">{money(adSet.spend, currency)}</p>
                      {!adSet.deletedAt ? (
                        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onToggleAdSetStatus(adSet)}>
                          {adSet.status === "ACTIVE" ? "Pausar" : "Ativar"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1.5 border-t border-border pt-2">
                    {ads.filter((ad) => ad.adSetId === adSet.id).map((ad) => (
                      <div key={ad.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-ink-muted">{ad.name}</span>
                          <StatusBadge status={statusOf(ad.status)} />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-ink-muted">{money(ad.spend, currency)} · {ad.impressions ?? 0} impr.</span>
                          {!ad.deletedAt ? (
                            <Button variant="secondary" className="px-2 py-0.5 text-xs" onClick={() => onToggleAdStatus(ad)}>
                              {ad.status === "ACTIVE" ? "Pausar" : "Ativar"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {ads.filter((ad) => ad.adSetId === adSet.id).length === 0 ? <p className="text-xs text-ink-muted">Nenhum anúncio neste conjunto.</p> : null}
                    <div className="flex justify-end pt-1">
                      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={!!adSet.deletedAt} onClick={() => onNewAd(adSet)}>+ Anúncio</Button>
                    </div>
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

function NewCampaignModal({ workspaceId, adAccountId, onClose, onCreated }: { workspaceId: string; adAccountId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState(OBJECTIVES[1]!.value);
  const [dailyBudget, setDailyBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Dê um nome pra campanha.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await createMetaAdCampaign(workspaceId, {
        adAccountId,
        name: name.trim(),
        objective,
        ...(dailyBudget ? { dailyBudget: Number(dailyBudget) } : {}),
      });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a campanha.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nova campanha" onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-xs text-ink-muted">A campanha nasce pausada — revise tudo no Ads Manager antes de ativar.</p>
        <div>
          <Label htmlFor="campaign-name">Nome</Label>
          <Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Black Friday — Tráfego" autoFocus />
        </div>
        <div>
          <Label htmlFor="campaign-objective">Objetivo</Label>
          <select id="campaign-objective" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={objective} onChange={(event) => setObjective(event.target.value)}>
            {OBJECTIVES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="campaign-budget">Orçamento diário (opcional)</Label>
          <Input id="campaign-budget" type="number" min={0} step="0.01" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} placeholder="Ex.: 50" />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar campanha"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function NewAdSetModal({ workspaceId, campaign, onClose, onCreated }: { workspaceId: string; campaign: MetaAdCampaign; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [optimizationGoal, setOptimizationGoal] = useState(OPTIMIZATION_GOALS[0]!.value);
  const [billingEvent, setBillingEvent] = useState(BILLING_EVENTS[0]!.value);
  const [dailyBudget, setDailyBudget] = useState("");
  const [geoCountries, setGeoCountries] = useState("BR");
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    const countries = geoCountries.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
    if (!name.trim()) {
      setError("Dê um nome pro conjunto de anúncios.");
      return;
    }
    if (countries.length === 0) {
      setError("Informe pelo menos um país (ex.: BR).");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await createMetaAdSet(workspaceId, {
        campaignId: campaign.id,
        name: name.trim(),
        optimizationGoal,
        billingEvent,
        ...(dailyBudget ? { dailyBudget: Number(dailyBudget) } : {}),
        targeting: {
          geoCountries: countries,
          ...(ageMin ? { ageMin: Number(ageMin) } : {}),
          ...(ageMax ? { ageMax: Number(ageMax) } : {}),
        },
      });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o conjunto de anúncios.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Novo conjunto de anúncios em "${campaign.name}"`} onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-xs text-ink-muted">Nasce pausado, na mesma conta de anúncio da campanha.</p>
        <div>
          <Label htmlFor="adset-name">Nome</Label>
          <Input id="adset-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Público frio — SP/RJ" autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="adset-optimization">Otimização</Label>
            <select id="adset-optimization" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={optimizationGoal} onChange={(event) => setOptimizationGoal(event.target.value)}>
              {OPTIMIZATION_GOALS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="adset-billing">Cobrança por</Label>
            <select id="adset-billing" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={billingEvent} onChange={(event) => setBillingEvent(event.target.value)}>
              {BILLING_EVENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="adset-budget">Orçamento diário (opcional)</Label>
          <Input id="adset-budget" type="number" min={0} step="0.01" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} placeholder="Ex.: 30" />
        </div>
        <div>
          <Label htmlFor="adset-countries">Países (código de 2 letras, separados por vírgula)</Label>
          <Input id="adset-countries" value={geoCountries} onChange={(event) => setGeoCountries(event.target.value)} placeholder="BR" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="adset-age-min">Idade mínima</Label>
            <Input id="adset-age-min" type="number" min={13} max={65} value={ageMin} onChange={(event) => setAgeMin(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="adset-age-max">Idade máxima</Label>
            <Input id="adset-age-max" type="number" min={13} max={65} value={ageMax} onChange={(event) => setAgeMax(event.target.value)} />
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar conjunto de anúncios"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function NewAdModal({ workspaceId, adSet, onClose, onCreated }: { workspaceId: string; adSet: MetaAdSet; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState("");
  const [link, setLink] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [callToActionType, setCallToActionType] = useState(CALL_TO_ACTIONS[0]!.value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    if (!name.trim() || !pageId.trim() || !link.trim()) {
      setError("Preencha nome, página e link.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await createMetaAd(workspaceId, {
        adSetId: adSet.id,
        name: name.trim(),
        pageId: pageId.trim(),
        creative: {
          link: link.trim(),
          ...(headline ? { headline } : {}),
          ...(description ? { description } : {}),
          ...(imageUrl ? { imageUrl } : {}),
          callToActionType,
        },
      });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o anúncio.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Novo anúncio em "${adSet.name}"`} onClose={onClose} maxWidthClass="sm:max-w-lg">
      <div className="grid gap-4">
        <p className="text-xs text-ink-muted">
          Anúncio de link — nasce pausado, referenciando uma imagem já publicada em algum lugar (URL), sem upload de mídia nesta primeira versão.
        </p>
        <div>
          <Label htmlFor="ad-name">Nome</Label>
          <Input id="ad-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Criativo A — carrossel" autoFocus />
        </div>
        <div>
          <Label htmlFor="ad-page">ID da Página do Facebook</Label>
          <Input id="ad-page" value={pageId} onChange={(event) => setPageId(event.target.value)} placeholder="Ex.: 123456789012345" />
        </div>
        <div>
          <Label htmlFor="ad-link">Link de destino</Label>
          <Input id="ad-link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" />
        </div>
        <div>
          <Label htmlFor="ad-headline">Título (opcional)</Label>
          <Input id="ad-headline" value={headline} onChange={(event) => setHeadline(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="ad-description">Descrição (opcional)</Label>
          <Textarea id="ad-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="ad-image">URL da imagem (opcional)</Label>
          <Input id="ad-image" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://" />
        </div>
        <div>
          <Label htmlFor="ad-cta">Botão de ação</Label>
          <select id="ad-cta" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={callToActionType} onChange={(event) => setCallToActionType(event.target.value)}>
            {CALL_TO_ACTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar anúncio"}</Button>
        </div>
      </div>
    </Modal>
  );
}
