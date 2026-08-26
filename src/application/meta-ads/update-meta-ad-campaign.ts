import type { MetaAdCampaign, MetaAdCampaignRepositoryPort } from "../ports/meta-ad-campaign-repository.port.js";
import type { MetaAdAccountRepositoryPort } from "../ports/meta-ad-account-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Atualização de campanha — Fase 3. `status` só aceita `"ACTIVE"`/`"PAUSED"` aqui — ativar uma
 * campanha é sempre uma AÇÃO EXPLÍCITA e isolada (nunca junto de uma edição de nome/orçamento na
 * mesma chamada), pra nunca reativar uma campanha por acidente ao só renomear ela.
 *
 * `credentialReferenceId` NUNCA é um parâmetro de entrada (mesma defesa de `create-meta-ad-set.ts`
 * contra a correção #7 do pacote de referência) — é resolvido aqui a partir de
 * `existing.adAccountId`, a conta de anúncio REAL da campanha sendo editada.
 */

export type UpdateMetaAdCampaignInput = {
  tenantId: string;
  workspaceId: string;
  /** id INTERNO (`meta_ad_campaigns.id`), nunca o campaignId externo da Meta. */
  id: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  dailyBudget?: number;
  lifetimeBudget?: number;
};

export type UpdateMetaAdCampaignDeps = {
  campaignRepository: MetaAdCampaignRepositoryPort;
  adAccountRepository: MetaAdAccountRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export async function updateMetaAdCampaign(deps: UpdateMetaAdCampaignDeps, input: UpdateMetaAdCampaignInput): Promise<MetaAdCampaign> {
  const existing = await deps.campaignRepository.getById(input.id);
  if (!existing || existing.tenantId !== input.tenantId || existing.workspaceId !== input.workspaceId) {
    throw new Error("META_ADS_CAMPAIGN_NOT_FOUND: campanha não encontrada para este workspace.");
  }

  const adAccount = await deps.adAccountRepository.getById(existing.adAccountId);
  if (!adAccount) {
    throw new Error("META_ADS_ACCOUNT_NOT_FOUND: conta de anúncio da campanha não encontrada para este workspace.");
  }

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: adAccount.credentialReferenceId });

  const params: Record<string, unknown> = {};
  if (input.name !== undefined) params.name = input.name;
  if (input.status !== undefined) params.status = input.status;
  if (input.dailyBudget !== undefined) params.daily_budget = Math.round(input.dailyBudget * 100);
  if (input.lifetimeBudget !== undefined) params.lifetime_budget = Math.round(input.lifetimeBudget * 100);

  if (Object.keys(params).length === 0) return existing;

  await metaGraphRequest(`/${existing.campaignId}`, { method: "POST", accessToken, params, fetchImpl: deps.fetchImpl });

  return deps.campaignRepository.upsertCampaign({
    tenantId: existing.tenantId,
    workspaceId: existing.workspaceId,
    adAccountId: existing.adAccountId,
    campaignId: existing.campaignId,
    name: input.name ?? existing.name,
    objective: existing.objective,
    status: input.status ?? existing.status,
    effectiveStatus: input.status ?? existing.effectiveStatus,
    buyingType: existing.buyingType,
    specialAdCategories: existing.specialAdCategories,
    dailyBudget: input.dailyBudget ?? existing.dailyBudget,
    lifetimeBudget: input.lifetimeBudget ?? existing.lifetimeBudget,
    budgetRemaining: existing.budgetRemaining,
    spend: existing.spend,
    impressions: existing.impressions,
    clicks: existing.clicks,
    reach: existing.reach,
    insights: existing.insights,
    startTime: existing.startTime,
    stopTime: existing.stopTime,
    metaCreatedTime: existing.metaCreatedTime,
  });
}
