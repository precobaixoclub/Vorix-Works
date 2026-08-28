import { MessagingProviderError } from "../../../application/ports/messaging-provider.port.js";

/**
 * Cliente HTTP cru do WuzAPI — módulo Conversas (Fase 1). Único arquivo que conhece o formato de
 * requisição/resposta do WuzAPI; `WuzApiMessagingProvider` chama isto e nunca `fetch` diretamente.
 *
 * IMPORTANTE: os paths abaixo seguem o formato documentado do projeto `asternic/wuzapi`
 * (`/session/...`, `/chat/send/...`, header `token` por sessão). Antes de ligar isto contra uma
 * instância real em produção (Fase 1, item de verificação), confirme os paths exatos e o formato
 * de payload contra a versão do WuzAPI efetivamente implantada — este cliente foi escrito a partir
 * da documentação pública do projeto, não testado ainda contra uma instância ao vivo.
 */

export type WuzApiClientConfig = {
  baseUrl: string;
  adminToken: string;
  fetchImpl?: typeof fetch;
};

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

  /** Chamadas administrativas (criar/gerenciar sessão) usam o admin token do container, nunca exposto ao frontend. */
  private async adminRequest<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    return this.request<T>(path, { ...init, headers: { Authorization: this.config.adminToken } });
  }

  /** Chamadas de envio/status usam o token da sessão específica (`externalSessionId` no domínio Vorix). */
  private async sessionRequest<T>(sessionToken: string, path: string, init: { method: string; body?: unknown }): Promise<T> {
    return this.request<T>(path, { ...init, headers: { token: sessionToken } });
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
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  async connectSession(sessionToken: string): Promise<void> {
    await this.sessionRequest(sessionToken, "/session/connect", { method: "POST", body: { Subscribe: ["Message", "ReadReceipt", "Connected", "Disconnected"] } });
  }

  async disconnectSession(sessionToken: string): Promise<void> {
    await this.sessionRequest(sessionToken, "/session/disconnect", { method: "POST" });
  }

  async getSessionStatus(sessionToken: string): Promise<{ connected: boolean; loggedIn: boolean; phoneNumber?: string }> {
    return this.sessionRequest(sessionToken, "/session/status", { method: "GET" });
  }

  async getQrCode(sessionToken: string): Promise<{ qrCode: string }> {
    return this.sessionRequest(sessionToken, "/session/qr", { method: "GET" });
  }

  async sendText(sessionToken: string, input: { phone: string; body: string }): Promise<{ id: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/text", { method: "POST", body: { Phone: input.phone, Body: input.body } });
  }

  async sendImage(sessionToken: string, input: { phone: string; mediaUrl: string; caption?: string }): Promise<{ id: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/image", { method: "POST", body: { Phone: input.phone, Image: input.mediaUrl, Caption: input.caption } });
  }

  async sendAudio(sessionToken: string, input: { phone: string; mediaUrl: string }): Promise<{ id: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/audio", { method: "POST", body: { Phone: input.phone, Audio: input.mediaUrl } });
  }

  async sendVideo(sessionToken: string, input: { phone: string; mediaUrl: string; caption?: string }): Promise<{ id: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/video", { method: "POST", body: { Phone: input.phone, Video: input.mediaUrl, Caption: input.caption } });
  }

  async sendDocument(sessionToken: string, input: { phone: string; mediaUrl: string; fileName: string }): Promise<{ id: string }> {
    return this.sessionRequest(sessionToken, "/chat/send/document", { method: "POST", body: { Phone: input.phone, Document: input.mediaUrl, FileName: input.fileName } });
  }
}
