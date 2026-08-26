import type { MetaAdAccountRepositoryPort } from "../ports/meta-ad-account-repository.port.js";
import type { MetaCustomAudience, MetaCustomAudienceRepositoryPort } from "../ports/meta-custom-audience-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Criação de público semelhante (lookalike) a partir de um público de origem — Fase 4.
 *
 * A conta de anúncio NUNCA é um parâmetro de entrada independente — é sempre a MESMA conta do
 * público de origem (`originAudience.adAccountId`, resolvida aqui dentro), mesma defesa
 * estrutural das entidades de Fase 3 contra a correção #7 do pacote de referência analisado.
 * A Marketing API permite lookalike entre contas diferentes (mesmo Business Manager) — não
 * suportado aqui neste primeiro corte, é sempre a mesma conta.
 */

export type CreateMetaLookalikeAudienceInput = {
  tenantId: string;
  workspaceId: string;
  originAudience: MetaCustomAudience;
  name: string;
  /** 0.01 a 0.20 (1% a 20% da população do país-alvo) — faixa exigida pela Marketing API. */
  ratio: number;
  /** Código de país ISO 3166-1 alpha-2 (ex.: "BR"). */
  country: string;
};

export type CreateMetaLookalikeAudienceDeps = {
  audienceRepository: MetaCustomAudienceRepositoryPort;
  adAccountRepository: MetaAdAccountRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export async function createMetaLookalikeAudience(deps: CreateMetaLookalikeAudienceDeps, input: CreateMetaLookalikeAudienceInput) {
  if (input.originAudience.deletedAt) {
    throw new Error("META_ADS_AUDIENCE_DELETED: o público de origem foi removido na Meta — não é possível criar um semelhante a partir dele.");
  }
  if (input.ratio < 0.01 || input.ratio > 0.2) {
    throw new Error("META_ADS_LOOKALIKE_RATIO_INVALID: a proporção precisa estar entre 1% (0.01) e 20% (0.2).");
  }

  const adAccount = await deps.adAccountRepository.getById(input.originAudience.adAccountId);
  if (!adAccount || adAccount.tenantId !== input.tenantId || adAccount.workspaceId !== input.workspaceId) {
    throw new Error("META_ADS_ACCOUNT_NOT_FOUND: conta de anúncio do público de origem não encontrada para este workspace.");
  }

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: adAccount.credentialReferenceId });

  const created = await metaGraphRequest<{ id: string }>(`/${toActAccountId(adAccount.accountId)}/customaudiences`, {
    method: "POST",
    accessToken,
    fetchImpl: deps.fetchImpl,
    params: {
      name: input.name,
      subtype: "LOOKALIKE",
      origin_audience_id: input.originAudience.audienceId,
      lookalike_spec: { ratio: input.ratio, country: input.country },
    },
  });

  return deps.audienceRepository.upsertAudience({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    adAccountId: adAccount.id,
    audienceId: created.id,
    name: input.name,
    subtype: "LOOKALIKE",
    lookalikeOriginAudienceId: input.originAudience.id,
    lookalikeRatio: input.ratio,
    lookalikeCountry: input.country,
  });
}
