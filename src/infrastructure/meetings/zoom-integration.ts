import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SecretManagerPort } from "../../application/ports/secret-manager.port.js";
import type { ZoomAuthPort, ZoomCloudMeeting, ZoomRecordingsPort } from "../../application/meetings/zoom-import.js";

export type ZoomOAuthConfig = { enabled: boolean; clientId?: string; clientSecret?: string; redirectUri?: string; oauthBaseUrl?: string; apiBaseUrl?: string };

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Zoom — OAuth POR USUÁRIO (app "user-managed" do Zoom Marketplace) + gravações em nuvem. Tokens no
 * `SecretManagerPort` do Core (cifrado), referência `zoom:<tenant>:<workspace>:<user>`; o `state`
 * é assinado (HMAC), igual ao Google Calendar. Escopos do app: leitura das gravações em nuvem do
 * próprio usuário (`cloud_recording:read:list_user_recordings`, `cloud_recording:read:recording`)
 * e do perfil (`user:read:user`).
 */
export class ZoomIntegration implements ZoomAuthPort, ZoomRecordingsPort {
  constructor(private readonly input: { config: ZoomOAuthConfig; secretManager: SecretManagerPort; stateSigningKey: Buffer; httpClient?: typeof fetch; now?: () => Date }) {}

  isConfigured(): boolean {
    const { enabled, clientId, clientSecret, redirectUri } = this.input.config;
    return Boolean(enabled && clientId && clientSecret && redirectUri);
  }

  begin(owner: { tenantId: string; workspaceId: string; userId: string }): { authorizationUrl: string } {
    if (!this.isConfigured()) throw new Error("ZOOM_NOT_CONFIGURED: a integração com o Zoom não está configurada neste servidor.");
    const payload = Buffer.from(JSON.stringify({ t: owner.tenantId, w: owner.workspaceId, u: owner.userId, e: this.now().getTime() + STATE_TTL_MS, n: randomBytes(8).toString("hex") })).toString("base64url");
    const url = new URL(`${this.oauthBase()}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.input.config.clientId!);
    url.searchParams.set("redirect_uri", this.input.config.redirectUri!);
    url.searchParams.set("state", `${payload}.${this.sign(payload)}`);
    return { authorizationUrl: url.toString() };
  }

  verifyState(state: string): { tenantId: string; workspaceId: string; userId: string } {
    const [payload, signature] = state.split(".");
    const expected = Buffer.from(this.sign(payload ?? ""));
    const given = Buffer.from(signature ?? "");
    if (!payload || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error("ZOOM_OAUTH_STATE_INVALID: autorização inválida — conecte de novo.");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { t: string; w: string; u: string; e: number };
    if (data.e < this.now().getTime()) throw new Error("ZOOM_OAUTH_STATE_INVALID: autorização expirada — conecte de novo.");
    return { tenantId: data.t, workspaceId: data.w, userId: data.u };
  }

  async complete(input: { state: string; code: string }): Promise<{ email?: string }> {
    const owner = this.verifyState(input.state);
    const tokens = await this.tokenRequest({ grant_type: "authorization_code", code: input.code, redirect_uri: this.input.config.redirectUri! });
    const profile = await this.api<{ email?: string }>("/users/me", tokens.accessToken).catch(() => ({ email: undefined }));
    await this.persist(owner, { ...tokens, ...(profile.email ? { email: profile.email } : {}) });
    return profile.email ? { email: profile.email } : {};
  }

  async status(owner: { tenantId: string; workspaceId: string; userId: string }): Promise<{ configured: boolean; connected: boolean; email?: string }> {
    const secret = await this.input.secretManager.get(this.reference(owner));
    return { configured: this.isConfigured(), connected: Boolean(secret?.value.refreshToken), ...(secret?.value.email ? { email: secret.value.email } : {}) };
  }

  async getAccessToken(owner: { tenantId: string; workspaceId: string; userId: string }): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string; message: string }> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured", message: "A integração com o Zoom não está configurada neste servidor." };
    const secret = await this.input.secretManager.get(this.reference(owner));
    const refreshToken = secret?.value.refreshToken;
    if (!refreshToken) return { ok: false, reason: "revoked", message: "Conecte o Zoom em Meetings → Integrações." };
    const expiresAt = secret.expiresAt ? Date.parse(secret.expiresAt) : 0;
    if (secret.value.accessToken && expiresAt - this.now().getTime() > 60_000) return { ok: true, accessToken: secret.value.accessToken };
    try {
      const tokens = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      await this.persist(owner, { ...tokens, ...(secret.value.email ? { email: secret.value.email } : {}) });
      return { ok: true, accessToken: tokens.accessToken };
    } catch (error) {
      return { ok: false, reason: "revoked", message: error instanceof Error ? error.message : "Reconecte o Zoom." };
    }
  }

  async disconnect(owner: { tenantId: string; workspaceId: string; userId: string }): Promise<void> {
    const secret = await this.input.secretManager.get(this.reference(owner));
    if (secret?.value.accessToken && this.isConfigured()) {
      await this.http()(`${this.oauthBase()}/oauth/revoke?token=${encodeURIComponent(secret.value.accessToken)}`, { method: "POST", headers: { Authorization: this.basic() } }).catch(() => undefined);
    }
    await this.input.secretManager.delete(this.reference(owner));
  }

  async listRecordings(input: { accessToken: string; from: string; to: string }): Promise<ZoomCloudMeeting[]> {
    const meetings: ZoomCloudMeeting[] = [];
    let nextPageToken = "";
    do {
      const query = new URLSearchParams({ from: input.from, to: input.to, page_size: "30", ...(nextPageToken ? { next_page_token: nextPageToken } : {}) });
      const page = await this.api<{ meetings?: ZoomCloudMeeting[]; next_page_token?: string }>(`/users/me/recordings?${query.toString()}`, input.accessToken);
      meetings.push(...(page.meetings ?? []));
      nextPageToken = page.next_page_token ?? "";
    } while (nextPageToken && meetings.length < 300);
    return meetings;
  }

  async getMeetingRecordings(input: { accessToken: string; meetingUuid: string }): Promise<ZoomCloudMeeting | undefined> {
    // UUID com "/" precisa de codificação dupla (regra da API do Zoom).
    const uuid = input.meetingUuid.startsWith("/") || input.meetingUuid.includes("//") ? encodeURIComponent(encodeURIComponent(input.meetingUuid)) : encodeURIComponent(input.meetingUuid);
    try {
      return await this.api<ZoomCloudMeeting>(`/meetings/${uuid}/recordings`, input.accessToken);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ZOOM_HTTP_404")) return undefined;
      throw error;
    }
  }

  async downloadToFile(input: { accessToken: string; downloadUrl: string; targetPath: string; maxBytes: number }): Promise<number> {
    const response = await this.http()(input.downloadUrl, { headers: { Authorization: `Bearer ${input.accessToken}` }, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`ZOOM_DOWNLOAD_FAILED: o Zoom recusou o download (HTTP ${response.status}).`);
    let bytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > input.maxBytes) throw new Error("ZOOM_DOWNLOAD_TOO_LARGE: a gravação do Zoom passa do limite de upload.");
        controller.enqueue(chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body.pipeThrough(counter) as never), createWriteStream(input.targetPath));
    return bytes;
  }

  async downloadText(input: { accessToken: string; downloadUrl: string }): Promise<string> {
    const response = await this.http()(input.downloadUrl, { headers: { Authorization: `Bearer ${input.accessToken}` }, redirect: "follow" });
    if (!response.ok) throw new Error(`ZOOM_DOWNLOAD_FAILED: o Zoom recusou o download (HTTP ${response.status}).`);
    return response.text();
  }

  private async api<T>(path: string, accessToken: string): Promise<T> {
    const response = await this.http()(`${this.apiBase()}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new Error(`ZOOM_HTTP_${response.status}: ${(json as { message?: string }).message ?? "erro na API do Zoom"}`);
    return json;
  }

  private async tokenRequest(fields: Record<string, string>): Promise<{ accessToken: string; refreshToken: string; expiresIn?: number }> {
    const response = await this.http()(`${this.oauthBase()}/oauth/token`, {
      method: "POST",
      headers: { Authorization: this.basic(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
    const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; reason?: string; error?: string };
    if (!response.ok || !json.access_token || !json.refresh_token) throw new Error(`ZOOM_OAUTH_FAILED: ${json.reason ?? json.error ?? `HTTP ${response.status}`}`);
    return { accessToken: json.access_token, refreshToken: json.refresh_token, ...(json.expires_in ? { expiresIn: json.expires_in } : {}) };
  }

  private async persist(owner: { tenantId: string; workspaceId: string; userId: string }, tokens: { accessToken: string; refreshToken: string; expiresIn?: number; email?: string }): Promise<void> {
    await this.input.secretManager.put(this.reference(owner), {
      value: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, ...(tokens.email ? { email: tokens.email } : {}) },
      ...(tokens.expiresIn ? { expiresAt: new Date(this.now().getTime() + tokens.expiresIn * 1000).toISOString() } : {}),
    });
  }

  private reference(owner: { tenantId: string; workspaceId: string; userId: string }): string {
    return `zoom:${owner.tenantId}:${owner.workspaceId}:${owner.userId}`;
  }
  private sign(payload: string): string {
    return createHmac("sha256", this.input.stateSigningKey).update(`zoom-state:v1:${payload}`).digest("base64url");
  }
  private basic(): string {
    return `Basic ${Buffer.from(`${this.input.config.clientId}:${this.input.config.clientSecret}`).toString("base64")}`;
  }
  private oauthBase(): string {
    return this.input.config.oauthBaseUrl ?? "https://zoom.us";
  }
  private apiBase(): string {
    return this.input.config.apiBaseUrl ?? "https://api.zoom.us/v2";
  }
  private http(): typeof fetch {
    return this.input.httpClient ?? fetch;
  }
  private now(): Date {
    return this.input.now?.() ?? new Date();
  }
}
