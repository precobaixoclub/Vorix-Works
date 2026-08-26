import type { MetaAd, MetaAdRepositoryPort } from "../ports/meta-ad-repository.port.js";
import type { MetaAdAccountRepositoryPort } from "../ports/meta-ad-account-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Atualização de anúncio — Fase 3. Só nome e status são editáveis aqui; trocar o criativo de um
 * anúncio já criado é, na prática, criar um anúncio novo (a Marketing API não permite editar
 * `object_story_spec` de um anúncio existente sem substituir o `creative_id` inteiro) — fora do
 * escopo deste primeiro corte.
 *
 * `credentialReferenceId` NUNCA é um parâmetro de entrada — resolvido aqui a partir de
 * `existing.adAccountId`, mesma defesa de `create-meta-ad.ts`.
 */

export type UpdateMetaAdInput = {
  tenantId: string;
  workspaceId: string;
  id: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED";
};

export type UpdateMetaAdDeps = {
  adRepository: MetaAdRepositoryPort;
  adAccountRepository: MetaAdAccountRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export async function updateMetaAd(deps: UpdateMetaAdDeps, input: UpdateMetaAdInput): Promise<MetaAd> {
  const existing = await deps.adRepository.getById(input.id);
  if (!existing || existing.tenantId !== input.tenantId || existing.workspaceId !== input.workspaceId) {
    throw new Error("META_ADS_AD_NOT_FOUND: anúncio não encontrado para este workspace.");
  }

  const adAccount = await deps.adAccountRepository.getById(existing.adAccountId);
  if (!adAccount) {
    throw new Error("META_ADS_ACCOUNT_NOT_FOUND: conta de anúncio do anúncio não encontrada para este workspace.");
  }

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: adAccount.credentialReferenceId });

  const params: Record<string, unknown> = {};
  if (input.name !== undefined) params.name = input.name;
  if (input.status !== undefined) params.status = input.status;

  if (Object.keys(params).length === 0) return existing;

  await metaGraphRequest(`/${existing.adId}`, { method: "POST", accessToken, params, fetchImpl: deps.fetchImpl });

  return deps.adRepository.upsertAd({
    tenantId: existing.tenantId,
    workspaceId: existing.workspaceId,
    adSetId: existing.adSetId,
    campaignId: existing.campaignId,
    adAccountId: existing.adAccountId,
    adId: existing.adId,
    name: input.name ?? existing.name,
    status: input.status ?? existing.status,
    effectiveStatus: input.status ?? existing.effectiveStatus,
    creative: existing.creative,
    spend: existing.spend,
    impressions: existing.impressions,
    clicks: existing.clicks,
    reach: existing.reach,
    videoCompletionRate: existing.videoCompletionRate,
    negativeFeedback: existing.negativeFeedback,
    insights: existing.insights,
    metaCreatedTime: existing.metaCreatedTime,
  });
}
