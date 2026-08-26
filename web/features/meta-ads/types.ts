/** Módulo Meta Ads Manager — Fase 1 (conexão + descoberta de contas de anúncio).
 * DELIBERADAMENTE separado de `web/features/meta/types.ts` (publicação de conteúdo) — ver
 * `src/application/ports/meta-ads-credential-repository.port.ts` no backend. */

export type MetaAdsCredentialReference = {
  credentialReferenceId: string;
  tenantId: string;
  workspaceId: string;
  providerId: "meta_ads";
  status: "active" | "disabled" | "revoked";
  environment?: "sandbox" | "production";
  providerSubjectId?: string;
  scopes?: readonly string[];
  expiresAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MetaAdsOAuthStatus = {
  connected: boolean;
  configured: boolean;
  credentialReferences: readonly MetaAdsCredentialReference[];
};

export type MetaAdsOAuthBegin = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type MetaAdsConnectedAccount = {
  accountId: string;
  name: string;
  currency: string;
  accountStatus?: number;
  businessName?: string;
};

export type MetaAdsOAuthComplete = {
  credentialReferenceId: string;
  accounts: readonly MetaAdsConnectedAccount[];
};

export type MetaAdAccount = {
  id: string;
  tenantId: string;
  workspaceId: string;
  credentialReferenceId: string;
  accountId: string;
  name: string;
  currency: string;
  accountStatus?: number;
  businessName?: string;
  timezoneName?: string;
  spendCap?: number;
  balance?: number;
  disableReason?: string;
  isActive: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};
