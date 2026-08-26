import type { MetaAdAccount } from "../ports/meta-ad-account-repository.port.js";
import type { MetaAdCampaignRepositoryPort } from "../ports/meta-ad-campaign-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Criação de campanha — Fase 3 do módulo Meta Ads Manager.
 *
 * REGRA INEGOCIÁVEL desta fase (`meta-implement`/`meta-graph-api` do pacote de referência
 * analisado, e reforçada nesta sessão): toda entidade criada nasce **PAUSADA**. `status` nunca é
 * um parâmetro de entrada desta função — é sempre `"PAUSED"`, hardcoded. Ativar uma campanha é uma
 * ação SEPARADA e explícita (`update-meta-ad-campaign.ts`), nunca um efeito colateral da criação.
 * Uma campanha criada já ativa gasta orçamento real sem o usuário ter revisado nada na tela.
 */

export type CreateMetaAdCampaignInput = {
  tenantId: string;
  workspaceId: string;
  adAccount: MetaAdAccount;
  name: string;
  objective: string;
  specialAdCategories?: readonly string[];
  dailyBudget?: number;
  lifetimeBudget?: number;
  buyingType?: string;
};

export type CreateMetaAdCampaignDeps = {
  campaignRepository: MetaAdCampaignRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export async function createMetaAdCampaign(deps: CreateMetaAdCampaignDeps, input: CreateMetaAdCampaignInput) {
  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: input.adAccount.credentialReferenceId });

  const response = await metaGraphRequest<{ id: string }>(`/${toActAccountId(input.adAccount.accountId)}/campaigns`, {
    method: "POST",
    accessToken,
    fetchImpl: deps.fetchImpl,
    params: {
      name: input.name,
      objective: input.objective,
      status: "PAUSED",
      special_ad_categories: input.specialAdCategories && input.specialAdCategories.length > 0 ? input.specialAdCategories : [],
      ...(input.dailyBudget ? { daily_budget: Math.round(input.dailyBudget * 100) } : {}),
      ...(input.lifetimeBudget ? { lifetime_budget: Math.round(input.lifetimeBudget * 100) } : {}),
      ...(input.buyingType ? { buying_type: input.buyingType } : {}),
    },
  });

  return deps.campaignRepository.upsertCampaign({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    adAccountId: input.adAccount.id,
    campaignId: response.id,
    name: input.name,
    objective: input.objective,
    status: "PAUSED",
    effectiveStatus: "PAUSED",
    buyingType: input.buyingType,
    specialAdCategories: input.specialAdCategories,
    dailyBudget: input.dailyBudget,
    lifetimeBudget: input.lifetimeBudget,
  });
}
