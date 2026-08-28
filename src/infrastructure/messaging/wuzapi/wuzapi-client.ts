import { MessagingProviderError } from "../../../application/ports/messaging-provider.port.js";

/**
 * Cliente HTTP cru do WuzAPI — módulo Conversas (Fase 1/2). Único arquivo que conhece o formato de
 * requisição/resposta do WuzAPI; `WuzApiMessagingProvider` chama isto e nunca `fetch` diretamente.
 *
 * Contrato CONFIRMADO contra o código-fonte real de `asternic/wuzapi` (routes.go, README.md,
 * API.md, wmiau.go, rabbitmq.go — via pesquisa direta no repositório, Fase 2 pré-spike):
 *  - toda resposta vem envelopada em `{ code, data, success }` — `request()` já desembrulha `data`.
 *  - admin e sessão usam o MESMO header `Authorization` (nunca um header `token` customizado).
 *  - `/session/connect` NÃO funciona sozinho — a sessão precisa existir antes via
 *    `POST /admin/users` (admin token), escolhendo o `token` da sessão e o `name` (usado como
 *    `instanceName` no evento do RabbitMQ — por isso `createAdminUser` recebe `name` = o
 *    `MessagingConnection.id` do Vorix, permitindo correlacionar o evento de volta por id direto,
 *    sem precisar de um índice por token).
 *  - Campos de resposta são PascalCase (`QRCode`, `Connected`, `LoggedIn`, `Id`, `Timestamp`).
 *  - `/session/status` NÃO retorna telefone — o JID pareado só aparece na resposta de
 *    `/session/connect` (`data.jid`, formato `"<telefone>.<device>:<agent>@s.whatsapp.net"`).
 *  - `/session/logout` é um endpoint DISTINTO de `/session/disconnect` — logout revoga a sessão de
 *    verdade (o usuário precisaria escanear QR de novo); disconnect só derruba o socket.
 *
 * AINDA NÃO CONFIRMADO (pendência do spike com instância real, ver
 * docs/conversas-fase2-spike.md): os nomes exatos dos campos de `sendImage`/`sendAudio`/
 * `sendVideo`/`sendDocument` — só `sendText` aparece com exemplo completo na documentação
 * (`Phone`/`Body`/`Id` opcional). Os demais seguem o mesmo padrão PascalCase por analogia, mas
 * precisam ser validados contra a instância real antes de confiar em produção.
 */

export type WuzApiClientConfig = {
  baseUrl: string;
  adminToken: string;
  fetchImpl?: typeof fetch;
};

type WuzApiEnvelope<T> = { code: number; data: T; success: boolean };

function classifyHttpError(status: number, body: string): MessagingProviderError {
  if (status === 401 || status === 403) return new MessagingProviderError("auth", `WuzAPI recusou autenticação (status ${status}): ${body}`);
  if (status === 429) return new MessagingProviderError("rate_limit", `WuzAPI rate limit (status ${status}): ${body}`);
  if (status >= 500 || status === 408) return new MessagingProviderError("transient", `WuzAPI indisponível (status ${status}): ${body}`);
  return new MessagingProviderError("permanent", `WuzAPI rejeitou a requisição (status ${status}): ${body}`);
}

export class WuzApiClient {
  constructor(private readonly config: WuzApiClientConfig) {}

  private get fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  /** Chamadas administrativas (criar/gerenciar usuário/sessão) usam o admin token do container, nunca exposto ao frontend. */
  private async adminRequest<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    return this.request<T>(path, { ...init, headers: { Authorization: this.config.adminToken } });
  }

  /** Chamadas de sessão (status/QR/envio) usam o token daquela sessão (`externalSessionId` no domínio Vorix) — mesmo header `Authorization`, valor diferente. */
  private async sessionRequest<T>(sessionToken: string, path: string, init: { method: string; body?: unknown }): Promise<T> {
    return this.request<T>(path, { ...init, headers: { Authorization: sessionToken } });
  }

  private async request<T>(path: string, init: { method: string; body?: unknown; headers: Record<string, string> }): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method: init.method,
        headers: { "content-type": "application/json", ...init.headers },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (error) {
      throw new MessagingProviderError("transient", `WuzAPI inalcançável: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    if (!response.ok) throw classifyHttpError(response.status, text);
    if (!text) return undefined as T;
    const envelope = JSON.parse(text) as WuzApiEnvelope<T>;
    return envelope.data;
  }

  /**
   * Provisiona a sessão no WuzAPI (admin API) — passo que faltava inteiramente na Fase 1.
   * `name` é o `MessagingConnection.id` do Vorix: vira `instanceName` no evento publicado no
   * RabbitMQ, permitindo `RawEventConsumer` correlacionar por id direto (`getById`), sem precisar
   * de índice por token. `token` é o valor que este mesmo processo vai usar depois como
   * `externalSessionId`/`Authorization` em toda chamada de sessão.
   */
  async createAdminUser(input: { name: string; token: string; webhookUrl?: string; events?: string[] }): Promise<{ id: number }> {
    return this.adminRequest("/admin/users", {
      method: "POST",
      body: { name: input.name, token: input.token, webhook: input.webhookUrl, events: (input.events ?? ["Message", "ReadReceipt", "Connected", "Disconnected", "LoggedOut"]).join(",") },
    });
  }

  async connectSession(sessionToken: string, input: { subscribe?: string[]; immediate?: boolean } = {}): Promise<{ jid?: string }> {
    return this.sessionRequest(sessionToken, "/session/connect", {
      method: "POST",
      body: { Subscribe: input.subscribe ?? ["Message", "ReadReceipt", "Connected", "Disconnected", "LoggedOut"], Immediate: input.immediate ?? false },
    });
  }

  async disconnectSession(sessionToken: string): Promise<void> {
    await this.sessionRequest(sessionToken, "/session/disconnect", { method: "POST" });
  }

  /** Distinto de `disconnectSession` — revoga a sessão de verdade (precisa escanear QR de novo). */
  async logoutSession(sessionToken: string): Promise<void> {
    await this.sessionRequest(sessionToken, "/session/logout", { method: "POST" });
  }

  async getSessionStatus(sessionToken: string): Promise<{ Connected: boolean; LoggedIn: boolean }> {
    return this.sessionRequest(sessionToken, "/session/status", { method: "GET" });
  }

  async getQrCode(sessionToken: string): Promise<{ QRCode: string }> {
    return this.sessionRequest(sessionToken, "/session/qr", { method: "GET" });
  }

  async sendText(sessionToken: string, input: { phone: string; body: string }): Promise<{ Id: string; Timestamp: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/text", { method: "POST", body: { Phone: input.phone, Body: input.body } });
  }

  // PENDENTE DE CONFIRMAÇÃO (ver comentário no topo do arquivo) — nomes de campo por analogia com sendText.
  async sendImage(sessionToken: string, input: { phone: string; mediaUrl: string; caption?: string }): Promise<{ Id: string; Timestamp: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/image", { method: "POST", body: { Phone: input.phone, Image: input.mediaUrl, Caption: input.caption } });
  }

  async sendAudio(sessionToken: string, input: { phone: string; mediaUrl: string }): Promise<{ Id: string; Timestamp: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/audio", { method: "POST", body: { Phone: input.phone, Audio: input.mediaUrl } });
  }

  async sendVideo(sessionToken: string, input: { phone: string; mediaUrl: string; caption?: string }): Promise<{ Id: string; Timestamp: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/video", { method: "POST", body: { Phone: input.phone, Video: input.mediaUrl, Caption: input.caption } });
  }

  async sendDocument(sessionToken: string, input: { phone: string; mediaUrl: string; fileName: string }): Promise<{ Id: string; Timestamp: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/document", { method: "POST", body: { Phone: input.phone, Document: input.mediaUrl, FileName: input.fileName } });
  }
}
