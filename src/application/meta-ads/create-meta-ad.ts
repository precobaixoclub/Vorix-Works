import type { MetaAdSet } from "../ports/meta-ad-set-repository.port.js";
import type { MetaAdRepositoryPort } from "../ports/meta-ad-repository.port.js";
import type { MetaAdAccountRepositoryPort } from "../ports/meta-ad-account-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Criação de anúncio (nível folha) — Fase 3. `status` sempre `"PAUSED"`, mesma regra das duas
 * entidades pai.
 *
 * Suporta só o caminho realista mais simples pra este primeiro corte: um criativo do tipo LINK AD
 * (`object_story_spec.link_data`), referenciando uma imagem já publicada via URL (`picture`) — não
 * upload de mídia nem criativos de carrossel/vídeo, que ficam pra quando o builder amadurecer. A
 * conta de anúncio, como em `create-meta-ad-set.ts`, nunca é um parâmetro independente — `adSet.adAccountId`
 * (FK interno) é resolvido pra uma `MetaAdAccount` real aqui dentro, e é dessa MESMA conta que
 * vêm o `act_XXXX` da chamada e o `credentialReferenceId` do token.
 */

export type CreateMetaAdInput = {
  tenantId: string;
  workspaceId: string;
  adSet: MetaAdSet;
  name: string;
  /** Página do Facebook em nome de quem o anúncio fala — escolha explícita do usuário, não deriva
   * de nenhuma entidade pai (ad set/campanha não carregam essa informação). */
  pageId: string;
  creative: {
    link: string;
    message?: string;
    headline?: string;
    description?: string;
    /** URL de uma imagem já hospedada — sem upload de mídia nesta primeira versão. */
    imageUrl?: string;
    callToActionType?: string;
  };
};

export type CreateMetaAdDeps = {
  adRepository: MetaAdRepositoryPort;
  adAccountRepository: MetaAdAccountRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export async function createMetaAd(deps: CreateMetaAdDeps, input: CreateMetaAdInput) {
  if (input.adSet.deletedAt) throw new Error("META_ADS_ADSET_DELETED: este conjunto de anúncios foi removido na Meta — não é possível criar um anúncio nele.");

  const adAccount = await deps.adAccountRepository.getById(input.adSet.adAccountId);
  if (!adAccount || adAccount.tenantId !== input.tenantId || adAccount.workspaceId !== input.workspaceId) {
    throw new Error("META_ADS_ACCOUNT_NOT_FOUND: conta de anúncio do conjunto de anúncios não encontrada para este workspace.");
  }

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: adAccount.credentialReferenceId });

  const linkData: Record<string, unknown> = {
    link: input.creative.link,
    ...(input.creative.message ? { message: input.creative.message } : {}),
    ...(input.creative.headline ? { name: input.creative.headline } : {}),
    ...(input.creative.description ? { description: input.creative.description } : {}),
    ...(input.creative.imageUrl ? { picture: input.creative.imageUrl } : {}),
    ...(input.creative.callToActionType
      ? { call_to_action: { type: input.creative.callToActionType, value: { link: input.creative.link } } }
      : {}),
  };

  const objectStorySpec = { page_id: input.pageId, link_data: linkData };

  const response = await metaGraphRequest<{ id: string }>(`/${toActAccountId(adAccount.accountId)}/ads`, {
    method: "POST",
    accessToken,
    fetchImpl: deps.fetchImpl,
    params: {
      name: input.name,
      adset_id: input.adSet.adSetId,
      status: "PAUSED",
      creative: { object_story_spec: objectStorySpec },
    },
  });

  return deps.adRepository.upsertAd({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    adSetId: input.adSet.id,
    campaignId: input.adSet.campaignId,
    adAccountId: input.adSet.adAccountId,
    adId: response.id,
    name: input.name,
    status: "PAUSED",
    effectiveStatus: "PAUSED",
    creative: objectStorySpec,
  });
}
