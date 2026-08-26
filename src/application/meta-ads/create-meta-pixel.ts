import type { MetaAdAccount } from "../ports/meta-ad-account-repository.port.js";
import type { MetaPixelRepositoryPort } from "../ports/meta-pixel-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

export type CreateMetaPixelInput = {
  tenantId: string;
  workspaceId: string;
  adAccount: MetaAdAccount;
  name: string;
};

export type CreateMetaPixelDeps = {
  pixelRepository: MetaPixelRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export async function createMetaPixel(deps: CreateMetaPixelDeps, input: CreateMetaPixelInput) {
  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: input.adAccount.credentialReferenceId });

  const created = await metaGraphRequest<{ id: string }>(`/${toActAccountId(input.adAccount.accountId)}/adspixels`, {
    method: "POST",
    accessToken,
    fetchImpl: deps.fetchImpl,
    params: { name: input.name },
  });

  return deps.pixelRepository.upsertPixel({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    adAccountId: input.adAccount.id,
    pixelId: created.id,
    name: input.name,
    isActive: true,
  });
}
