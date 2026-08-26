import type { MetaAdAccount } from "../ports/meta-ad-account-repository.port.js";
import type { MetaCustomAudienceRepositoryPort } from "../ports/meta-custom-audience-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Sync de públicos customizados/semelhantes — módulo Meta Ads Manager, Fase 4.
 *
 * `approximate_count` foi descontinuado pela Marketing API em favor de
 * `approximate_count_lower_bound`/`approximate_count_upper_bound` — guardamos o limite INFERIOR
 * (conservador: nunca superestima o tamanho do público pro usuário).
 *
 * Achado ao ler a doc de `lookalike_spec`: o shape exato devolvido pela API varia entre versões e
 * não há uma referência 100% estável pra extrair `origin_audience_id`/`ratio`/`country` de dentro
 * dele com certeza — este sync tenta os campos mais documentados (`ratio`, `country` direto no
 * objeto) e nunca assume uma estrutura que não conseguiu confirmar; campos que não aparecem ficam
 * `undefined`, nunca um valor adivinhado.
 */

const AUDIENCES_QUERY_FIELDS = "id,name,subtype,description,approximate_count_lower_bound,operation_status,delivery_status,lookalike_spec";

type GraphLookalikeSpec = { ratio?: number; country?: string; origin_audience_id?: string };
type GraphCustomAudience = {
  id: string;
  name: string;
  subtype: string;
  description?: string;
  approximate_count_lower_bound?: number;
  operation_status?: unknown;
  delivery_status?: unknown;
  lookalike_spec?: GraphLookalikeSpec;
};

export type SyncMetaCustomAudiencesDeps = {
  audienceRepository: MetaCustomAudienceRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export type SyncMetaCustomAudiencesResult = { audiencesSynced: number };

export async function syncMetaCustomAudiencesForAccount(
  deps: SyncMetaCustomAudiencesDeps,
  input: { tenantId: string; workspaceId: string; adAccount: MetaAdAccount },
): Promise<SyncMetaCustomAudiencesResult> {
  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: input.adAccount.credentialReferenceId });

  const response = await metaGraphRequest<{ data?: GraphCustomAudience[] }>(`/${toActAccountId(input.adAccount.accountId)}/customaudiences`, {
    accessToken,
    params: { fields: AUDIENCES_QUERY_FIELDS, limit: 200 },
    fetchImpl: deps.fetchImpl,
    timeoutMs: 60_000,
  });

  const keptAudienceIds: string[] = [];
  let audiencesSynced = 0;

  // Resolve `origin_audience_id` (id EXTERNO da Meta) pro id INTERNO desta tabela — só quando o
  // público de origem já foi sincronizado antes; senão fica sem vínculo local (a Meta continua
  // sabendo a origem real, só não temos o FK aqui).
  const existing = await deps.audienceRepository.listByWorkspace({ tenantId: input.tenantId, workspaceId: input.workspaceId, adAccountId: input.adAccount.id, includeDeleted: true });
  const byExternalId = new Map(existing.map((audience) => [audience.audienceId, audience.id]));

  for (const audience of response.data ?? []) {
    const lookalikeOriginExternalId = audience.lookalike_spec?.origin_audience_id;
    await deps.audienceRepository.upsertAudience({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      adAccountId: input.adAccount.id,
      audienceId: audience.id,
      name: audience.name,
      subtype: audience.subtype,
      description: audience.description,
      approximateCount: audience.approximate_count_lower_bound,
      operationStatus: audience.operation_status,
      deliveryStatus: audience.delivery_status,
      lookalikeOriginAudienceId: lookalikeOriginExternalId ? byExternalId.get(lookalikeOriginExternalId) : undefined,
      lookalikeRatio: audience.lookalike_spec?.ratio,
      lookalikeCountry: audience.lookalike_spec?.country,
    });
    keptAudienceIds.push(audience.id);
    audiencesSynced++;
  }

  await deps.audienceRepository.markDeletedMissing({ adAccountId: input.adAccount.id, keepAudienceIds: keptAudienceIds });

  return { audiencesSynced };
}
