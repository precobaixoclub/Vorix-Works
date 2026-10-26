import type { PublicationSecretResolverPort } from "../publication/publication-secret-resolver.js";
import type { SocialAccount, SocialProviderType } from "../../domain/social/social-publishing.model.js";
import { activeConnection } from "./social-provider-resolver.js";
import type { SocialProviderSession } from "./social-publishing-provider.port.js";

/**
 * Entrega ao provider a credencial da conexão ativa, sempre pelo cofre central (credenciais OAuth
 * governadas, cifradas). A conta guarda só a referência; o segredo nunca vai ao frontend nem a log.
 */
export class SocialSessionVault {
  constructor(private readonly secrets: PublicationSecretResolverPort) {}

  /** `undefined` = sem credencial utilizável (precisa reconectar). */
  async load(account: SocialAccount, providerType: SocialProviderType): Promise<SocialProviderSession | undefined> {
    const connection = activeConnection(account, providerType);
    if (!connection) return undefined;
    // A credencial é sempre lida no escopo do tenant/workspace da própria conta: uma conta nunca
    // resolve credencial de outro tenant, mesmo que a referência seja adulterada.
    const secret = await this.secrets.resolve({ tenantId: account.tenantId, workspaceId: account.workspaceId, providerId: account.network, credentialReferenceId: connection.credentialReferenceId });
    if (!secret || secret.credentialReferenceId !== connection.credentialReferenceId) return undefined;
    return { value: { ...secret.value, credentialReferenceId: secret.credentialReferenceId } };
  }
}
