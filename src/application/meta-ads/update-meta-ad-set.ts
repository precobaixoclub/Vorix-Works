import type { MetaAdSet, MetaAdSetRepositoryPort } from "../ports/meta-ad-set-repository.port.js";
import type { MetaAdAccountRepositoryPort } from "../ports/meta-ad-account-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/** `credentialReferenceId` NUNCA é um parâmetro de entrada — resolvido aqui a partir de
 * `existing.adAccountId`, mesma defesa de `create-meta-ad-set.ts`. */

export type UpdateMetaAdSetInput = {
  tenantId: string;
  workspaceId: string;
  id: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
};

export type UpdateMetaAdSetDeps = {
  adSetRepository: MetaAdSetRepositoryPort;
  adAccountRepository: MetaAdAccountRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export async function updateMetaAdSet(deps: UpdateMetaAdSetDeps, input: UpdateMetaAdSetInput): Promise<MetaAdSet> {
  const existing = await deps.adSetRepository.getById(input.id);
  if (!existing || existing.tenantId !== input.tenantId || existing.workspaceId !== input.workspaceId) {
    throw new Error("META_ADS_ADSET_NOT_FOUND: conjunto de anúncios não encontrado para este workspace.");
  }

  const adAccount = await deps.adAccountRepository.getById(existing.adAccountId);
  if (!adAccount) {
    throw new Error("META_ADS_ACCOUNT_NOT_FOUND: conta de anúncio do conjunto de anúncios não encontrada para este workspace.");
  }

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: adAccount.credentialReferenceId });

  const params: Record<string, unknown> = {};
  if (input.name !== undefined) params.name = input.name;
  if (input.status !== undefined) params.status = input.status;
  if (input.dailyBudget !== undefined) params.daily_budget = Math.round(input.dailyBudget * 100);
  if (input.lifetimeBudget !== undefined) params.lifetime_budget = Math.round(input.lifetimeBudget * 100);
  if (input.bidAmount !== undefined) params.bid_amount = Math.round(input.bidAmount * 100);

  if (Object.keys(params).length === 0) return existing;

  await metaGraphRequest(`/${existing.adSetId}`, { method: "POST", accessToken, params, fetchImpl: deps.fetchImpl });

  return deps.adSetRepository.upsertAdSet({
    ...existing,
    name: input.name ?? existing.name,
    status: input.status ?? existing.status,
    effectiveStatus: input.status ?? existing.effectiveStatus,
    dailyBudget: input.dailyBudget ?? existing.dailyBudget,
    lifetimeBudget: input.lifetimeBudget ?? existing.lifetimeBudget,
    bidAmount: input.bidAmount ?? existing.bidAmount,
  });
}
