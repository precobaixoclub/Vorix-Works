import { ApiError, getApiBaseUrl, type ApiEnvelope } from "./api-error";
import { apiRefresh } from "./auth-api";
import { getAccessToken, setAccessToken } from "./auth-token";

/**
 * Cliente HTTP — o único lugar em `web/` que fala com rotas de NEGÓCIO da API (Workspace, Chat
 * mock, etc.). Login/refresh/logout ficam fora daqui (`lib/auth-api.ts`) — são cookie-based, não
 * Bearer. Quando uma resposta vem com `error.code === "TOKEN_EXPIRED"`, tenta UM refresh
 * silencioso (via o cookie HttpOnly) e repete a requisição original uma única vez — "renovação
 * automática" (PROMPT 05, Fase 5) sem o usuário perceber, desde que o refresh token ainda seja
 * válido. Concorrência: várias chamadas 401 ao mesmo tempo compartilham a MESMA tentativa de
 * refresh (`pendingRefresh`), nunca disparam refreshes paralelos — o refresh token é rotacionado
 * a cada uso (Sprint 05), então dois refreshes simultâneos com o mesmo token fariam o segundo
 * falhar por reuse.
 */

let pendingRefresh: Promise<string | undefined> | null = null;

async function refreshOnce(): Promise<string | undefined> {
  if (!pendingRefresh) {
    pendingRefresh = apiRefresh()
      .then((result) => {
        setAccessToken(result.accessToken);
        return result.accessToken;
      })
      .catch(() => {
        setAccessToken(undefined);
        return undefined;
      })
      .finally(() => {
        pendingRefresh = null;
      });
  }
  return pendingRefresh;
}

async function request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getAccessToken();
  // FormData (upload de arquivo) precisa que o navegador defina o Content-Type (com o boundary do
  // multipart) sozinho — setar "application/json" aqui quebraria o parsing no servidor.
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Não foi possível conectar à API do Vorix. Ela está rodando?", 0, true);
  }

  const body = (await response.json().catch(() => undefined)) as ApiEnvelope<T> | undefined;
  if (!body) {
    throw new ApiError("INVALID_RESPONSE", "Resposta inválida da API.", response.status, false);
  }
  if (!body.ok) {
    if (body.error.code === "TOKEN_EXPIRED" && !isRetry) {
      const newToken = await refreshOnce();
      if (newToken) return request<T>(path, init, true);
    }
    throw new ApiError(body.error.code, body.error.message, response.status, body.error.recoverable);
  }
  return body.data;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: "POST", body: payload !== undefined ? JSON.stringify(payload) : undefined }),
  put: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: "PUT", body: payload !== undefined ? JSON.stringify(payload) : undefined }),
  patch: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: "PATCH", body: payload !== undefined ? JSON.stringify(payload) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
};

export { ApiError } from "./api-error";
