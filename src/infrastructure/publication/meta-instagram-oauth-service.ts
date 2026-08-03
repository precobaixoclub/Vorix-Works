import { createHash, randomBytes } from "node:crypto";
import type { CredentialGovernanceActor, CredentialGovernanceService } from "../../application/credential/credential-governance-service.js";
import type { PublicationRepositoryPort } from "../../application/ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../../application/publication/publication-secret-store.js";
import type { AuditContext } from "../../domain/credential/credential.model.js";
import type { PublicationCredentialReference, PublicationProvider } from "../../domain/publication/publication.model.js";

/**
 * OAuth 2.0 (Facebook Login, com PKCE) para publicação real no Instagram/Facebook. Cada cliente
 * (tenant + workspace) conecta a própria conta e o fluxo resolve TODAS as Páginas do Facebook do
 * usuário — para cada uma, registra uma credencial `facebook` (posts na Página) e, quando a Página
 * tem uma conta profissional do Instagram vinculada, também uma credencial `instagram` (posts no
 * feed/reels), ambas usando o mesmo Page Access Token. O token cru nunca sai daqui — fica no
 * `PublicationSecretStoragePort` (cifrado) e é lido apenas pelo provider de publicação.
 */
export type MetaInstagramOAuthConfig = {
  enabled: boolean;
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  graphBaseUrl?: string;
  scopes: readonly string[];
};

export type MetaInstagramOAuthState = {
  state: string;
  tenantId: string;
  workspaceId: string;
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
};

export type MetaInstagramOAuthTelemetry = {
  oauthSuccess: number;
  oauthFailure: number;
  tokenRefreshSuccess: number;
  tokenRefreshFailure: number;
  lastFailureCode?: string;
};

export type MetaConnectedAccount = {
  credentialReferenceId: string;
  providerId: "instagram" | "facebook";
  providerSubjectId: string;
  displayName?: string;
  avatarUrl?: string;
  status: PublicationCredentialReference["status"];
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type MetaInstagramOAuthStatus = {
  connected: boolean;
  configured: boolean;
  accounts: readonly MetaConnectedAccount[];
  credentialReferences: readonly PublicationCredentialReference[];
  telemetry: MetaInstagramOAuthTelemetry;
};

type ResolvedPage = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramBusinessAccountId?: string;
  instagramUsername?: string;
  instagramProfilePictureUrl?: string;
};

const STATE_TTL_MS = 10 * 60 * 1000;

export class MetaInstagramOAuthService {
  private readonly states = new Map<string, MetaInstagramOAuthState>();
  private telemetry: MetaInstagramOAuthTelemetry = { oauthSuccess: 0, oauthFailure: 0, tokenRefreshSuccess: 0, tokenRefreshFailure: 0 };

  constructor(
    private readonly input: {
      config: MetaInstagramOAuthConfig;
      repository: PublicationRepositoryPort;
      secretStore: PublicationSecretStoragePort;
      credentialGovernanceService?: CredentialGovernanceService;
      httpClient?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  isConfigured(): boolean {
    const { enabled, appId, appSecret, redirectUri } = this.input.config;
    return !!(enabled && appId && appSecret && redirectUri);
  }

  /** Passo 1 — devolve a URL de autorização do Meta (com PKCE) para o cliente aprovar o acesso. */
  begin(input: { tenantId: string; workspaceId: string }): { authorizationUrl: string; state: string; expiresAt: string } {
    this.assertConfigured();
    const now = this.now();
    this.pruneExpiredStates(now);
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();
    this.states.set(state, { state, tenantId: input.tenantId, workspaceId: input.workspaceId, codeVerifier, createdAt: now.toISOString(), expiresAt });

    const url = new URL(`${this.oauthDialogBaseUrl()}/dialog/oauth`);
    url.searchParams.set("client_id", this.input.config.appId!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.input.config.scopes.join(","));
    url.searchParams.set("code_challenge", createHash("sha256").update(codeVerifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), state, expiresAt };
  }

  /** Passo 2 — troca o `code` por tokens, resolve as Páginas + contas do Instagram vinculadas e registra as credenciais governadas do cliente. */
  async complete(input: { state: string; code: string; actor?: CredentialGovernanceActor; context?: AuditContext }): Promise<{ accounts: readonly MetaConnectedAccount[] }> {
    this.assertConfigured();
    const pending = this.states.get(input.state);
    if (!pending || pending.expiresAt <= this.now().toISOString()) {
      this.states.delete(input.state);
      this.recordOAuthFailure("META_OAUTH_STATE_INVALID");
      throw new Error("META_OAUTH_STATE_INVALID: state OAuth inválido ou expirado.");
    }
    this.states.delete(input.state);

    let pages: readonly ResolvedPage[];
    let userAccessToken: string;
    try {
      const shortLived = await this.exchangeCode(input.code, pending.codeVerifier);
      const longLived = await this.exchangeLongLivedToken(shortLived.accessToken);
      userAccessToken = longLived.accessToken;
      pages = await this.resolvePages(userAccessToken);
    } catch (error) {
      this.recordOAuthFailure(error instanceof Error ? error.message.split(":")[0] : "META_OAUTH_FAILED");
      throw error;
    }
    if (pages.length === 0) {
      this.recordOAuthFailure("META_NO_PAGES_FOUND");
      throw new Error("META_NO_PAGES_FOUND: nenhuma Página do Facebook encontrada para esta conta.");
    }

    const accounts: MetaConnectedAccount[] = [];
    for (const page of pages) {
      const facebookAccount = await this.persistCredential({
        providerId: "facebook",
        tenantId: pending.tenantId,
        workspaceId: pending.workspaceId,
        providerSubjectId: page.pageId,
        pageAccessToken: page.pageAccessToken,
        userAccessToken,
        displayName: page.pageName,
        actor: input.actor,
        context: input.context,
      });
      accounts.push(facebookAccount);

      if (page.instagramBusinessAccountId) {
        const instagramAccount = await this.persistCredential({
          providerId: "instagram",
          tenantId: pending.tenantId,
          workspaceId: pending.workspaceId,
          providerSubjectId: page.instagramBusinessAccountId,
          pageAccessToken: page.pageAccessToken,
          userAccessToken,
          pageId: page.pageId,
          displayName: page.instagramUsername ? `@${page.instagramUsername}` : page.pageName,
          avatarUrl: page.instagramProfilePictureUrl,
          actor: input.actor,
          context: input.context,
        });
        accounts.push(instagramAccount);
      }
    }

    this.telemetry = { ...this.telemetry, oauthSuccess: this.telemetry.oauthSuccess + 1 };
    return { accounts };
  }

  /**
   * Renova o Page Access Token a partir do token do usuário guardado. Diferente do TikTok, o
   * Page Access Token derivado de um token de usuário de longa duração não expira sozinho — esta
   * renovação existe para o caso de o token do usuário ter sido revogado/rotacionado no Meta.
   */
  async refresh(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<string | undefined> {
    if (!this.isConfigured()) return undefined;
    const providerId = providerIdFromReference(input.credentialReferenceId);
    if (!providerId) return undefined;
    const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId, credentialReferenceId: input.credentialReferenceId });
    if (!secret) return undefined;
    const userAccessToken = secret.value.userAccessToken;
    const pageId = secret.value.pageId;
    if (!userAccessToken || !pageId) return undefined;

    try {
      const pageAccessToken = await this.resolvePageAccessToken(pageId, userAccessToken);
      await this.input.secretStore.put({
        credentialReferenceId: input.credentialReferenceId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        providerId,
        value: { ...secret.value, accessToken: pageAccessToken },
        createdAt: this.now().toISOString(),
        updatedAt: this.now().toISOString(),
      });
      this.telemetry = { ...this.telemetry, tokenRefreshSuccess: this.telemetry.tokenRefreshSuccess + 1 };
      return pageAccessToken;
    } catch (error) {
      this.telemetry = { ...this.telemetry, tokenRefreshFailure: this.telemetry.tokenRefreshFailure + 1, lastFailureCode: error instanceof Error ? error.message.split(":")[0] : "META_TOKEN_REFRESH_FAILED" };
      return undefined;
    }
  }

  async status(input: { tenantId: string; workspaceId: string; providerId?: "instagram" | "facebook" }): Promise<MetaInstagramOAuthStatus> {
    const providerIds: readonly PublicationProvider[] = input.providerId ? [input.providerId] : ["facebook", "instagram"];
    const references: PublicationCredentialReference[] = [];
    for (const providerId of providerIds) {
      references.push(...(await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId })));
    }

    const accounts: MetaConnectedAccount[] = [];
    for (const reference of references) {
      if (reference.status === "revoked") continue;
      const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: reference.providerId, credentialReferenceId: reference.credentialReferenceId });
      accounts.push({
        credentialReferenceId: reference.credentialReferenceId,
        providerId: reference.providerId as "instagram" | "facebook",
        providerSubjectId: reference.providerSubjectId ?? "",
        displayName: secret?.value.displayName,
        avatarUrl: secret?.value.avatarUrl,
        status: reference.status,
        scopes: reference.scopes ?? [],
        expiresAt: reference.expiresAt,
        connectedAt: reference.lastRefreshedAt,
      });
    }
    return {
      connected: accounts.some((account) => account.status === "active"),
      configured: this.isConfigured(),
      accounts,
      credentialReferences: references,
      telemetry: this.telemetry,
    };
  }

  /** Revoga a permissão no Meta e marca a credencial como revogada. */
  async disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; actor?: CredentialGovernanceActor; context?: AuditContext; reason?: string }): Promise<boolean> {
    const providerId = providerIdFromReference(input.credentialReferenceId);
    if (!providerId) return false;
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId });
    const reference = references.find((candidate) => candidate.credentialReferenceId === input.credentialReferenceId);
    if (!reference) return false;

    const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId, credentialReferenceId: input.credentialReferenceId });
    if (secret?.value.userAccessToken && this.isConfigured()) {
      await this.revokePermissions(secret.value.userAccessToken).catch(() => undefined);
    }
    await this.input.secretStore.delete({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId, credentialReferenceId: input.credentialReferenceId });
    await this.input.repository.createCredentialReference({ ...reference, status: "revoked", revokedAt: this.now().toISOString() });

    if (this.input.credentialGovernanceService && input.actor) {
      await this.input.credentialGovernanceService.revoke({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        credentialId: `credential:${input.tenantId}:${input.workspaceId}:${providerId}`,
        actor: input.actor,
        context: input.context,
        reason: input.reason ?? "Meta OAuth disconnect",
      }).catch(() => undefined);
    }
    return true;
  }

  private async persistCredential(input: {
    providerId: "instagram" | "facebook";
    tenantId: string;
    workspaceId: string;
    providerSubjectId: string;
    pageAccessToken: string;
    userAccessToken: string;
    pageId?: string;
    displayName?: string;
    avatarUrl?: string;
    actor?: CredentialGovernanceActor;
    context?: AuditContext;
  }): Promise<MetaConnectedAccount> {
    const now = this.now();
    const nowIso = now.toISOString();
    const credentialReferenceId = `${input.providerId}:${input.tenantId}:${input.workspaceId}:${input.providerSubjectId}`;
    const grantedScopes = [...this.input.config.scopes];

    await this.input.secretStore.put({
      credentialReferenceId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      value: definedStrings({
        accessToken: input.pageAccessToken,
        userAccessToken: input.userAccessToken,
        pageId: input.pageId ?? input.providerSubjectId,
        instagramBusinessAccountId: input.providerId === "instagram" ? input.providerSubjectId : undefined,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
      }),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await this.input.repository.createCredentialReference({
      credentialReferenceId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      status: "active",
      environment: "production",
      providerSubjectId: input.providerSubjectId,
      scopes: grantedScopes,
      lastRefreshedAt: nowIso,
    });
    await this.input.credentialGovernanceService?.registerOAuthCredential({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      environment: "production",
      credentialReferenceId,
      providerSubjectId: input.providerSubjectId,
      grantedScopes,
      actor: input.actor,
      context: input.context,
    });
    return {
      credentialReferenceId,
      providerId: input.providerId,
      providerSubjectId: input.providerSubjectId,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      status: "active",
      scopes: grantedScopes,
      connectedAt: nowIso,
    };
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<{ accessToken: string; expiresIn?: number }> {
    const url = new URL(`${this.graphBaseUrl()}/oauth/access_token`);
    url.searchParams.set("client_id", this.input.config.appId!);
    url.searchParams.set("client_secret", this.input.config.appSecret!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("code", code);
    url.searchParams.set("code_verifier", codeVerifier);
    return this.tokenRequest(url);
  }

  private async exchangeLongLivedToken(accessToken: string): Promise<{ accessToken: string; expiresIn?: number }> {
    const url = new URL(`${this.graphBaseUrl()}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", this.input.config.appId!);
    url.searchParams.set("client_secret", this.input.config.appSecret!);
    url.searchParams.set("fb_exchange_token", accessToken);
    return this.tokenRequest(url);
  }

  private async tokenRequest(url: URL): Promise<{ accessToken: string; expiresIn?: number }> {
    const response = await this.http()(url.toString());
    const json = await safeJson(response) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!response.ok || !json.access_token) throw new Error(`META_OAUTH_TOKEN_FAILED: ${json.error?.message ?? "Meta token exchange falhou."}`);
    return { accessToken: json.access_token, expiresIn: json.expires_in };
  }

  /** Resolve todas as Páginas do usuário e, para cada uma, a conta profissional do Instagram vinculada (se houver). */
  private async resolvePages(userAccessToken: string): Promise<readonly ResolvedPage[]> {
    const url = new URL(`${this.graphBaseUrl()}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username,profile_picture_url}");
    url.searchParams.set("access_token", userAccessToken);
    const response = await this.http()(url.toString());
    const json = await safeJson(response) as {
      data?: Array<{ id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string; profile_picture_url?: string } }>;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(`META_OAUTH_PAGES_FAILED: ${json.error?.message ?? "Não foi possível listar as Páginas do Facebook."}`);

    const pages: ResolvedPage[] = [];
    for (const page of json.data ?? []) {
      if (!page.id || !page.access_token) continue;
      pages.push({
        pageId: page.id,
        pageName: page.name ?? page.id,
        pageAccessToken: page.access_token,
        instagramBusinessAccountId: page.instagram_business_account?.id,
        instagramUsername: page.instagram_business_account?.username,
        instagramProfilePictureUrl: page.instagram_business_account?.profile_picture_url,
      });
    }
    return pages;
  }

  private async resolvePageAccessToken(pageId: string, userAccessToken: string): Promise<string> {
    const url = new URL(`${this.graphBaseUrl()}/${pageId}`);
    url.searchParams.set("fields", "access_token");
    url.searchParams.set("access_token", userAccessToken);
    const response = await this.http()(url.toString());
    const json = await safeJson(response) as { access_token?: string; error?: { message?: string } };
    if (!response.ok || !json.access_token) throw new Error(`META_PAGE_TOKEN_REFRESH_FAILED: ${json.error?.message ?? "Não foi possível renovar o token da Página."}`);
    return json.access_token;
  }

  private async revokePermissions(userAccessToken: string): Promise<void> {
    const url = new URL(`${this.graphBaseUrl()}/me/permissions`);
    url.searchParams.set("access_token", userAccessToken);
    await this.http()(url.toString(), { method: "DELETE" });
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new Error("META_OAUTH_NOT_CONFIGURED: defina META_APP_ID, META_APP_SECRET e META_INSTAGRAM_OAUTH_REDIRECT_URI.");
  }

  private pruneExpiredStates(now: Date): void {
    const nowIso = now.toISOString();
    for (const [key, value] of this.states) {
      if (value.expiresAt <= nowIso) this.states.delete(key);
    }
  }

  private graphBaseUrl(): string {
    return this.input.config.graphBaseUrl ?? "https://graph.facebook.com/v21.0";
  }

  private oauthDialogBaseUrl(): string {
    const base = this.input.config.graphBaseUrl;
    if (!base || base.includes("graph.facebook.com")) return "https://www.facebook.com/v21.0";
    return base;
  }

  private http(): typeof fetch {
    return this.input.httpClient ?? fetch;
  }

  private now(): Date {
    return this.input.now?.() ?? new Date();
  }

  private recordOAuthFailure(code: string): void {
    this.telemetry = { ...this.telemetry, oauthFailure: this.telemetry.oauthFailure + 1, lastFailureCode: code };
  }
}

function providerIdFromReference(credentialReferenceId: string): "instagram" | "facebook" | undefined {
  if (credentialReferenceId.startsWith("instagram:")) return "instagram";
  if (credentialReferenceId.startsWith("facebook:")) return "facebook";
  return undefined;
}

function definedStrings(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? json as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export const META_INSTAGRAM_REQUIRED_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"] as const;

export function createDisabledMetaInstagramOAuthService(input: { repository: PublicationRepositoryPort; secretStore: PublicationSecretStoragePort }): MetaInstagramOAuthService {
  return new MetaInstagramOAuthService({ config: { enabled: false, scopes: META_INSTAGRAM_REQUIRED_SCOPES }, repository: input.repository, secretStore: input.secretStore });
}
