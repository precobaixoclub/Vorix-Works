import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest } from "../../infrastructure/meta/meta-graph-client.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Busca de interesses pra segmentação (`/search?type=adinterest`) — Fase 4. Endpoint de busca
 * GLOBAL da Graph API (não vive sob `/act_<id>/`), por isso não deriva de nenhuma conta — só
 * precisa de um token válido de QUALQUER conexão ativa do workspace. Resultado nunca é persistido
 * localmente: é uma busca ao vivo, usada só pra alimentar o autocomplete do builder de
 * segmentação (`targeting.flexible_spec` em `create-meta-ad-set.ts`).
 */

export type MetaAdInterest = { id: string; name: string; audienceSize?: number; path?: readonly string[] };

export type SearchMetaAdInterestsInput = {
  tenantId: string;
  workspaceId: string;
  credentialReferenceId: string;
  query: string;
};

export type SearchMetaAdInterestsDeps = {
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

type GraphInterest = { id: string; name: string; audience_size_lower_bound?: number; path?: string[] };

export async function searchMetaAdInterests(deps: SearchMetaAdInterestsDeps, input: SearchMetaAdInterestsInput): Promise<MetaAdInterest[]> {
  if (input.query.trim().length < 2) return [];

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: input.credentialReferenceId });

  const response = await metaGraphRequest<{ data?: GraphInterest[] }>("/search", {
    accessToken,
    params: { type: "adinterest", q: input.query.trim(), limit: 25 },
    fetchImpl: deps.fetchImpl,
  });

  return (response.data ?? []).map((interest) => ({
    id: interest.id,
    name: interest.name,
    audienceSize: interest.audience_size_lower_bound,
    path: interest.path,
  }));
}
