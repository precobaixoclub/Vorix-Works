import { createHash, randomBytes } from "node:crypto";
import type { CredentialGovernanceActor, CredentialGovernanceService } from "../../application/credential/credential-governance-service.js";
import type { PublicationRepositoryPort } from "../../application/ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../../application/publication/publication-secret-store.js";
import type { AuditContext } from "../../domain/credential/credential.model.js";
import type { PublicationCredentialReference } from "../../domain/publication/publication.model.js";

/**
 * OAuth 2.0 (Login Kit) do TikTok para a Content Posting API. Cada cliente (tenant + workspace)
 * conecta a própria conta e recebe um `credentialReferenceId` próprio; o token cru nunca sai daqui —
 * fica no `PublicationSecretStoragePort` (cifrado) e é lido apenas pelo provider de publicação.
 */
export type TikTokOAuthConfig = {
  enabled: boolean;
  clientKey?: string;
  clientSecret?: string;
  redirectUri?: string;
  apiBaseUrl?: string;
  authorizeBaseUrl?: string;
  scopes: readonly string[];
  environment?: "sandbox" | "production";
  pkceEnabled?: boolean;
};

export type TikTokOAuthState = {
  state: string;
  tenantId: string;
  workspaceId: string;
  codeVerifier?: string;
  createdAt: string;
  expiresAt: string;
};

export type TikTokOAuthTelemetry = {
  oauthSuccess: number;
  oauthFailure: number;
  tokenRefreshSuccess: number;
  tokenRefreshFailure: number;
  lastFailureCode?: string;
};

export type TikTokOAuthStatus = {
  connected: boolean;
  providerId: "tiktok";
  configured: boolean;
  accounts: readonly TikTokConnectedAccount[];
  credentialReferences: readonly PublicationCredentialReference[];
  telemetry: TikTokOAuthTelemetry;
};

export type TikTokConnectedAccount = {
  credentialReferenceId: string;
  openId: string;
  displayName?: string;
  avatarUrl?: string;
  status: PublicationCredentialReference["status"];
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type TikTokTokenSet = {
  accessToken: string;
  refreshToken?: string;
  openId: string;
  scope?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
};

const STATE_TTL_MS = 10 * 60 * 1000;

export class TikTokOAuthService {
  private readonly states = new Map<string, TikTokOAuthState>();
  private telemetry: TikTokOAuthTelemetry = { oauthSuccess: 0, oauthFailure: 0, tokenRefreshSuccess: 0, tokenRefreshFailure: 0 };

  constructor(
    private readonly input: {
      config: TikTokOAuthConfig;
      repository: PublicationRepositoryPort;
      secretStore: PublicationSecretStoragePort;
      credentialGovernanceService?: CredentialGovernanceService;
      httpClient?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  isConfigured(): boolean {
    const { enabled, clientKey, clientSecret, redirectUri } = this.input.config;
    return !!(enabled && clientKey && clientSecret && redirectUri);
  }

  /** Passo 1 — devolve a URL de autorização do TikTok (com PKCE) para o cliente aprovar o acesso. */
  begin(input: { tenantId: string; workspaceId: string }): { authorizationUrl: string; state: string; expiresAt: string } {
    this.assertConfigured();
    const now = this.now();
    this.pruneExpiredStates(now);
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = this.input.config.pkceEnabled ? randomBytes(48).toString("base64url") : undefined;
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();
    this.states.set(state, { state, tenantId: input.tenantId, workspaceId: input.workspaceId, codeVerifier, createdAt: now.toISOString(), expiresAt });

    const url = new URL(`${this.authorizeBaseUrl()}/v2/auth/authorize/`);
    url.searchParams.set("client_key", this.input.config.clientKey!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.input.config.scopes.join(","));
    url.searchParams.set("state", state);
    if (codeVerifier) {
      url.searchParams.set("code_challenge", createHash("sha256").update(codeVerifier).digest("base64url"));
      url.searchParams.set("code_challenge_method", "S256");
    }
    return { authorizationUrl: url.toString(), state, expiresAt };
  }

  /** Passo 2 — troca o `code` do callback por tokens e registra a credencial governada do cliente. */
  async complete(input: { state: string; code: string; actor?: CredentialGovernanceActor; context?: AuditContext }): Promise<{ credentialReferenceId: string; providerSubjectId: string; displayName?: string }> {
    this.assertConfigured();
    const pending = this.states.get(input.state);
    if (!pending || pending.expiresAt <= this.now().toISOString()) {
      this.states.delete(input.state);
      this.recordOAuthFailure("TIKTOK_OAUTH_STATE_INVALID");
      throw new Error("TIKTOK_OAUTH_STATE_INVALID: state OAuth inválido ou expirado.");
    }
    this.states.delete(input.state);

    let tokens: TikTokTokenSet;
    let profile: { displayName?: string; avatarUrl?: string };
    try {
      tokens = await this.exchangeCode(input.code, pending.codeVerifier);
      profile = await this.fetchProfile(tokens.accessToken);
    } catch (error) {
      this.recordOAuthFailure(error instanceof Error ? error.message.split(":")[0] : "TIKTOK_OAUTH_FAILED");
      throw error;
    }

    const credentialReferenceId = this.credentialReferenceId(pending.tenantId, pending.workspaceId, tokens.openId);
    const grantedScopes = tokens.scope ? tokens.scope.split(",").map((scope) => scope.trim()).filter(Boolean) : [...this.input.config.scopes];
    await this.persistCredential({
      tenantId: pending.tenantId,
      workspaceId: pending.workspaceId,
      credentialReferenceId,
      tokens,
      grantedScopes,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      actor: input.actor,
      context: input.context,
    });

    this.telemetry = { ...this.telemetry, oauthSuccess: this.telemetry.oauthSuccess + 1 };
    return { credentialReferenceId, providerSubjectId: tokens.openId, displayName: profile.displayName };
  }

  /** Renova o access token com o refresh token guardado. Usado pelo provider antes de publicar. */
  async refresh(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<string | undefined> {
    if (!this.isConfigured()) return undefined;
    const secret = await this.input.secretStore.get({ ...input, providerId: "tiktok" });
    const refreshToken = secret?.value.refreshToken;
    if (!refreshToken) return undefined;

    let tokens: TikTokTokenSet;
    try {
      tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      this.telemetry = { ...this.telemetry, tokenRefreshSuccess: this.telemetry.tokenRefreshSuccess + 1 };
    } catch (error) {
      this.telemetry = { ...this.telemetry, tokenRefreshFailure: this.telemetry.tokenRefreshFailure + 1, lastFailureCode: error instanceof Error ? error.message.split(":")[0] : "TIKTOK_TOKEN_REFRESH_FAILED" };
      return undefined;
    }

    await this.persistCredential({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      credentialReferenceId: input.credentialReferenceId,
      tokens: { ...tokens, openId: tokens.openId || (secret?.value.openId ?? "") },
      grantedScopes: tokens.scope ? tokens.scope.split(",").map((scope) => scope.trim()).filter(Boolean) : [...this.input.config.scopes],
      displayName: secret?.value.displayName,
      avatarUrl: secret?.value.avatarUrl,
    });
    return tokens.accessToken;
  }

  async status(input: { tenantId: string; workspaceId: string }): Promise<TikTokOAuthStatus> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "tiktok" });
    const accounts: TikTokConnectedAccount[] = [];
    for (const reference of references) {
      if (reference.status === "revoked") continue;
      const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "tiktok", credentialReferenceId: reference.credentialReferenceId });
      accounts.push({
        credentialReferenceId: reference.credentialReferenceId,
        openId: reference.providerSubjectId ?? secret?.value.openId ?? "",
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
      providerId: "tiktok",
      configured: this.isConfigured(),
      accounts,
      credentialReferences: references,
      telemetry: this.telemetry,
    };
  }

  /** Revoga o token no TikTok e marca a credencial como revogada. */
  async disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; actor?: CredentialGovernanceActor; context?: AuditContext; reason?: string }): Promise<boolean> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "tiktok" });
    const reference = references.find((candidate) => candidate.credentialReferenceId === input.credentialReferenceId);
    if (!reference) return false;

    const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "tiktok", credentialReferenceId: input.credentialReferenceId });
    if (secret?.value.accessToken && this.isConfigured()) {
      await this.revokeToken(secret.value.accessToken).catch(() => undefined);
    }
    await this.input.secretStore.delete({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "tiktok", credentialReferenceId: input.credentialReferenceId });
    await this.input.repository.createCredentialReference({ ...reference, status: "revoked", revokedAt: this.now().toISOString() });

    if (this.input.credentialGovernanceService && input.actor) {
      await this.input.credentialGovernanceService.revoke({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        credentialId: `credential:${input.tenantId}:${input.workspaceId}:tiktok`,
        actor: input.actor,
        context: input.context,
        reason: input.reason ?? "TikTok OAuth disconnect",
      }).catch(() => undefined);
    }
    return true;
  }

  private async persistCredential(input: {
    tenantId: string;
    workspaceId: string;
    credentialReferenceId: string;
    tokens: TikTokTokenSet;
    grantedScopes: readonly string[];
    displayName?: string;
    avatarUrl?: string;
    actor?: CredentialGovernanceActor;
    context?: AuditContext;
  }): Promise<void> {
    const now = this.now();
    const nowIso = now.toISOString();
    const expiresAt = input.tokens.expiresIn ? new Date(now.getTime() + input.tokens.expiresIn * 1000).toISOString() : undefined;
    const environment = this.environment();

    await this.input.secretStore.put({
      credentialReferenceId: input.credentialReferenceId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: "tiktok",
      expiresAt,
      value: definedStrings({
        accessToken: input.tokens.accessToken,
        refreshToken: input.tokens.refreshToken,
        openId: input.tokens.openId,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
      }),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await this.input.repository.createCredentialReference({
      credentialReferenceId: input.credentialReferenceId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: "tiktok",
      status: "active",
      environment,
      providerSubjectId: input.tokens.openId,
      scopes: input.grantedScopes,
      expiresAt,
      lastRefreshedAt: nowIso,
    });
    await this.input.credentialGovernanceService?.registerOAuthCredential({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: "tiktok",
      environment,
      credentialReferenceId: input.credentialReferenceId,
      providerSubjectId: input.tokens.openId,
      grantedScopes: input.grantedScopes,
      expiresAt,
      actor: input.actor,
      context: input.context,
    });
  }

  private async exchangeCode(code: string, codeVerifier?: string): Promise<TikTokTokenSet> {
    return this.tokenRequest(definedStrings({ grant_type: "authorization_code", code, redirect_uri: this.input.config.redirectUri!, code_verifier: codeVerifier }));
  }

  private async tokenRequest(fields: Record<string, string>): Promise<TikTokTokenSet> {
    const body = new URLSearchParams({ client_key: this.input.config.clientKey!, client_secret: this.input.config.clientSecret!, ...fields });
    const response = await this.http()(`${this.apiBaseUrl()}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body,
    });
    const json = await safeJson(response) as {
      access_token?: string;
      refresh_token?: string;
      open_id?: string;
      scope?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !json.access_token) {
      throw new Error(`TIKTOK_OAUTH_TOKEN_FAILED: ${json.error_description ?? json.error ?? `HTTP ${response.status}`}`);
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      openId: json.open_id ?? "",
      scope: json.scope,
      expiresIn: json.expires_in,
      refreshExpiresIn: json.refresh_expires_in,
    };
  }

  private async fetchProfile(accessToken: string): Promise<{ displayName?: string; avatarUrl?: string }> {
    const url = new URL(`${this.apiBaseUrl()}/v2/user/info/`);
    url.searchParams.set("fields", "open_id,display_name,avatar_url");
    const response = await this.http()(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await safeJson(response) as { data?: { user?: { display_name?: string; avatar_url?: string } } };
    return { displayName: json.data?.user?.display_name, avatarUrl: json.data?.user?.avatar_url };
  }

  private async revokeToken(accessToken: string): Promise<void> {
    await this.http()(`${this.apiBaseUrl()}/v2/oauth/revoke/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: this.input.config.clientKey!, client_secret: this.input.config.clientSecret!, token: accessToken }),
    });
  }

  private credentialReferenceId(tenantId: string, workspaceId: string, openId: string): string {
    return `tiktok:${tenantId}:${workspaceId}:${openId}`;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new Error("TIKTOK_OAUTH_NOT_CONFIGURED: defina TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_OAUTH_REDIRECT_URI.");
  }

  private pruneExpiredStates(now: Date): void {
    const nowIso = now.toISOString();
    for (const [key, value] of this.states) {
      if (value.expiresAt <= nowIso) this.states.delete(key);
    }
  }

  private environment(): "sandbox" | "production" {
    return this.input.config.environment ?? "production";
  }

  private apiBaseUrl(): string {
    return this.input.config.apiBaseUrl ?? "https://open.tiktokapis.com";
  }

  private authorizeBaseUrl(): string {
    return this.input.config.authorizeBaseUrl ?? "https://www.tiktok.com";
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

export const TIKTOK_REQUIRED_SCOPES = ["user.info.basic", "video.publish", "video.upload"] as const;

export function createDisabledTikTokOAuthService(input: { repository: PublicationRepositoryPort; secretStore: PublicationSecretStoragePort }): TikTokOAuthService {
  return new TikTokOAuthService({ config: { enabled: false, scopes: TIKTOK_REQUIRED_SCOPES }, repository: input.repository, secretStore: input.secretStore });
}
