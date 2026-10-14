import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AccessTokenResult, CalendarSyncOAuthPort } from "../../application/calendar/calendar-sync-use-cases.js";
import type { CalendarConnectionRepositoryPort } from "../../application/ports/calendar-connection-repository.port.js";
import type { SecretManagerPort } from "../../application/ports/secret-manager.port.js";
import type { CalendarConnection } from "../../domain/calendar/calendar.model.js";

export type GoogleCalendarOAuthConfig = {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  authBaseUrl?: string;
  tokenBaseUrl?: string;
  userInfoBaseUrl?: string;
  scopes: readonly string[];
};

export type GoogleCalendarTokenSet = { accessToken: string; refreshToken?: string; scope?: string; expiresIn?: number };

/** Escopos mínimos: ler/escrever EVENTOS (não a lista de agendas) + e-mail da conta conectada. */
export const GOOGLE_CALENDAR_REQUIRED_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"] as const;

const STATE_TTL_MS = 10 * 60 * 1000;

/** Falha de refresh que exige reconexão (token revogado/inválido) — nunca uma falha transitória. */
export class GoogleCalendarAuthRevokedError extends Error {}

/**
 * OAuth do Google Calendar POR USUÁRIO. Tokens no `SecretManagerPort` genérico do Core
 * (AES-256-GCM em repouso), referência `calendar:<tenant>:<workspace>:<user>` — nunca um secret
 * store novo.
 *
 * O `state` OAuth é ASSINADO (HMAC, comparação em tempo constante) e carrega quem pediu e quando
 * expira — não depende de memória do processo, então funciona com várias réplicas da API e
 * depois de um restart (o mapa em memória herdado do CMDesk não funcionava).
 */
export class GoogleCalendarOAuthService implements CalendarSyncOAuthPort {
  constructor(
    private readonly input: {
      config: GoogleCalendarOAuthConfig;
      connectionRepository: CalendarConnectionRepositoryPort;
      secretManager: SecretManagerPort;
      stateSigningKey: Buffer;
      httpClient?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  isConfigured(): boolean {
    const { enabled, clientId, clientSecret, redirectUri } = this.input.config;
    return Boolean(enabled && clientId && clientSecret && redirectUri);
  }

  begin(input: { tenantId: string; workspaceId: string; userId: string }): { authorizationUrl: string } {
    this.assertConfigured();
    const payload = Buffer.from(JSON.stringify({ t: input.tenantId, w: input.workspaceId, u: input.userId, e: this.now().getTime() + STATE_TTL_MS, n: randomBytes(8).toString("hex") })).toString("base64url");
    const state = `${payload}.${this.sign(payload)}`;
    const url = new URL(`${this.authBaseUrl()}/o/oauth2/v2/auth`);
    url.searchParams.set("client_id", this.input.config.clientId!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", (this.input.config.scopes.length ? this.input.config.scopes : GOOGLE_CALENDAR_REQUIRED_SCOPES).join(" "));
    url.searchParams.set("state", state);
    // offline + consent: garante refresh_token também numa reconexão.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    return { authorizationUrl: url.toString() };
  }

  /** Valida o `state` e devolve quem iniciou o fluxo. O chamador confere que é a MESMA pessoa logada. */
  verifyState(state: string): { tenantId: string; workspaceId: string; userId: string } {
    const [payload, signature] = state.split(".");
    if (!payload || !signature) throw new Error("CALENDAR_OAUTH_STATE_INVALID: state inválido.");
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error("CALENDAR_OAUTH_STATE_INVALID: state inválido.");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { t: string; w: string; u: string; e: number };
    if (typeof data.e !== "number" || data.e < this.now().getTime()) throw new Error("CALENDAR_OAUTH_STATE_INVALID: state expirado — conecte de novo.");
    return { tenantId: data.t, workspaceId: data.w, userId: data.u };
  }

  async complete(input: { state: string; code: string }): Promise<CalendarConnection> {
    this.assertConfigured();
    const owner = this.verifyState(input.state);
    const tokens = await this.tokenRequest({ grant_type: "authorization_code", code: input.code, redirect_uri: this.input.config.redirectUri! });
    if (!tokens.refreshToken) throw new Error("CALENDAR_OAUTH_NO_REFRESH_TOKEN: o Google não devolveu acesso offline — conecte de novo autorizando o acesso.");
    const profile = await this.fetchProfile(tokens.accessToken);
    await this.persistTokens(owner, tokens);
    return this.input.connectionRepository.upsert({ ...owner, ...(profile.email ? { googleEmail: profile.email } : {}), status: "connected" });
  }

  /**
   * Access token válido (renova com folga de 60 s). Refresh recusado pelo Google (`invalid_grant`,
   * 400/401) = token revogado → `revoked` (a conexão precisa ser refeita). Rede/5xx = `transient`
   * (tenta de novo no próximo ciclo, sem derrubar a conexão).
   */
  async getAccessToken(input: { tenantId: string; workspaceId: string; userId: string }): Promise<AccessTokenResult> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured", message: "Google Calendar não está configurado neste servidor." };
    const secret = await this.input.secretManager.get(this.reference(input));
    const refreshToken = secret?.value.refreshToken;
    if (!refreshToken) return { ok: false, reason: "revoked", message: "Google Calendar precisa ser reconectado." };
    const expiresAt = secret?.expiresAt ? new Date(secret.expiresAt).getTime() : 0;
    if (secret?.value.accessToken && expiresAt - this.now().getTime() > 60_000) return { ok: true, accessToken: secret.value.accessToken };
    try {
      const tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      await this.persistTokens(input, { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken });
      return { ok: true, accessToken: tokens.accessToken };
    } catch (error) {
      if (error instanceof GoogleCalendarAuthRevokedError) return { ok: false, reason: "revoked", message: "Google Calendar precisa ser reconectado." };
      return { ok: false, reason: "transient", message: error instanceof Error ? error.message : "Falha ao renovar o acesso ao Google." };
    }
  }

  async disconnect(input: { tenantId: string; workspaceId: string; userId: string }): Promise<void> {
    const secret = await this.input.secretManager.get(this.reference(input));
    const token = secret?.value.refreshToken ?? secret?.value.accessToken;
    if (token && this.isConfigured()) await this.revokeToken(token).catch(() => undefined);
    await this.input.secretManager.delete(this.reference(input));
    const connection = await this.input.connectionRepository.getByUser(input);
    if (connection) await this.input.connectionRepository.update(connection.id, { status: "disconnected", syncToken: null, lastErrorMessage: null, nextSyncAt: null });
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.input.stateSigningKey).update(`gcal-state:v1:${payload}`).digest("base64url");
  }

  private async persistTokens(owner: { tenantId: string; workspaceId: string; userId: string }, tokens: GoogleCalendarTokenSet): Promise<void> {
    const expiresAt = tokens.expiresIn ? new Date(this.now().getTime() + tokens.expiresIn * 1000).toISOString() : undefined;
    const value: Record<string, string> = { accessToken: tokens.accessToken };
    if (tokens.refreshToken) value.refreshToken = tokens.refreshToken;
    await this.input.secretManager.put(this.reference(owner), { value, ...(expiresAt ? { expiresAt } : {}) });
  }

  private async tokenRequest(fields: Record<string, string>): Promise<GoogleCalendarTokenSet> {
    const response = await this.http()(`${this.tokenBaseUrl()}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.input.config.clientId!, client_secret: this.input.config.clientSecret!, ...fields }),
    });
    const json = (await safeJson(response)) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !json.access_token) {
      const message = `CALENDAR_OAUTH_TOKEN_FAILED: ${json.error_description ?? json.error ?? `HTTP ${response.status}`}`;
      if (json.error === "invalid_grant" || response.status === 400 || response.status === 401) throw new GoogleCalendarAuthRevokedError(message);
      throw new Error(message);
    }
    return { accessToken: json.access_token, ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}), ...(json.scope ? { scope: json.scope } : {}), ...(json.expires_in ? { expiresIn: json.expires_in } : {}) };
  }

  private async fetchProfile(accessToken: string): Promise<{ email?: string }> {
    const response = await this.http()(`${this.userInfoBaseUrl()}/oauth2/v3/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = (await safeJson(response)) as { email?: string };
    return json.email ? { email: json.email } : {};
  }

  private async revokeToken(token: string): Promise<void> {
    await this.http()(`${this.tokenBaseUrl()}/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
  }

  private reference(input: { tenantId: string; workspaceId: string; userId: string }): string {
    return `calendar:${input.tenantId}:${input.workspaceId}:${input.userId}`;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new Error("CALENDAR_OAUTH_NOT_CONFIGURED: defina GOOGLE_CALENDAR_ENABLED, GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET e GOOGLE_CALENDAR_OAUTH_REDIRECT_URI.");
  }

  private authBaseUrl(): string {
    return this.input.config.authBaseUrl ?? "https://accounts.google.com";
  }

  private tokenBaseUrl(): string {
    return this.input.config.tokenBaseUrl ?? "https://oauth2.googleapis.com";
  }

  private userInfoBaseUrl(): string {
    return this.input.config.userInfoBaseUrl ?? "https://openidconnect.googleapis.com";
  }

  private http(): typeof fetch {
    return this.input.httpClient ?? fetch;
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
