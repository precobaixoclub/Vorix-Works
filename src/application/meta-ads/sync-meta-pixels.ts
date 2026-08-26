import type { MetaAdAccount } from "../ports/meta-ad-account-repository.port.js";
import type { MetaPixelRepositoryPort } from "../ports/meta-pixel-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/** Sync de pixels — módulo Meta Ads Manager, Fase 4. Simplificação conhecida: nunca marca um pixel
 * como inativo se ele sumir da listagem (diferente do sync de campanhas/adsets/ads) — pixel
 * removido é raro o bastante, e a consequência de errar (`is_active` desatualizado) é branda
 * (não bloqueia nada, só o rótulo na UI fica desatualizado até o próximo sync). Revisitar se isso
 * virar um problema real. */

type GraphPixel = { id: string; name: string; last_fired_time?: string };

export type SyncMetaPixelsDeps = {
  pixelRepository: MetaPixelRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export type SyncMetaPixelsResult = { pixelsSynced: number };

export async function syncMetaPixelsForAccount(deps: SyncMetaPixelsDeps, input: { tenantId: string; workspaceId: string; adAccount: MetaAdAccount }): Promise<SyncMetaPixelsResult> {
  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: input.adAccount.credentialReferenceId });

  const response = await metaGraphRequest<{ data?: GraphPixel[] }>(`/${toActAccountId(input.adAccount.accountId)}/adspixels`, {
    accessToken,
    params: { fields: "id,name,last_fired_time", limit: 200 },
    fetchImpl: deps.fetchImpl,
    timeoutMs: 60_000,
  });

  let pixelsSynced = 0;
  for (const pixel of response.data ?? []) {
    await deps.pixelRepository.upsertPixel({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      adAccountId: input.adAccount.id,
      pixelId: pixel.id,
      name: pixel.name,
      lastFiredTime: pixel.last_fired_time,
      isActive: true,
    });
    pixelsSynced++;
  }

  return { pixelsSynced };
}
