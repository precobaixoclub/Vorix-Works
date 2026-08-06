import { randomBytes } from "node:crypto";
import type { CredentialGovernanceActor, CredentialGovernanceService } from "../../application/credential/credential-governance-service.js";
import type { PublicationRepositoryPort } from "../../application/ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../../application/publication/publication-secret-store.js";
import type { AuditContext } from "../../domain/credential/credential.model.js";
import type { PublicationCredentialReference } from "../../domain/publication/publication.model.js";

export type YouTubeOAuthConfig = {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  authBaseUrl?: string;
  tokenBaseUrl?: string;
  apiBaseUrl?: string;
  scopes: readonly string[];
  environment?: "sandbox" | "production";
};

export type YouTubeOAuthTelemetry = {
  oauthSuccess: number;
  oauthFailure: number;
  tokenRefreshSuccess: number;
  tokenRefreshFailure: number;
  lastFailureCode?: string;
};

export type YouTubeOAuthStatus = {
  connected: boolean;
  providerId: "youtube";
  configured: boolean;
  accounts: readonly YouTubeConnectedAccount[];
  credentialReferences: readonly PublicationCredentialReference[];
  telemetry: YouTubeOAuthTelemetry;
};

export type YouTubeConnectedAccount = {
  credentialReferenceId: string;
  channelId: string;
  displayName?: string;
  avatarUrl?: string;
  status: PublicationCredentialReference["status"];
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type YouTubeTokenSet = {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  expiresIn?: number;
};

type YouTubeOAuthState = {
  state: string;
  tenantId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
};

const STATE_TTL_MS = 10 * 60 * 1000;

export class YouTubeOAuthService {
  private readonly states = new Map<string, YouTubeOAuthState>();
  private telemetry: YouTubeOAuthTelemetry = { oauthSuccess: 0, oauthFailure: 0, tokenRefreshSuccess: 0, tokenRefreshFailure: 0 };

  constructor(
    private readonly input: {
      config: YouTubeOAuthConfig;
      repository: PublicationRepositoryPort;
      secretStore: PublicationSecretStoragePort;
      credentialGovernanceService?: CredentialGovernanceService;
      httpClient?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  isConfigured(): boolean {
    const { enabled, clientId, clientSecret, redirectUri } = this.input.config;
    return !!(enabled && clientId && clientSecret && redirectUri);
  }

  begin(input: { tenantId: string; workspaceId: string }): { authorizationUrl: string; state: string; expiresAt: string } {
    this.assertConfigured();
    const now = this.now();
    this.pruneExpiredStates(now);
    const state = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();
    this.states.set(state, { state, tenantId: input.tenantId, workspaceId: input.workspaceId, createdAt: now.toISOString(), expiresAt });

    const url = new URL(`${this.authBaseUrl()}/o/oauth2/v2/auth`);
    url.searchParams.set("client_id", this.input.config.clientId!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.input.config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    return { authorizationUrl: url.toString(), state, expiresAt };
  }

  async complete(input: { state: string; code: string; actor?: CredentialGovernanceActor; context?: AuditContext }): Promise<{ credentialReferenceId: string; providerSubjectId: string; displayName?: string }> {
    this.assertConfigured();
    const pending = this.states.get(input.state);
    if (!pending || pending.expiresAt <= this.now().toISOString()) {
      this.states.delete(input.state);
      this.recordOAuthFailure("YOUTUBE_OAUTH_STATE_INVALID");
      throw new Error("YOUTUBE_OAUTH_STATE_INVALID: state OAuth invalido ou expirado.");
    }
    this.states.delete(input.state);

    let tokens: YouTubeTokenSet;
    let channel: { channelId: string; displayName?: string; avatarUrl?: string };
    try {
      tokens = await this.exchangeCode(input.code);
      channel = await this.fetchChannel(tokens.accessToken);
    } catch (error) {
      this.recordOAuthFailure(error instanceof Error ? error.message.split(":")[0] : "YOUTUBE_OAUTH_FAILED");
      throw error;
    }

    const credentialReferenceId = this.credentialReferenceId(pending.tenantId, pending.workspaceId, channel.channelId);
    const grantedScopes = tokens.scope ? tokens.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean) : [...this.input.config.scopes];
    await this.persistCredential({
      tenantId: pending.tenantId,
      workspaceId: pending.workspaceId,
      credentialReferenceId,
      tokens,
      grantedScopes,
      channelId: channel.channelId,
      displayName: channel.displayName,
      avatarUrl: channel.avatarUrl,
      actor: input.actor,
      context: input.context,
    });

    this.telemetry = { ...this.telemetry, oauthSuccess: this.telemetry.oauthSuccess + 1 };
    return { credentialReferenceId, providerSubjectId: channel.channelId, displayName: channel.displayName };
  }

  async refresh(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<string | undefined> {
    if (!this.isConfigured()) return undefined;
    const secret = await this.input.secretStore.get({ ...input, providerId: "youtube" });
    const refreshToken = secret?.value.refreshToken;
    if (!refreshToken) return undefined;

    let tokens: YouTubeTokenSet;
    try {
      tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      this.telemetry = { ...this.telemetry, tokenRefreshSuccess: this.telemetry.tokenRefreshSuccess + 1 };
    } catch (error) {
      this.telemetry = { ...this.telemetry, tokenRefreshFailure: this.telemetry.tokenRefreshFailure + 1, lastFailureCode: error instanceof Error ? error.message.split(":")[0] : "YOUTUBE_TOKEN_REFRESH_FAILED" };
      return undefined;
    }

    await this.persistCredential({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      credentialReferenceId: input.credentialReferenceId,
      tokens: { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken },
      grantedScopes: tokens.scope ? tokens.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean) : [...this.input.config.scopes],
      channelId: secret?.value.channelId ?? "",
      displayName: secret?.value.displayName,
      avatarUrl: secret?.value.avatarUrl,
    });
    return tokens.accessToken;
  }

  async status(input: { tenantId: string; workspaceId: string }): Promise<YouTubeOAuthStatus> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "youtube" });
    const accounts: YouTubeConnectedAccount[] = [];
    for (const reference of references) {
      if (reference.status === "revoked") continue;
      const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "youtube", credentialReferenceId: reference.credentialReferenceId });
      accounts.push({
        credentialReferenceId: reference.credentialReferenceId,
        channelId: reference.providerSubjectId ?? secret?.value.channelId ?? "",
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
      providerId: "youtube",
      configured: this.isConfigured(),
      accounts,
      credentialReferences: references,
      telemetry: this.telemetry,
    };
  }

  async disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; actor?: CredentialGovernanceActor; context?: AuditContext; reason?: string }): Promise<boolean> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "youtube" });
    const reference = references.find((candidate) => candidate.credentialReferenceId === input.credentialReferenceId);
    if (!reference) return false;

    const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "youtube", credentialReferenceId: input.credentialReferenceId });
    const token = secret?.value.refreshToken ?? secret?.value.accessToken;
    if (token && this.isConfigured()) await this.revokeToken(token).catch(() => undefined);
    await this.input.secretStore.delete({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "youtube", credentialReferenceId: input.credentialReferenceId });
    await this.input.repository.createCredentialReference({ ...reference, status: "revoked", revokedAt: this.now().toISOString() });

    if (this.input.credentialGovernanceService && input.actor) {
      await this.input.credentialGovernanceService.revoke({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        credentialId: `credential:${input.tenantId}:${input.workspaceId}:youtube`,
        actor: input.actor,
        context: input.context,
        reason: input.reason ?? "YouTube OAuth disconnect",
      }).catch(() => undefined);
    }
    return true;
  }

  private async persistCredential(input: {
    tenantId: string;
    workspaceId: string;
    credentialReferenceId: string;
    tokens: YouTubeTokenSet;
    grantedScopes: readonly string[];
    channelId: string;
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
      providerId: "youtube",
      expiresAt,
      value: definedStrings({
        accessToken: input.tokens.accessToken,
        refreshToken: input.tokens.refreshToken,
        channelId: input.channelId,
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
      providerId: "youtube",
      status: "active",
      environment,
      providerSubjectId: input.channelId,
      scopes: input.grantedScopes,
      expiresAt,
      lastRefreshedAt: nowIso,
    });
    await this.input.credentialGovernanceService?.registerOAuthCredential({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: "youtube",
      environment,
      credentialReferenceId: input.credentialReferenceId,
      providerSubjectId: input.channelId,
      grantedScopes: input.grantedScopes,
      expiresAt,
      actor: input.actor,
      context: input.context,
    });
  }

  private async exchangeCode(code: string): Promise<YouTubeTokenSet> {
    return this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.input.config.redirectUri! });
  }

  private async tokenRequest(fields: Record<string, string>): Promise<YouTubeTokenSet> {
    const response = await this.http()(`${this.tokenBaseUrl()}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.input.config.clientId!, client_secret: this.input.config.clientSecret!, ...fields }),
    });
    const json = await safeJson(response) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !json.access_token) throw new Error(`YOUTUBE_OAUTH_TOKEN_FAILED: ${json.error_description ?? json.error ?? `HTTP ${response.status}`}`);
    return { accessToken: json.access_token, refreshToken: json.refresh_token, scope: json.scope, expiresIn: json.expires_in };
  }

  private async fetchChannel(accessToken: string): Promise<{ channelId: string; displayName?: string; avatarUrl?: string }> {
    const url = new URL(`${this.apiBaseUrl()}/channels`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("mine", "true");
    const response = await this.http()(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await safeJson(response) as { items?: Array<{ id?: string; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }>; error?: { message?: string } };
    const channel = json.items?.[0];
    if (!response.ok || !channel?.id) throw new Error(`YOUTUBE_CHANNEL_NOT_FOUND: ${json.error?.message ?? `HTTP ${response.status}`}`);
    return { channelId: channel.id, displayName: channel.snippet?.title, avatarUrl: channel.snippet?.thumbnails?.default?.url };
  }

  private async revokeToken(token: string): Promise<void> {
    await this.http()(`${this.tokenBaseUrl()}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  }

  private credentialReferenceId(tenantId: string, workspaceId: string, channelId: string): string {
    return `youtube:${tenantId}:${workspaceId}:${channelId}`;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new Error("YOUTUBE_OAUTH_NOT_CONFIGURED: defina YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET e YOUTUBE_OAUTH_REDIRECT_URI.");
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

  private authBaseUrl(): string {
    return this.input.config.authBaseUrl ?? "https://accounts.google.com";
  }

  private tokenBaseUrl(): string {
    return this.input.config.tokenBaseUrl ?? "https://oauth2.googleapis.com";
  }

  private apiBaseUrl(): string {
    return this.input.config.apiBaseUrl ?? "https://www.googleapis.com/youtube/v3";
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

export const YOUTUBE_REQUIRED_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"] as const;

export function createDisabledYouTubeOAuthService(input: { repository: PublicationRepositoryPort; secretStore: PublicationSecretStoragePort }): YouTubeOAuthService {
  return new YouTubeOAuthService({ config: { enabled: false, scopes: YOUTUBE_REQUIRED_SCOPES }, repository: input.repository, secretStore: input.secretStore });
}
