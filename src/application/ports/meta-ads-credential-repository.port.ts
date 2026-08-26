/**
 * Referências de credencial do módulo Meta Ads Manager — Fase 1.
 *
 * DELIBERADAMENTE um port próprio, nunca uma extensão de `PublicationRepositoryPort`/
 * `PublicationCredentialReference` (`src/domain/publication/publication.model.ts`): aquele tipo
 * amarra `providerId` ao union fechado `PublicationProvider` (só canais de CONTEÚDO — instagram,
 * facebook, tiktok...), consumido em todo o pipeline de despacho de publicação
 * (`PublicationProviderRegistry`, `PublicationDispatchService`). Uma conta de anúncios não é um
 * canal de publicação; adicionar "meta_ads"/"instagram_dm" àquele union arriscaria vazar um
 * conceito de Ads para dentro de lógica que só sabe lidar com posts. Este port escreve na MESMA
 * tabela física `publication_credential_references` (ela já é um armazém genérico, sem FK/CHECK
 * amarrando `provider_id` a nenhum vocabulário — ver migration 0043/0069), só que com um tipo
 * próprio, isolado.
 *
 * O VALOR do token nunca vive aqui — vive cifrado em `operational_secrets`, via o mesmo
 * `SecretManagerPort` genérico já usado por `MetaInstagramOAuthService`/provedores de IA
 * (referência de secret no padrão `meta-ads:<tenantId>:<workspaceId>:<providerSubjectId>`).
 */

export const META_ADS_CREDENTIAL_PROVIDERS = ["meta_ads"] as const;
export type MetaAdsCredentialProvider = (typeof META_ADS_CREDENTIAL_PROVIDERS)[number];

export const META_ADS_CREDENTIAL_STATUSES = ["active", "disabled", "revoked"] as const;
export type MetaAdsCredentialStatus = (typeof META_ADS_CREDENTIAL_STATUSES)[number];

export type MetaAdsCredentialReference = {
  credentialReferenceId: string;
  tenantId: string;
  workspaceId: string;
  providerId: MetaAdsCredentialProvider;
  status: MetaAdsCredentialStatus;
  environment?: "sandbox" | "production";
  /** id do usuário Meta dono do token (`/me` do Graph) — nunca o token em si. */
  providerSubjectId?: string;
  scopes?: readonly string[];
  expiresAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateMetaAdsCredentialReferenceInput = Omit<MetaAdsCredentialReference, "createdAt" | "updatedAt">;

export type MetaAdsCredentialRepositoryPort = {
  /** Upsert por `credentialReferenceId` — reconectar a mesma conta nunca cria uma segunda linha. */
  upsertCredentialReference(input: CreateMetaAdsCredentialReferenceInput): Promise<MetaAdsCredentialReference>;
  getCredentialReference(credentialReferenceId: string): Promise<MetaAdsCredentialReference | undefined>;
  listCredentialReferencesByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MetaAdsCredentialReference[]>;
  updateStatus(credentialReferenceId: string, status: MetaAdsCredentialStatus): Promise<void>;
  touchLastRefreshed(credentialReferenceId: string, expiresAt?: string): Promise<void>;
};
