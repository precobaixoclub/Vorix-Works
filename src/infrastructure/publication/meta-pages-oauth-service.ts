import { randomBytes } from "node:crypto";
import type { CredentialGovernanceActor, CredentialGovernanceService } from "../../application/credential/credential-governance-service.js";
import type { PublicationRepositoryPort } from "../../application/ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../../application/publication/publication-secret-store.js";
import type { AuditContext } from "../../domain/credential/credential.model.js";
import type { PublicationCredentialReference } from "../../domain/publication/publication.model.js";

export type MetaPagesOAuthConfig = {
  enabled: boolean;
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  graphBaseUrl?: string;
  scopes: readonly string[];
};

export type MetaPagesOAuthState = {
  state: string;
  tenantId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
};

export type MetaPagesOAuthStatus = {
  connected: boolean;
  providerId: "meta_pages_sandbox";
  credentialReferences: readonly PublicationCredentialReference[];
  telemetry: MetaPagesOAuthTelemetry;
};

export type MetaPagesOAuthTelemetry = {
  oauthSuccess: number;
  oauthFailure: number;
  tokenRefreshSuccess: number;
  tokenRefreshFailure: number;
  lastFailureCode?: string;
};

export class MetaPagesOAuthService {
  private readonly states = new Map<string, MetaPagesOAuthState>();
  private telemetry: MetaPagesOAuthTelemetry = { oauthSuccess: 0, oauthFailure: 0, tokenRefreshSuccess: 0, tokenRefreshFailure: 0 };

  constructor(
    private readonly input: {
      config: MetaPagesOAuthConfig;
      repository: PublicationRepositoryPort;
      secretStore: PublicationSecretStoragePort;
      credentialGovernanceService?: CredentialGovernanceService;
      httpClient?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  begin(input: { tenantId: string; workspaceId: string }): { authorizationUrl: string; state: string; expiresAt: string } {
    this.assertConfigured();
    const state = randomBytes(24).toString("base64url");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    this.states.set(state, { state, tenantId: input.tenantId, workspaceId: input.workspaceId, createdAt: now.toISOString(), expiresAt });
    const url = new URL(`${this.oauthDialogBaseUrl()}/dialog/oauth`);
    url.searchParams.set("client_id", this.input.config.appId!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.input.config.scopes.join(","));
    return { authorizationUrl: url.toString(), state, expiresAt };
  }

  async complete(input: { state: string; code: string; actor?: CredentialGovernanceActor; context?: AuditContext }): Promise<{ credentialReferenceId: string; providerSubjectId: string }> {
    this.assertConfigured();
    const state = this.states.get(input.state);
    if (!state || state.expiresAt <= this.now().toISOString()) {
      this.recordOAuthFailure("PUBLICATION_OAUTH_STATE_INVALID");
      throw new Error("PUBLICATION_OAUTH_STATE_INVALID: state OAuth inválido ou expirado.");
    }
    this.states.delete(input.state);

    let token: { accessToken: string; expiresIn?: number };
    let longLived: { accessToken: string; expiresIn?: number };
    let page: { pageId: string; pageAccessToken: string };
    try {
      token = await this.exchangeCode(input.code);
      longLived = await this.exchangeLongLivedToken(token.accessToken);
      this.telemetry = { ...this.telemetry, tokenRefreshSuccess: this.telemetry.tokenRefreshSuccess + 1 };
      page = await this.resolveFirstPage(longLived.accessToken);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PUBLICATION_OAUTH_TOKEN_FAILED")) {
        this.telemetry = { ...this.telemetry, tokenRefreshFailure: this.telemetry.tokenRefreshFailure + 1 };
      }
      this.recordOAuthFailure(error instanceof Error ? error.message.split(":")[0] : "PUBLICATION_OAUTH_FAILED");
      throw error;
    }
    const credentialReferenceId = `meta-pages-sandbox:${state.tenantId}:${state.workspaceId}:${page.pageId}`;
    const now = this.now().toISOString();
    const expiresAt = longLived.expiresIn ? new Date(this.now().getTime() + longLived.expiresIn * 1000).toISOString() : undefined;

    await this.input.secretStore.put({
      credentialReferenceId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      providerId: "meta_pages_sandbox",
      expiresAt,
      value: {
        accessToken: longLived.accessToken,
        pageAccessToken: page.pageAccessToken,
        pageId: page.pageId,
      },
      createdAt: now,
      updatedAt: now,
    });
    await this.input.repository.createCredentialReference({
      credentialReferenceId,
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      providerId: "meta_pages_sandbox",
      status: "active",
      environment: "sandbox",
      providerSubjectId: page.pageId,
      scopes: this.input.config.scopes,
      expiresAt,
      lastRefreshedAt: now,
    });
    await this.input.credentialGovernanceService?.registerOAuthCredential({
      tenantId: state.tenantId,
      workspaceId: state.workspaceId,
      providerId: "meta_pages_sandbox",
      environment: "sandbox",
      credentialReferenceId,
      providerSubjectId: page.pageId,
      grantedScopes: this.input.config.scopes,
      expiresAt,
      actor: input.actor,
      context: input.context,
    });
    this.telemetry = { ...this.telemetry, oauthSuccess: this.telemetry.oauthSuccess + 1 };
    return { credentialReferenceId, providerSubjectId: page.pageId };
  }

  async disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; actor?: CredentialGovernanceActor; context?: AuditContext; reason?: string }): Promise<boolean> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "meta_pages_sandbox" });
    const reference = references.find((candidate) => candidate.credentialReferenceId === input.credentialReferenceId);
    if (!reference) return false;
    if (this.input.credentialGovernanceService && input.actor) {
      const credential = await this.input.credentialGovernanceService.get({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        credentialId: `credential:${input.tenantId}:${input.workspaceId}:meta_pages_sandbox`,
      });
      await this.input.credentialGovernanceService.revoke({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        credentialId: credential.credential.id,
        actor: input.actor,
        context: input.context,
        reason: input.reason ?? "OAuth disconnect",
      });
      return true;
    }
    await this.input.secretStore.delete({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "meta_pages_sandbox", credentialReferenceId: input.credentialReferenceId });
    await this.input.repository.createCredentialReference({ ...reference, status: "revoked", revokedAt: this.now().toISOString() });
    return true;
  }

  async status(input: { tenantId: string; workspaceId: string }): Promise<MetaPagesOAuthStatus> {
    const references = await this.input.repository.listCredentialReferences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: "meta_pages_sandbox" });
    const active = references.find((reference) => reference.status === "active");
    return { connected: !!active, providerId: "meta_pages_sandbox", credentialReferences: references, telemetry: this.telemetry };
  }

  private async exchangeCode(code: string): Promise<{ accessToken: string; expiresIn?: number }> {
    const url = new URL(`${this.graphBaseUrl()}/oauth/access_token`);
    url.searchParams.set("client_id", this.input.config.appId!);
    url.searchParams.set("client_secret", this.input.config.appSecret!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("code", code);
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
    const json = await response.json() as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!response.ok || !json.access_token) throw new Error(`PUBLICATION_OAUTH_TOKEN_FAILED: ${json.error?.message ?? "Meta token exchange falhou."}`);
    return { accessToken: json.access_token, expiresIn: json.expires_in };
  }

  private async resolveFirstPage(userAccessToken: string): Promise<{ pageId: string; pageAccessToken: string }> {
    const url = new URL(`${this.graphBaseUrl()}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token");
    url.searchParams.set("access_token", userAccessToken);
    const response = await this.http()(url.toString());
    const json = await response.json() as { data?: Array<{ id?: string; access_token?: string }>; error?: { message?: string } };
    const page = json.data?.find((candidate) => candidate.id && candidate.access_token);
    if (!response.ok || !page?.id || !page.access_token) throw new Error(`PUBLICATION_OAUTH_PAGE_FAILED: ${json.error?.message ?? "Nenhuma test page encontrada para o OAuth Meta."}`);
    return { pageId: page.id, pageAccessToken: page.access_token };
  }

  private assertConfigured(): void {
    if (!this.input.config.enabled || !this.input.config.appId || !this.input.config.appSecret || !this.input.config.redirectUri) {
      throw new Error("PUBLICATION_OAUTH_NOT_CONFIGURED: Meta Pages Sandbox OAuth não configurado.");
    }
  }

  private graphBaseUrl(): string {
    return this.input.config.graphBaseUrl ?? "https://graph.facebook.com/v20.0";
  }

  private oauthDialogBaseUrl(): string {
    const base = this.input.config.graphBaseUrl;
    if (!base || base.includes("graph.facebook.com")) return "https://www.facebook.com/v20.0";
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

export function createDisabledMetaPagesOAuthService(input: { repository: PublicationRepositoryPort; secretStore: PublicationSecretStoragePort }): MetaPagesOAuthService {
  return new MetaPagesOAuthService({ config: { enabled: false, scopes: [] }, repository: input.repository, secretStore: input.secretStore });
}
