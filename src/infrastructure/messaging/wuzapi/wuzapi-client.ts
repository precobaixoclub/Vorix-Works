import { MessagingProviderError } from "../../../application/ports/messaging-provider.port.js";

/**
 * Cliente HTTP cru do WuzAPI — módulo Conversas (Fase 1/2). Único arquivo que conhece o formato de
 * requisição/resposta do WuzAPI; `WuzApiMessagingProvider` chama isto e nunca `fetch` diretamente.
 *
 * Contrato CONFIRMADO CONTRA UMA INSTÂNCIA REAL (spike Fase 2, `asternic/wuzapi` v1.0.8) — supera
 * a pesquisa de código-fonte/documentação pública que motivou a primeira versão deste arquivo,
 * que acertou várias coisas mas errou duas importantes:
 *  - toda resposta vem envelopada em `{ code, data, success }` — `request()` já desembrulha `data`.
 *  - **admin usa header `Authorization`; chamadas de SESSÃO (`/session/*`, `/chat/*`) usam um
 *    header CUSTOMIZADO `token`, não `Authorization`** — a documentação pública dizia que os dois
 *    usavam `Authorization`; ao vivo, `/session/status` com `Authorization` devolve 401, com
 *    `token` devolve 200. Confirmado por curl direto contra o container antes de corrigir aqui.
 *  - `/session/connect` NÃO funciona sozinho — a sessão precisa existir antes via
 *    `POST /admin/users` (admin token), escolhendo o `token` da sessão e o `name` (usado como
 *    `instanceName` no evento do RabbitMQ — por isso `createAdminUser` recebe `name` = o
 *    `MessagingConnection.id` do Vorix, permitindo correlacionar o evento de volta por id direto,
 *    sem precisar de um índice por token). Confirmado: cria a linha em `users` no Postgres do
 *    WuzAPI com `name`/`token` exatamente como enviados.
 *  - **Campos de resposta são um MIX, não uniformemente PascalCase** — `/session/qr` devolve
 *    `data.QRCode` (PascalCase, confirmado), mas `/session/status` e `/session/connect` devolvem
 *    `data.connected`/`data.loggedIn`/`data.jid`/`data.details`/`data.events`/`data.webhook`
 *    (lowercase/camelCase) — a documentação pública mostrava exemplo PascalCase para essas duas
 *    rotas, que NÃO bate com esta versão ao vivo.
 *  - `/session/status` JÁ retorna `jid` (vazio antes de parear, preenchido depois) — ao contrário
 *    do que a documentação pública sugeria (só em `/session/connect`).
 *  - `/session/logout` é um endpoint DISTINTO de `/session/disconnect` — logout revoga a sessão de
 *    verdade (o usuário precisaria escanear QR de novo); disconnect só derruba o socket. Ainda não
 *    testado ao vivo (pendência do restante do spike).
 *  - **Nem todo HTTP 500 é transitório** — confirmado ao vivo que `/chat/send/text` devolve 500
 *    tanto para "no session" (container reiniciou, socket perdido) quanto para "the store doesn't
 *    contain a device JID" (sessão nunca foi pareada/perdeu o pareamento) — os dois exigem
 *    reautenticação (reconectar ou escanear QR de novo), NUNCA resolvidos por retry. Classificar
 *    esses dois como status 500 genérico faria o worker gastar a escada de retry inteira (~380s)
 *    numa causa que retry nenhum resolve — `classifyHttpError` já detecta esse padrão no corpo da
 *    resposta e classifica como `session_logged_out` em vez de `transient`.
 *
 * AINDA NÃO CONFIRMADO (pendência do restante do spike, ver docs/conversas-fase2-spike.md): os
 * nomes exatos dos campos de `sendImage`/`sendAudio`/`sendVideo`/`sendDocument`, e se `sendText`
 * (`{ Phone, Body }`, PascalCase, único endpoint testado ao vivo até agora) representa o padrão de
 * TODAS as rotas de envio ou só desta — dado o mix de casing já encontrado em `/session/*`, não dá
 * mais para assumir por analogia sem testar cada uma. Também não confirmado: se existem OUTRAS
 * mensagens de erro de "sessão não autenticada" além das duas listadas acima.
 *
 * CONFIRMADO (redesign operacional — mídia real, `downloadMedia` abaixo) — lendo o código-fonte
 * REAL do handler (`asternic/wuzapi`, `handlers.go`) e da função que ele chama por baixo
 * (`tulir/whatsmeow`, `download.go`, `Client.Download()`), não mais só a documentação pública:
 * `POST /chat/downloadimage`/`downloadvideo`/`downloadaudio`/`downloaddocument` recebem
 * `{ Url, DirectPath, MediaKey, Mimetype, FileSHA256, FileLength, FileEncSHA256 }` (a struct do
 * WuzAPI não tem tags `json:"..."`, então o decoder do Go casa por nome case-insensitive — o
 * casing exato do payload de saída não importa, mas os NOMES dos campos sim). Resposta:
 * `{"Mimetype": ..., "Data": "data:<mime>;base64,<...>"}` — `Data` é uma DATA URL completa (pacote
 * Go `vincent-petithory/dataurl`), não base64 puro — `extractBase64Payload` remove o prefixo.
 * `DirectPath` é o campo CRÍTICO: `Client.Download()` do whatsmeow checa só
 * `len(msg.GetDirectPath()) == 0` (nunca olha `URL`) e retorna `"no url present"` se estiver
 * vazio — esta é a causa raiz real de 100% das tentativas de download falharem em produção antes
 * desta correção (`docs/conversas-inbox-organization-media-runtime.md` documentava isso como
 * ainda não resolvido; encontrado e corrigido lendo o código-fonte real dos dois projetos).
 */

export type WuzApiClientConfig = {
  baseUrl: string;
  adminToken: string;
  fetchImpl?: typeof fetch;
};

type WuzApiEnvelope<T> = { code: number; data: T; success: boolean };

/** Fragmentos confirmados ao vivo (spike Fase 2) que indicam sessão não autenticada — reconectar
 * ou escanear QR de novo, NUNCA resolvido por retry. Case-insensitive, checado no corpo bruto da
 * resposta antes de cair no fallback genérico por status HTTP. */
const SESSION_LOGGED_OUT_PATTERNS = ["no session", "doesn't contain a device jid", "not logged in", "not connected"];

function classifyHttpError(status: number, body: string): MessagingProviderError {
  if (status === 401 || status === 403) return new MessagingProviderError("auth", `WuzAPI recusou autenticação (status ${status}): ${body}`);
  if (status === 429) return new MessagingProviderError("rate_limit", `WuzAPI rate limit (status ${status}): ${body}`);
  const lowerBody = body.toLowerCase();
  if (SESSION_LOGGED_OUT_PATTERNS.some((pattern) => lowerBody.includes(pattern))) {
    return new MessagingProviderError("session_logged_out", `WuzAPI reporta sessão não autenticada (status ${status}): ${body}`);
  }
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

  /** Chamadas de sessão (status/QR/envio) usam o token daquela sessão (`externalSessionId` no
   * domínio Vorix) num header CUSTOMIZADO `token` — confirmado ao vivo, NUNCA `Authorization`
   * aqui (isso é só para `adminRequest`). */
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
   *
   * Idempotente por design: achado real em produção (Fase 10.1 — reconectar um canal
   * `logged_out`/`requires_repair` chama `connect()` de novo, que chama isto de novo com o MESMO
   * token) — o WuzAPI responde 409 `"user with this token already exists"` na segunda chamada.
   * Confirmado ao vivo com um usuário descartável (criado e removido só para o teste) que isso é
   * exatamente o que quebrava "Mostrar QR Code" num canal já existente. Tratado aqui, não no
   * chamador, porque idempotência é responsabilidade da própria operação de provisionamento.
   */
  async createAdminUser(input: { name: string; token: string; webhookUrl?: string; events?: string[] }): Promise<{ id: number }> {
    try {
      return await this.adminRequest("/admin/users", {
        method: "POST",
        body: { name: input.name, token: input.token, webhook: input.webhookUrl, events: (input.events ?? ["Message", "ReadReceipt", "Connected", "Disconnected", "LoggedOut"]).join(",") },
      });
    } catch (error) {
      if (error instanceof MessagingProviderError && /already exists/i.test(error.message)) {
        return { id: 0 };
      }
      throw error;
    }
  }

  async connectSession(sessionToken: string, input: { subscribe?: string[]; immediate?: boolean } = {}): Promise<{ jid?: string; details?: string; events?: string }> {
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

  async getSessionStatus(sessionToken: string): Promise<{ connected: boolean; loggedIn: boolean; jid?: string }> {
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

  /**
   * Metadata de grupo (bloco "Identity UX" — ver docs/conversas-whatsapp-experience-completion.md).
   *
   * CAUSA RAIZ REAL (confirmado lendo o handler de verdade, `handlers.go`,
   * `func (s *server) GetGroupInfo()`) de "nunca sincronizou nem uma vez em produção": o endpoint
   * espera `groupJID` como QUERY PARAMETER (`r.URL.Query().Get("groupJID")`), NUNCA um corpo JSON
   * — a versão anterior desta função mandava `GET` com `body: { GroupJID }`, e `fetch()` (spec
   * WHATWG) LANÇA `TypeError: Request with GET/HEAD method cannot have body` de forma síncrona
   * antes mesmo de abrir a conexão. Esse erro nunca aparecia nos logs porque
   * `WuzApiMessagingProvider.getGroupInfo` engole qualquer exceção silenciosamente (best-effort,
   * "nunca lança") — resultado: zero requisições `/group/info` chegaram ao WuzAPI, confirmado
   * pelos logs do container (nenhuma menção a "group/info" em 72h).
   *
   * Resposta: `resp` do handler é um `*types.GroupInfo` (whatsmeow, `types/group.go`) serializado
   * DIRETO, sem tags `json:"..."` — campos embutidos (`GroupName`/`GroupTopic`) são promovidos pro
   * nível raiz pelo encoding padrão do Go. `ParticipantCount` é um campo `int` direto e confiável;
   * `Name`/`Topic` são best-effort (a promoção exata do nome do campo embutido nunca foi
   * confirmada ao vivo) — `getGroupInfo` tenta variantes prováveis antes de desistir.
   */
  async getGroupInfo(sessionToken: string, groupJid: string): Promise<{
    Name?: string;
    Topic?: string;
    Participants?: Array<{ JID: string; IsAdmin?: boolean; IsSuperAdmin?: boolean }>;
    ParticipantCount?: number;
    GroupCreated?: string;
    JID?: string;
  }> {
    return this.sessionRequest(sessionToken, `/group/info?groupJID=${encodeURIComponent(groupJid)}`, { method: "GET" });
  }

  /**
   * Baixa e descriptografa mídia recebida. O WuzAPI faz a descriptografia E2E server-side (nunca
   * dá para buscar `mediaUrl` direto com `fetch` — é ciphertext na CDN do WhatsApp, precisa da
   * `mediaKey`) e devolve os bytes em base64. `undefined` = resposta em formato inesperado
   * (nenhuma das variantes de campo conhecidas continha uma string base64) — quem chama trata
   * como "mídia indisponível", nunca lança.
   *
   * CONFIRMADO lendo o código-fonte real do handler (`asternic/wuzapi`, `handlers.go`,
   * `DownloadImage`/`DownloadVideo`/`DownloadAudio`/`DownloadDocument`) e da função que ele chama
   * por baixo (`tulir/whatsmeow`, `download.go`, `Client.Download()`): a struct de request do
   * WuzAPI (`Url`, `DirectPath`, `MediaKey`, `Mimetype`, `FileEncSHA256`, `FileSHA256`,
   * `FileLength`, sem tags `json:"..."` — o decoder do Go casa por nome case-insensitive, então o
   * casing exato do payload não importa aqui) monta um `waE2E.ImageMessage` e chama
   * `whatsmeow.Client.Download()`. Essa função verifica `len(msg.GetDirectPath()) == 0` — **nunca
   * olha pra `URL`** — e retorna `ErrNoURLPresent` ("no url present") se `DirectPath` estiver
   * vazio. Causa raiz real de "toda mídia falha ao baixar em produção" (272 mensagens, 0% de
   * sucesso, mesmo erro sempre): `directPath` nunca era extraído/enviado antes desta correção.
   */
  async downloadMedia(
    sessionToken: string,
    type: "image" | "video" | "audio" | "document",
    input: { url: string; directPath?: string; mediaKey?: string; mimeType?: string; fileSha256?: string; fileSizeBytes?: number; fileEncSha256?: string },
  ): Promise<{ body: Buffer; mimeType?: string } | undefined> {
    const path = { image: "/chat/downloadimage", video: "/chat/downloadvideo", audio: "/chat/downloadaudio", document: "/chat/downloaddocument" }[type];
    const raw = await this.sessionRequest<unknown>(sessionToken, path, {
      method: "POST",
      body: {
        Url: input.url,
        DirectPath: input.directPath,
        MediaKey: input.mediaKey,
        Mimetype: input.mimeType,
        FileSHA256: input.fileSha256,
        FileLength: input.fileSizeBytes,
        FileEncSHA256: input.fileEncSha256,
      },
    });
    const base64 = extractBase64Payload(raw);
    if (!base64) return undefined;
    try {
      return { body: Buffer.from(base64, "base64"), mimeType: input.mimeType };
    } catch {
      return undefined;
    }
  }

  /**
   * Foto de perfil (contato OU grupo — mesmo endpoint, `jid` decide qual). Bloco "réplica de
   * identidade"/UX de avatares.
   *
   * CONFIRMADO lendo o handler real (`asternic/wuzapi`, `handlers.go`, `func (s *server)
   * GetAvatar()`): `POST /user/avatar` (nunca GET — diferente de `/group/info`, aqui um corpo JSON
   * é esperado e válido) com `{Phone, Preview}`; devolve `types.ProfilePictureInfo` (whatsmeow,
   * `types/user.go`) serializado com tags `json:"..."` explícitas (`url`/`id`/`type`/`direct_path`
   * — lowercase, confiável, ao contrário do `GroupInfo` sem tags). `pic == nil` (pessoa/grupo sem
   * foto, ou perfil privado) faz o handler responder 500 com a mensagem literal "no avatar found"
   * — tratado aqui como ausência normal (`undefined`), NUNCA como falha transitória a repetir.
   *
   * `url` é servida "com uma requisição HTTP simples" (comentário do próprio whatsmeow no struct
   * `ProfilePictureInfo.URL`) — ao contrário de mídia de mensagem, nunca precisa de
   * `mediaKey`/decrypt server-side, então busca os bytes direto daqui, sem precisar de um segundo
   * endpoint do WuzAPI.
   */
  async downloadAvatar(sessionToken: string, jid: string): Promise<{ body: Buffer; mimeType: string } | undefined> {
    let avatar: { url?: string } | undefined;
    try {
      avatar = await this.sessionRequest<{ url?: string }>(sessionToken, "/user/avatar", { method: "POST", body: { Phone: jid, Preview: false } });
    } catch (error) {
      if (error instanceof MessagingProviderError && /no avatar found/i.test(error.message)) return undefined;
      throw error;
    }
    if (!avatar?.url) return undefined;

    let response: Response;
    try {
      response = await this.fetchImpl(avatar.url);
    } catch (error) {
      throw new MessagingProviderError("transient", `Falha ao baixar a foto de perfil: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) return undefined;
    const arrayBuffer = await response.arrayBuffer();
    return { body: Buffer.from(arrayBuffer), mimeType: response.headers.get("content-type") ?? "image/jpeg" };
  }
}

/** CONFIRMADO lendo o handler real (`handlers.go`, `DownloadImage` etc.): a resposta é
 * `{"Mimetype": ..., "Data": dataurl.New(bytes, mimetype).String()}` — o pacote Go
 * `vincent-petithory/dataurl` produz uma DATA URL completa (`data:<mimetype>;base64,<base64>`),
 * nunca base64 puro. Decodificar isso com `Buffer.from(x, "base64")` sem remover o prefixo
 * `data:...;base64,` corrompe o arquivo (o prefixo não é base64 válido). Mantém o fallback pra
 * base64 puro só por segurança, caso uma versão futura do WuzAPI mude o formato. */
function extractBase64Payload(raw: unknown): string | undefined {
  const candidate = (() => {
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      const value = record.Data ?? record.data ?? record.Base64 ?? record.base64 ?? record.Image ?? record.File ?? record.Content;
      if (typeof value === "string") return value;
    }
    return undefined;
  })();
  if (!candidate) return undefined;
  const dataUrlMatch = /^data:[^,]*;base64,(.+)$/s.exec(candidate);
  return dataUrlMatch ? dataUrlMatch[1] : candidate;
}
