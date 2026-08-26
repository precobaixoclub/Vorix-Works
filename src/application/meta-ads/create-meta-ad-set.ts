import type { MetaAdCampaign } from "../ports/meta-ad-campaign-repository.port.js";
import type { MetaAdSetRepositoryPort } from "../ports/meta-ad-set-repository.port.js";
import type { MetaAdAccountRepositoryPort } from "../ports/meta-ad-account-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Criação de ad set — Fase 3. `status` sempre `"PAUSED"`, mesma regra inegociável de
 * `create-meta-ad-campaign.ts`.
 *
 * DEFESA ESTRUTURAL contra a correção #7 do pacote de referência analisado
 * (bittencourtthulio/meta-graph-api-integration): "o ad set de uma campanha aponta pra uma conta
 * de anúncio diferente da campanha, e o erro da Meta não nomeia nenhum dos dois lados" — aqui a
 * conta de anúncio do ad set NUNCA é um parâmetro de entrada independente. `campaign.adAccountId`
 * (o FK interno de `meta_ad_campaigns` pra `meta_ad_accounts`, o mesmo valor gravado por
 * `sync-meta-ad-campaigns.ts`) é resolvido pra uma `MetaAdAccount` real dentro desta função — o
 * `act_XXXX` usado na chamada à Marketing API e o `credentialReferenceId` usado pra resolver o
 * token vêm os dois dessa MESMA conta resolvida. Não existe caminho pelo qual o caller consiga
 * passar uma conta diferente da campanha.
 */

export type CreateMetaAdSetInput = {
  tenantId: string;
  workspaceId: string;
  campaign: MetaAdCampaign;
  name: string;
  optimizationGoal: string;
  billingEvent: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
  /** Segmentação simplificada — países + faixa etária + gêneros, o suficiente pra um primeiro
   * ad set real. Segmentação avançada (interesses, públicos customizados) fica pra quando a UI de
   * builder amadurecer; o campo `targeting` aceita a estrutura completa da Marketing API quando
   * fornecida diretamente. */
  targeting: { geoCountries: readonly string[]; ageMin?: number; ageMax?: number; genders?: readonly number[] } | Record<string, unknown>;
};

export type CreateMetaAdSetDeps = {
  adSetRepository: MetaAdSetRepositoryPort;
  adAccountRepository: MetaAdAccountRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

type SimpleTargeting = { geoCountries: readonly string[]; ageMin?: number; ageMax?: number; genders?: readonly number[] };

function isSimpleTargeting(input: CreateMetaAdSetInput["targeting"]): input is SimpleTargeting {
  return "geoCountries" in input && Array.isArray((input as SimpleTargeting).geoCountries);
}

function buildTargeting(input: CreateMetaAdSetInput["targeting"]): Record<string, unknown> {
  if (isSimpleTargeting(input)) {
    return {
      geo_locations: { countries: [...input.geoCountries] },
      ...(input.ageMin ? { age_min: input.ageMin } : {}),
      ...(input.ageMax ? { age_max: input.ageMax } : {}),
      ...(input.genders && input.genders.length > 0 ? { genders: [...input.genders] } : {}),
    };
  }
  return input;
}

export async function createMetaAdSet(deps: CreateMetaAdSetDeps, input: CreateMetaAdSetInput) {
  if (input.campaign.deletedAt) throw new Error("META_ADS_CAMPAIGN_DELETED: esta campanha foi removida na Meta — não é possível criar um conjunto de anúncios nela.");

  const adAccount = await deps.adAccountRepository.getById(input.campaign.adAccountId);
  if (!adAccount || adAccount.tenantId !== input.tenantId || adAccount.workspaceId !== input.workspaceId) {
    throw new Error("META_ADS_ACCOUNT_NOT_FOUND: conta de anúncio da campanha não encontrada para este workspace.");
  }

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: adAccount.credentialReferenceId });
  const targeting = buildTargeting(input.targeting);

  const response = await metaGraphRequest<{ id: string }>(`/${toActAccountId(adAccount.accountId)}/adsets`, {
    method: "POST",
    accessToken,
    fetchImpl: deps.fetchImpl,
    params: {
      name: input.name,
      campaign_id: input.campaign.campaignId,
      status: "PAUSED",
      optimization_goal: input.optimizationGoal,
      billing_event: input.billingEvent,
      targeting,
      ...(input.dailyBudget ? { daily_budget: Math.round(input.dailyBudget * 100) } : {}),
      ...(input.lifetimeBudget ? { lifetime_budget: Math.round(input.lifetimeBudget * 100) } : {}),
      ...(input.bidAmount ? { bid_amount: Math.round(input.bidAmount * 100) } : {}),
    },
  });

  return deps.adSetRepository.upsertAdSet({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    campaignId: input.campaign.id,
    adAccountId: input.campaign.adAccountId,
    adSetId: response.id,
    name: input.name,
    status: "PAUSED",
    effectiveStatus: "PAUSED",
    optimizationGoal: input.optimizationGoal,
    billingEvent: input.billingEvent,
    bidAmount: input.bidAmount,
    dailyBudget: input.dailyBudget,
    lifetimeBudget: input.lifetimeBudget,
    targeting,
  });
}
