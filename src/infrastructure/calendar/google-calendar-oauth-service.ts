import { randomBytes } from "node:crypto";
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

type PendingState = { state: string; tenantId: string; workspaceId: string; userId: string; expiresAt: string };

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * OAuth por USUÁRIO (nunca uma conta corporativa central — seção 0 do relatório do usuário,
 * diferença deliberada em relação ao padrão `<provider>:<tenantId>:<workspaceId>:<subjectId>` já
 * usado por YouTube/TikTok/Meta, que são por TENANT+WORKSPACE). Mesma pilha de armazenamento
 * (`SecretManagerPort` genérico, AES-256-GCM em repouso via `PostgresSecretManager`) — nunca um
 * secret store novo. Referência: `calendar:<tenantId>:<workspaceId>:<userId>`.
 */
export class GoogleCalendarOAuthService {
  private readonly states = new Map<string, PendingState>();

  constructor(
    private readonly input: {
      config: GoogleCalendarOAuthConfig;
      connectionRepository: CalendarConnectionRepositoryPort;
      secretManager: SecretManagerPort;
      httpClient?: typeof fetch;
      now?: () => Date;
    },
  ) {}

  isConfigured(): boolean {
    const { enabled, clientId, clientSecret, redirectUri } = this.input.config;
    return Boolean(enabled && clientId && clientSecret && redirectUri);
  }

  begin(input: { tenantId: string; workspaceId: string; userId: string }): { authorizationUrl: string; state: string } {
    this.assertConfigured();
    const now = this.now();
    this.pruneExpiredStates(now);
    const state = randomBytes(24).toString("base64url");
    this.states.set(state, { state, tenantId: input.tenantId, workspaceId: input.workspaceId, userId: input.userId, expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString() });

    const url = new URL(`${this.authBaseUrl()}/o/oauth2/v2/auth`);
    url.searchParams.set("client_id", this.input.config.clientId!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.input.config.scopes.join(" "));
    url.searchParams.set("state", state);
    // access_type=offline + prompt=consent — garante refresh_token mesmo numa reconexão (seção
    // 2.2 do relatório do usuário: sem isto, o Google só devolve refresh_token na PRIMEIRA vez).
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return { authorizationUrl: url.toString(), state };
  }

  async complete(input: { state: string; code: string }): Promise<CalendarConnection> {
    this.assertConfigured();
    const pending = this.states.get(input.state);
    if (!pending || pending.expiresAt <= this.now().toISOString()) {
      this.states.delete(input.state);
      throw new Error("CALENDAR_OAUTH_STATE_INVALID: state OAuth inválido ou expirado.");
    }
    this.states.delete(input.state);

    const tokens = await this.exchangeCode(input.code);
    const profile = await this.fetchProfile(tokens.accessToken);

    await this.persistTokens({ tenantId: pending.tenantId, workspaceId: pending.workspaceId, userId: pending.userId, tokens });
    return this.input.connectionRepository.upsert({
      tenantId: pending.tenantId,
      workspaceId: pending.workspaceId,
      userId: pending.userId,
      googleEmail: profile.email,
      status: "connected",
    });
  }

  /** Devolve um access token VÁLIDO, refrescando primeiro se necessário (nunca deixa o chamador
   * lidar com expiração). `undefined` = sem conexão/tokens — chamador trata como "não conectado". */
  async getValidAccessToken(input: { tenantId: string; workspaceId: string; userId: string }): Promise<string | undefined> {
    if (!this.isConfigured()) return undefined;
    const secret = await this.input.secretManager.get(this.reference(input));
    const refreshToken = secret?.value.refreshToken;
    if (!refreshToken) return undefined;

    const expiresAt = secret?.expiresAt ? new Date(secret.expiresAt).getTime() : 0;
    // Refresca com folga de 60s antes de expirar de verdade (mesmo racional do relatório, seção 2.2).
    if (secret?.value.accessToken && expiresAt - this.now().getTime() > 60_000) {
      return secret.value.accessToken;
    }

    try {
      const tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      await this.persistTokens({ ...input, tokens: { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken } });
      return tokens.accessToken;
    } catch (error) {
      const connection = await this.input.connectionRepository.getByUser(input);
      if (connection) {
        await this.input.connectionRepository.update(connection.id, { status: "error", lastErrorMessage: error instanceof Error ? error.message : "Falha ao renovar token." });
      }
      return undefined;
    }
  }

  async disconnect(input: { tenantId: string; workspaceId: string; userId: string }): Promise<void> {
    const secret = await this.input.secretManager.get(this.reference(input));
    const token = secret?.value.refreshToken ?? secret?.value.accessToken;
    if (token && this.isConfigured()) await this.revokeToken(token).catch(() => undefined);
    await this.input.secretManager.delete(this.reference(input));

    const connection = await this.input.connectionRepository.getByUser(input);
    if (connection) {
      await this.input.connectionRepository.update(connection.id, {
        status: "disconnected",
        syncToken: null,
        lastErrorMessage: null,
      });
    }
  }

  private async persistTokens(input: { tenantId: string; workspaceId: string; userId: string; tokens: GoogleCalendarTokenSet }): Promise<void> {
    const now = this.now();
    const expiresAt = input.tokens.expiresIn ? new Date(now.getTime() + input.tokens.expiresIn * 1000).toISOString() : undefined;
    await this.input.secretManager.put(this.reference(input), {
      value: definedStrings({ accessToken: input.tokens.accessToken, refreshToken: input.tokens.refreshToken }),
      expiresAt,
    });
  }

  private async exchangeCode(code: string): Promise<GoogleCalendarTokenSet> {
    return this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.input.config.redirectUri! });
  }

  private async tokenRequest(fields: Record<string, string>): Promise<GoogleCalendarTokenSet> {
    const response = await this.http()(`${this.tokenBaseUrl()}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.input.config.clientId!, client_secret: this.input.config.clientSecret!, ...fields }),
    });
    const json = (await safeJson(response)) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !json.access_token) throw new Error(`CALENDAR_OAUTH_TOKEN_FAILED: ${json.error_description ?? json.error ?? `HTTP ${response.status}`}`);
    return { accessToken: json.access_token, refreshToken: json.refresh_token, scope: json.scope, expiresIn: json.expires_in };
  }

  private async fetchProfile(accessToken: string): Promise<{ email?: string }> {
    const response = await this.http()(`${this.userInfoBaseUrl()}/oauth2/v3/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = (await safeJson(response)) as { email?: string };
    return { email: json.email };
  }

  private async revokeToken(token: string): Promise<void> {
    await this.http()(`${this.tokenBaseUrl()}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  }

  private reference(input: { tenantId: string; workspaceId: string; userId: string }): string {
    return `calendar:${input.tenantId}:${input.workspaceId}:${input.userId}`;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) throw new Error("CALENDAR_OAUTH_NOT_CONFIGURED: defina GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET e GOOGLE_CALENDAR_OAUTH_REDIRECT_URI.");
  }

  private pruneExpiredStates(now: Date): void {
    const nowIso = now.toISOString();
    for (const [key, value] of this.states) {
      if (value.expiresAt <= nowIso) this.states.delete(key);
    }
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

export const GOOGLE_CALENDAR_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

function definedStrings(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
