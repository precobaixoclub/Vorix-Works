import { randomBytes } from "node:crypto";
import type { CredentialGovernanceActor, CredentialGovernanceService } from "../../application/credential/credential-governance-service.js";
import type { PublicationRepositoryPort } from "../../application/ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../../application/publication/publication-secret-store.js";
import type { AuditContext } from "../../domain/credential/credential.model.js";
import type { PublicationCredentialReference } from "../../domain/publication/publication.model.js";

/**
 * OAuth 2.0 do Kwai (plataforma aberta da Kuaishou, `open.kuaishou.com` — Kwai é a marca
 * internacional da mesma empresa/plataforma). Baseado no SDK server-side oficial
 * (github.com/KwaiOpen/KwaiOpenSDK) e no doc de autorização do
 * github.com/KwaiVideoTeam/kuaishou-liveopen-api — dois repositórios independentes que
 * concordam exatamente nos mesmos endpoints/parâmetros, dando confiança razoável mesmo sem
 * termos verificado num app registrado de verdade. Ver `docs/kwai-publishing.md` para as
 * ressalvas (API não tem PKCE nem endpoint de revogação documentado, e é só vídeo).
 */
export type KwaiOAuthConfig = {
  enabled: boolean;
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  apiBaseUrl?: string;
  scopes: readonly string[];
  environment?: "sandbox" | "production";
};

export type KwaiOAuthState = {
  state: string;
  tenantId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
};

export type KwaiOAuthTelemetry = {
  oauthSuccess: number;
  oauthFailure: number;
  tokenRefreshSuccess: number;
  tokenRefreshFailure: number;
  lastFailureCode?: string;
};

export type KwaiOAuthStatus = {
  connected: boolean;
  providerId: "kwai";
  configured: boolean;
  accounts: readonly KwaiConnectedAccount[];
  credentialReferences: readonly PublicationCredentialReference[];
  telemetry: KwaiOAuthTelemetry;
};

export type KwaiConnectedAccount = {
  credentialReferenceId: string;
  openId: string;
  displayName?: string;
  avatarUrl?: string;
  status: PublicationCredentialReference["status"];
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type KwaiTokenSet = {
  accessToken: string;
  refreshToken?: string;
  openId: string;
  scopes?: readonly string[];
  expiresIn?: number;
};

const STATE_TTL_MS = 10 * 60 * 1000;

export class KwaiOAuthService {
  private readonly states = new Map<string, KwaiOAuthState>();
  private telemetry: KwaiOAuthTelemetry = { oauthSuccess: 0, oauthFailure: 0, tokenRefreshSuccess: 0, tokenRefreshFailure: 0 };

  constructor(
    private readonly input: {
      config: KwaiOAuthConfig;
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

  /** Passo 1 — devolve a URL de autorização do Kwai. Sem PKCE: a API não documenta suporte a isso (diferente do TikTok/Meta). */
  begin(input: { tenantId: string; workspaceId: string }): { authorizationUrl: string; state: string; expiresAt: string } {
    this.assertConfigured();
    const now = this.now();
    this.pruneExpiredStates(now);
    const state = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();
    this.states.set(state, { state, tenantId: input.tenantId, workspaceId: input.workspaceId, createdAt: now.toISOString(), expiresAt });

    const url = new URL(`${this.apiBaseUrl()}/oauth2/authorize`);
    url.searchParams.set("app_id", this.input.config.appId!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.input.config.scopes.join(","));
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("ua", "pc");
    return { authorizationUrl: url.toString(), state, expiresAt };
  }

  /** Passo 2 — troca o `code` do callback por tokens e registra a credencial governada do cliente. */
  async complete(input: { state: string; code: string; actor?: CredentialGovernanceActor; context?: AuditContext }): Promise<{ credentialReferenceId: string; providerSubjectId: string; displayName?: string }> {
    this.assertConfigured();
    const pending = this.states.get(input.state);
    if (!pending || pending.expiresAt <= this.now().toISOString()) {
      this.states.delete(input.state);
      this.recordOAuthFailure("KWAI_OAUTH_STATE_INVALID");
      throw new Error("KWAI_OAUTH_STATE_INVALID: state OAuth inválido ou expirado.");
    }
    this.states.delete(input.state);

    let tokens: KwaiTokenSet;
    let profile: { displayName?: string; avatarUrl?: string };
    try {
      tokens = await this.tokenRequest({ grant_type: "code", code: input.code });
      profile = await this.fetchProfile(tokens.accessToken);
    } catch (error) {
      this.recordOAuthFailure(error instanceof Error ? error.message.split(":")[0] : "KWAI_OAUTH_FAILED");
      throw error;
    }

    const credentialReferenceId = this.credentialReferenceId(pending.tenantId, pending.workspaceId, tokens.openId);
    const grantedScopes = tokens.scopes && tokens.scopes.length > 0 ? tokens.scopes : [...this.input.config.scopes];
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
    const secret = await this.input.secretStore.get({ ...input, providerId: "kwai" });
    const refreshToken = secret?.value.refreshToken;
    if (!refreshToken) return undefined;

    let tokens: KwaiTokenSet;
    try {
      tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      this.telemetry = { ...this.telemetry, tokenRefreshSuccess: this.telemetry.tokenRefreshSuccess + 1 };
    } catch (error) {
      this.telemetry = { ...this.telemetry, tokenRefreshFailure: this.telemetry.tokenRefreshFailure + 1, lastFailureCode: error instanceof Error ? error.message.split(":")[0] : "KWAI_TOKEN_REFRESH_FAILED" };
      return undefined;
    }

    await this.persistCredential({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      credentialReferenceId: input.credentialReferenceId,
      tokens: { ...tokens, openId: tokens.openId || (secret?.value.openId ?? "") },
      grantedScopes: tokens.scopes && tokens.scopes.length > 0 ? tokens.scopes : [...this.input.config.scopes],
      displayName: secret?.value.displayName,
      avatarUrl: secret?.value.avatarUrl,
    });
    return tokens.accessToken;
  }

  async status(input: { tenantId: string; workspaceId: string }): Promise<KwaiOAuthStatus> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "kwai" });
    const accounts: KwaiConnectedAccount[] = [];
    for (const reference of references) {
      if (reference.status === "revoked") continue;
      const secret = await this.input.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "kwai", credentialReferenceId: reference.credentialReferenceId });
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
      providerId: "kwai",
      configured: this.isConfigured(),
      accounts,
      credentialReferences: references,
      telemetry: this.telemetry,
    };
  }

  /**
   * Marca a credencial como revogada localmente. Diferente do TikTok, não encontramos um
   * endpoint de revogação remota documentado para o Kwai — só invalidamos o uso local; a
   * autorização no lado do Kwai só é desfeita se o usuário revogar pelo próprio app dele.
   */
  async disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; actor?: CredentialGovernanceActor; context?: AuditContext; reason?: string }): Promise<boolean> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "kwai" });
    const reference = references.find((candidate) => candidate.credentialReferenceId === input.credentialReferenceId);
    if (!reference) return false;

    await this.input.secretStore.delete({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "kwai", credentialReferenceId: input.credentialReferenceId });
    await this.input.repository.createCredentialReference({ ...reference, status: "revoked", revokedAt: this.now().toISOString() });

    if (this.input.credentialGovernanceService && input.actor) {
      await this.input.credentialGovernanceService.revoke({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        credentialId: `credential:${input.tenantId}:${input.workspaceId}:kwai`,
        actor: input.actor,
        context: input.context,
        reason: input.reason ?? "Kwai OAuth disconnect",
      }).catch(() => undefined);
    }
    return true;
  }

  private async persistCredential(input: {
    tenantId: string;
    workspaceId: string;
    credentialReferenceId: string;
    tokens: KwaiTokenSet;
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
      providerId: "kwai",
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
      providerId: "kwai",
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
      providerId: "kwai",
      environment,
      credentialReferenceId: input.credentialReferenceId,
      providerSubjectId: input.tokens.openId,
      grantedScopes: input.grantedScopes,
      expiresAt,
      actor: input.actor,
      context: input.context,
    });
  }

  private async tokenRequest(fields: Record<string, string>): Promise<KwaiTokenSet> {
    const url = new URL(`${this.apiBaseUrl()}/oauth2/${fields.grant_type === "refresh_token" ? "refresh_token" : "access_token"}`);
    url.searchParams.set("app_id", this.input.config.appId!);
    url.searchParams.set("app_secret", this.input.config.appSecret!);
    for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
    const response = await this.http()(url.toString());
    const json = await safeJson(response) as {
      result?: number;
      access_token?: string;
      refresh_token?: string;
      open_id?: string;
      scopes?: string[];
      expires_in?: number;
      error_msg?: string;
    };
    if (!response.ok || json.result !== 1 || !json.access_token) {
      throw new Error(`KWAI_OAUTH_TOKEN_FAILED: ${json.error_msg ?? `HTTP ${response.status}`}`);
    }
    return { accessToken: json.access_token, refreshToken: json.refresh_token, openId: json.open_id ?? "", scopes: json.scopes, expiresIn: json.expires_in };
  }

  private async fetchProfile(accessToken: string): Promise<{ displayName?: string; avatarUrl?: string }> {
    const url = new URL(`${this.apiBaseUrl()}/openapi/user_info`);
    url.searchParams.set("app_id", this.input.config.appId!);
    url.searchParams.set("access_token", accessToken);
    const response = await this.http()(url.toString());
    const json = await safeJson(response) as { result?: number; user_info?: { name?: string; head?: string } };
    if (!response.ok || json.result !== 1) return {};
    return { displayName: json.user_info?.name, avatarUrl: json.user_info?.head };
  }

  private credentialReferenceId(tenantId: string, workspaceId: string, openId: string): string {
    return `kwai:${tenantId}:${workspaceId}:${openId}`;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new Error("KWAI_OAUTH_NOT_CONFIGURED: defina KWAI_APP_ID, KWAI_APP_SECRET e KWAI_OAUTH_REDIRECT_URI.");
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
    return this.input.config.apiBaseUrl ?? "https://open.kuaishou.com";
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

export const KWAI_REQUIRED_SCOPES = ["user_info", "user_video_publish"] as const;

export function createDisabledKwaiOAuthService(input: { repository: PublicationRepositoryPort; secretStore: PublicationSecretStoragePort }): KwaiOAuthService {
  return new KwaiOAuthService({ config: { enabled: false, scopes: KWAI_REQUIRED_SCOPES }, repository: input.repository, secretStore: input.secretStore });
}
