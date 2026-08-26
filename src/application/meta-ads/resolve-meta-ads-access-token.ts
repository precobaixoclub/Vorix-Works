import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";

/** Resolve o access token ativo de uma credencial de Ads — usado por toda função de escrita do
 * módulo (sync, criação, edição). Lança `META_ADS_CREDENTIAL_NOT_ACTIVE`/`META_ADS_TOKEN_MISSING`
 * (prefixo `CODE:` — cada caller/rota decide o status HTTP e a mensagem amigável a partir do
 * prefixo, nunca precisa saber COMO o token é resolvido). */
export function secretReference(tenantId: string, workspaceId: string, credentialReferenceId: string): string {
  return `meta-ads:${tenantId}:${workspaceId}:${credentialReferenceId}`;
}

export async function resolveMetaAdsAccessToken(
  deps: { credentialRepository: MetaAdsCredentialRepositoryPort; secretManager: SecretManagerPort },
  input: { tenantId: string; workspaceId: string; credentialReferenceId: string },
): Promise<string> {
  const reference = await deps.credentialRepository.getCredentialReference(input.credentialReferenceId);
  if (!reference || reference.tenantId !== input.tenantId || reference.workspaceId !== input.workspaceId || reference.status !== "active") {
    throw new Error("META_ADS_CREDENTIAL_NOT_ACTIVE: esta conexão não está ativa — reconecte antes de criar ou editar.");
  }
  const secret = await deps.secretManager.get(secretReference(input.tenantId, input.workspaceId, input.credentialReferenceId));
  const accessToken = secret?.value.accessToken;
  if (!accessToken) throw new Error("META_ADS_TOKEN_MISSING: token não encontrado para esta conexão — reconecte.");
  return accessToken;
}
