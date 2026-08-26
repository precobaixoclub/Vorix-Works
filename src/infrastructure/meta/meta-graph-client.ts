/**
 * Cliente compartilhado da Graph API do Meta — módulo Meta Ads Manager (Fase 1).
 *
 * Achado da análise do pacote de referência (bittencourtthulio/meta-graph-api-integration): a
 * ausência de um cliente único é exatamente o defeito #1 que aquele pacote documenta (cinco
 * versões da Graph API convivendo). O próprio Vorix já tem essa dispersão hoje, embora menor —
 * `MetaInstagramOAuthService`/`MetaContentPostingProvider` hardcodam `v21.0`,
 * `MetaPagesOAuthService`/`MetaPagesSandboxProvider` hardcodam `v20.0`, cada um com seu próprio
 * `graphGet`/`graphPost` duplicado. Este módulo é a correção — usado pelo módulo de Ads desde o
 * primeiro dia, nunca retrofitado nos arquivos de publicação existentes (que já funcionam em
 * produção; mexer neles é um projeto de limpeza separado, não parte desta feature).
 */

export const META_GRAPH_API_VERSION = "v21.0";
export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
export const META_OAUTH_DIALOG_BASE_URL = `https://www.facebook.com/${META_GRAPH_API_VERSION}`;

export type MetaGraphErrorPayload = {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  is_transient?: boolean;
};

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly graphError: MetaGraphErrorPayload | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MetaGraphError";
  }

  /** Erro transitório do Meta — vale reter com backoff (ver `graphRequest`). */
  get isTransient(): boolean {
    return this.graphError?.is_transient === true || this.graphError?.code === 1 || this.graphError?.code === 2 || this.status >= 500;
  }

  /** Token expirado/revogado (código 190 ou `OAuthException`) — exige reconexão pela UI, nunca
   * um retry automático resolve isto. */
  get isTokenError(): boolean {
    return this.graphError?.code === 190 || this.graphError?.type === "OAuthException";
  }

  /** Rate limit do Meta — recuar e tentar mais tarde, nunca tratar como falha permanente. */
  get isRateLimit(): boolean {
    const code = this.graphError?.code;
    return code === 4 || code === 17 || code === 32 || code === 613;
  }
}

/** Normaliza o id da conta para o formato `act_XXXX` exigido pela Marketing API. */
export function toActAccountId(accountId: string): string {
  return `act_${accountId.replace(/^act_/, "")}`;
}

/** Remove o prefixo `act_` — algumas leituras (ex.: `account_id` puro devolvido em outros campos)
 * esperam o id sem prefixo. */
export function toRawAccountId(accountId: string): string {
  return accountId.replace(/^act_/, "");
}

export type MetaGraphRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  /** Enviado como query string (GET/DELETE) ou corpo (POST). */
  params?: Record<string, unknown>;
  accessToken: string;
  /** A Marketing API espera `form-urlencoded` nos POSTs de criação; `json` é usado em updates
   * simples e na Conversions API. Nunca assumir — quem chama decide, documentado no contrato de
   * cada endpoint (`skills/meta-graph-api/SKILL.md §2` do pacote de referência). */
  bodyFormat?: "form" | "json";
  /** Tentativas totais em erro transitório (padrão 3). */
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function encodeParams(params: Record<string, unknown>, sink: URLSearchParams): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    sink.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
}

/**
 * Chamada única à Graph API, com retry exponencial em erro transitório. `path` NUNCA inclui a
 * versão nem o host — só o caminho ("/me/adaccounts", "/act_123/campaigns").
 */
export async function metaGraphRequest<T = unknown>(path: string, options: MetaGraphRequestOptions): Promise<T> {
  const { method = "GET", params = {}, accessToken, bodyFormat = "form", retries = 3, timeoutMs = 30_000, fetchImpl = fetch } = options;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  let lastError: MetaGraphError | undefined;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let url = `${META_GRAPH_BASE_URL}${normalizedPath}`;
      const init: RequestInit = { method, signal: controller.signal };

      if (method === "POST") {
        if (bodyFormat === "json") {
          init.headers = { "content-type": "application/json" };
          init.body = JSON.stringify({ ...params, access_token: accessToken });
        } else {
          const form = new URLSearchParams();
          encodeParams(params, form);
          form.append("access_token", accessToken);
          init.body = form;
        }
      } else {
        const qs = new URLSearchParams();
        encodeParams(params, qs);
        qs.append("access_token", accessToken);
        url = `${url}?${qs.toString()}`;
      }

      const response = await fetchImpl(url, init);
      clearTimeout(timer);

      const text = await response.text();
      let data: Record<string, unknown>;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new MetaGraphError(`Resposta não-JSON da Graph API: ${text.slice(0, 200)}`, null, response.status);
      }

      if (!response.ok || data.error) {
        const graphError = (data.error ?? null) as MetaGraphErrorPayload | null;
        const err = new MetaGraphError(graphError?.message ?? `Graph API respondeu ${response.status}`, graphError, response.status);
        if (err.isTransient && attempt < retries) {
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 1000));
          continue;
        }
        throw err;
      }

      return data as T;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof MetaGraphError) throw error;
      const err = new MetaGraphError(error instanceof Error ? error.message : String(error), null, 0);
      if (attempt < retries) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 1000));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new MetaGraphError("Falha desconhecida na Graph API", null, 0);
}

/** Percorre TODAS as páginas de um endpoint paginado (segue `paging.next`) — sem isso, contas
 * grandes (muitas campanhas, muitos ad accounts) ficam truncadas silenciosamente em ~25-100 itens. */
export async function metaGraphPaginate<T = Record<string, unknown>>(
  path: string,
  options: MetaGraphRequestOptions & { maxPages?: number },
): Promise<T[]> {
  const { maxPages = 50, fetchImpl = fetch } = options;
  const results: T[] = [];

  const firstPage = await metaGraphRequest<{ data?: T[]; paging?: { next?: string } }>(path, options);
  results.push(...(firstPage.data ?? []));

  let pages = 1;
  let next = firstPage.paging?.next;
  while (next && pages < maxPages) {
    const response = await fetchImpl(next);
    const data = (await response.json()) as { data?: T[]; paging?: { next?: string }; error?: MetaGraphErrorPayload };
    if (data.error) throw new MetaGraphError(data.error.message, data.error, response.status);
    results.push(...(data.data ?? []));
    next = data.paging?.next;
    pages++;
  }

  return results;
}
