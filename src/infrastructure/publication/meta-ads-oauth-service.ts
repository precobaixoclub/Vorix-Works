import { createHash, randomBytes } from "node:crypto";
import type { SecretManagerPort } from "../../application/ports/secret-manager.port.js";
import type {
  MetaAdsCredentialReference,
  MetaAdsCredentialRepositoryPort,
} from "../../application/ports/meta-ads-credential-repository.port.js";
import type { MetaAdAccountRepositoryPort } from "../../application/ports/meta-ad-account-repository.port.js";
import { META_GRAPH_BASE_URL, META_OAUTH_DIALOG_BASE_URL, metaGraphRequest, toActAccountId } from "../meta/meta-graph-client.js";

/**
 * OAuth 2.0 (Facebook Login, com PKCE) para o módulo Meta Ads Manager — Fase 1.
 *
 * DELIBERADAMENTE uma Configuração de Login/fluxo SEPARADO de `MetaInstagramOAuthService`: aquele
 * já está em produção pedindo escopos de publicação de conteúdo (`pages_manage_posts`,
 * `instagram_business_content_publish`); pedir também `ads_management`/`business_management` na
 * MESMA tela de consentimento arriscaria o usuário recusar o pacote inteiro, ou exigir uma nova
 * revisão de escopo em produção para uma conexão que talvez nem use anúncios. Mesma técnica (PKCE,
 * troca de longa duração), credencial e armazenamento de token totalmente isolados.
 *
 * O valor do token nunca fica em texto puro em nenhuma tabela — vive cifrado no
 * `SecretManagerPort` genérico (mesmo mecanismo AES-256-GCM já usado pelas chaves de provedor de
 * IA), sob a referência `meta-ads:<tenantId>:<workspaceId>:<credentialReferenceId>`.
 */

export const META_ADS_REQUIRED_SCOPES = ["ads_management", "ads_read", "business_management"] as const;

export type MetaAdsOAuthConfig = {
  enabled: boolean;
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  loginConfigId?: string;
  scopes: readonly string[];
};

type PendingState = {
  state: string;
  tenantId: string;
  workspaceId: string;
  codeVerifier: string;
  expiresAt: string;
};

export type MetaAdsConnectedAccount = {
  accountId: string;
  name: string;
  currency: string;
  accountStatus?: number;
  businessName?: string;
};

export type MetaAdsOAuthStatus = {
  connected: boolean;
  configured: boolean;
  credentialReferences: readonly MetaAdsCredentialReference[];
};

const STATE_TTL_MS = 10 * 60 * 1000;
const SECRET_REFERENCE_PREFIX = "meta-ads";

function secretReference(tenantId: string, workspaceId: string, credentialReferenceId: string): string {
  return `${SECRET_REFERENCE_PREFIX}:${tenantId}:${workspaceId}:${credentialReferenceId}`;
}

export class MetaAdsOAuthService {
  private readonly states = new Map<string, PendingState>();

  constructor(
    private readonly input: {
      config: MetaAdsOAuthConfig;
      credentialRepository: MetaAdsCredentialRepositoryPort;
      adAccountRepository: MetaAdAccountRepositoryPort;
      secretManager: SecretManagerPort;
      httpClient?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  isConfigured(): boolean {
    const { enabled, appId, appSecret, redirectUri } = this.input.config;
    return !!(enabled && appId && appSecret && redirectUri);
  }

  /** Passo 1 — URL de autorização do Meta (com PKCE) pedindo os escopos de anúncios. */
  begin(input: { tenantId: string; workspaceId: string }): { authorizationUrl: string; state: string; expiresAt: string } {
    this.assertConfigured();
    const now = this.now();
    this.pruneExpiredStates(now);
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();
    this.states.set(state, { state, tenantId: input.tenantId, workspaceId: input.workspaceId, codeVerifier, expiresAt });

    const url = new URL(`${META_OAUTH_DIALOG_BASE_URL}/dialog/oauth`);
    url.searchParams.set("client_id", this.input.config.appId!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    if (this.input.config.loginConfigId) {
      url.searchParams.set("config_id", this.input.config.loginConfigId);
    } else {
      url.searchParams.set("scope", this.input.config.scopes.join(","));
    }
    url.searchParams.set("code_challenge", createHash("sha256").update(codeVerifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), state, expiresAt };
  }

  /** Passo 2 — troca o `code` (curta duração) por um token de longa duração, e SÓ ENTÃO descobre
   * as contas de anúncio. Correção #3 do pacote de referência analisado: nunca assumir 60 dias sem
   * ter feito a segunda troca (`fb_exchange_token`). */
  async complete(input: { state: string; code: string }): Promise<{ credentialReferenceId: string; accounts: readonly MetaAdsConnectedAccount[] }> {
    this.assertConfigured();
    const pending = this.states.get(input.state);
    if (!pending || pending.expiresAt <= this.now().toISOString()) {
      this.states.delete(input.state);
      throw new Error("META_ADS_OAUTH_STATE_INVALID: state OAuth inválido ou expirado.");
    }
    this.states.delete(input.state);

    const shortLived = await this.exchangeCode(input.code, pending.codeVerifier);
    const longLived = await this.exchangeLongLivedToken(shortLived.accessToken);
    const me = await metaGraphRequest<{ id?: string }>("/me", { accessToken: longLived.accessToken, fetchImpl: this.input.httpClient });
    if (!me.id) throw new Error("META_ADS_OAUTH_ME_FAILED: não foi possível identificar o usuário autorizado.");

    const credentialReferenceId = `meta_ads:${pending.tenantId}:${pending.workspaceId}:${me.id}`;
    const nowIso = this.now().toISOString();
    const expiresAt = longLived.expiresIn ? new Date(this.now().getTime() + longLived.expiresIn * 1000).toISOString() : undefined;

    await this.input.secretManager.put(secretReference(pending.tenantId, pending.workspaceId, credentialReferenceId), {
      value: { accessToken: longLived.accessToken, providerSubjectId: me.id },
      expiresAt,
    });
    await this.input.credentialRepository.upsertCredentialReference({
      credentialReferenceId,
      tenantId: pending.tenantId,
      workspaceId: pending.workspaceId,
      providerId: "meta_ads",
      status: "active",
      environment: "production",
      providerSubjectId: me.id,
      scopes: [...this.input.config.scopes],
      lastRefreshedAt: nowIso,
      expiresAt,
    });

    const accounts = await this.syncAdAccounts({ tenantId: pending.tenantId, workspaceId: pending.workspaceId, credentialReferenceId, accessToken: longLived.accessToken });
    return { credentialReferenceId, accounts };
  }

  /** Descobre (paginado) TODAS as contas de anúncio do token e sincroniza `meta_ad_accounts` —
   * chamado após `complete()` e disponível para resync manual (`POST /accounts/sync`). */
  async syncAdAccounts(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; accessToken: string }): Promise<readonly MetaAdsConnectedAccount[]> {
    const raw = await this.fetchAllAdAccounts(input.accessToken);
    const accounts: MetaAdsConnectedAccount[] = [];
    for (const account of raw) {
      if (!account.id) continue;
      await this.input.adAccountRepository.upsertAccount({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        credentialReferenceId: input.credentialReferenceId,
        accountId: toActAccountId(account.id),
        name: account.name ?? account.business_name ?? toActAccountId(account.id),
        currency: account.currency ?? "USD",
        accountStatus: account.account_status,
        businessName: account.business_name,
        timezoneName: account.timezone_name,
        isActive: true,
      });
      accounts.push({ accountId: toActAccountId(account.id), name: account.name ?? toActAccountId(account.id), currency: account.currency ?? "USD", accountStatus: account.account_status, businessName: account.business_name });
    }
    await this.input.adAccountRepository.deactivateMissing({ credentialReferenceId: input.credentialReferenceId, keepAccountIds: accounts.map((account) => account.accountId) });
    return accounts;
  }

  /** Resync manual — resolve o token cifrado internamente (a rota nunca vê o valor) e reusa
   * `syncAdAccounts`. Mesmo caminho que `complete()` usa logo após conectar; exposto à parte para
   * o caso de vincular uma conta nova a um Business Manager já conectado sem esperar o próximo
   * tick do scheduler (Fase 2). */
  async resyncAccounts(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<readonly MetaAdsConnectedAccount[]> {
    const reference = await this.input.credentialRepository.getCredentialReference(input.credentialReferenceId);
    if (!reference || reference.tenantId !== input.tenantId || reference.workspaceId !== input.workspaceId || reference.status !== "active") {
      throw new Error("META_ADS_CREDENTIAL_NOT_ACTIVE: esta conexão não está ativa — reconecte antes de sincronizar.");
    }
    const secret = await this.input.secretManager.get(secretReference(input.tenantId, input.workspaceId, input.credentialReferenceId));
    const accessToken = secret?.value.accessToken;
    if (!accessToken) throw new Error("META_ADS_TOKEN_MISSING: token não encontrado para esta conexão — reconecte.");
    const accounts = await this.syncAdAccounts({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: input.credentialReferenceId, accessToken });
    await this.input.credentialRepository.touchLastRefreshed(input.credentialReferenceId);
    return accounts;
  }

  async status(input: { tenantId: string; workspaceId: string }): Promise<MetaAdsOAuthStatus> {
    const references = await this.input.credentialRepository.listCredentialReferencesByWorkspace(input);
    return { connected: references.some((reference) => reference.status === "active"), configured: this.isConfigured(), credentialReferences: references };
  }

  /** Remove a conexão deste workspace sem revogar a autorização global do app no Meta (o usuário
   * pode continuar autorizado pra outro tenant/workspace). */
  async disconnect(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<boolean> {
    const reference = await this.input.credentialRepository.getCredentialReference(input.credentialReferenceId);
    if (!reference || reference.tenantId !== input.tenantId || reference.workspaceId !== input.workspaceId) return false;
    await this.input.secretManager.delete(secretReference(input.tenantId, input.workspaceId, input.credentialReferenceId));
    await this.input.credentialRepository.updateStatus(input.credentialReferenceId, "revoked");
    return true;
  }

  private async fetchAllAdAccounts(accessToken: string): Promise<Array<{ id?: string; name?: string; account_id?: string; currency?: string; account_status?: number; business_name?: string; timezone_name?: string }>> {
    const results: Array<{ id?: string; name?: string; account_id?: string; currency?: string; account_status?: number; business_name?: string; timezone_name?: string }> = [];
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const response = await metaGraphRequest<{ data?: typeof results; paging?: { cursors?: { after?: string } } }>("/me/adaccounts", {
        accessToken,
        params: { fields: "id,name,account_id,currency,account_status,business_name,timezone_name", limit: 100, ...(after ? { after } : {}) },
        fetchImpl: this.input.httpClient,
      });
      results.push(...(response.data ?? []));
      after = response.paging?.cursors?.after;
      if (!after || !response.data || response.data.length === 0) break;
    }
    return results;
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<{ accessToken: string; expiresIn?: number }> {
    return this.tokenRequest({ code, code_verifier: codeVerifier, redirect_uri: this.input.config.redirectUri! });
  }

  private async exchangeLongLivedToken(accessToken: string): Promise<{ accessToken: string; expiresIn?: number }> {
    return this.tokenRequest({ grant_type: "fb_exchange_token", fb_exchange_token: accessToken });
  }

  private async tokenRequest(extraParams: Record<string, string>): Promise<{ accessToken: string; expiresIn?: number }> {
    const url = new URL(`${META_GRAPH_BASE_URL}/oauth/access_token`);
    url.searchParams.set("client_id", this.input.config.appId!);
    url.searchParams.set("client_secret", this.input.config.appSecret!);
    for (const [key, value] of Object.entries(extraParams)) url.searchParams.set(key, value);
    const response = await (this.input.httpClient ?? fetch)(url.toString());
    const json = (await safeJson(response)) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!response.ok || !json.access_token) throw new Error(`META_ADS_OAUTH_TOKEN_FAILED: ${json.error?.message ?? "Meta token exchange falhou."}`);
    return { accessToken: json.access_token, expiresIn: json.expires_in };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new Error("META_ADS_OAUTH_NOT_CONFIGURED: defina META_ADS_APP_ID, META_ADS_APP_SECRET e META_ADS_OAUTH_REDIRECT_URI.");
  }

  private pruneExpiredStates(now: Date): void {
    const nowIso = now.toISOString();
    for (const [key, value] of this.states) {
      if (value.expiresAt <= nowIso) this.states.delete(key);
    }
  }

  private now(): Date {
    return this.input.now?.() ?? new Date();
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
