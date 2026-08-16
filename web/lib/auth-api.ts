import { ApiError, getApiBaseUrl, type ApiEnvelope } from "./api-error";
import type { TenantRole } from "@/features/auth/types";

/**
 * Chamadas de autenticação — FORA do `apiClient` genérico de propósito (`api-client.ts`), porque
 * dependem do cookie HttpOnly do refresh token (`credentials: "include"`) e do header CSRF
 * (double-submit cookie, ver o backend em `src/interfaces/api/routes/v1/auth.route.ts`), nunca
 * de um Bearer access token — é exatamente o oposto do que o `apiClient` assume.
 */

const CSRF_COOKIE_NAME = "zuno_csrf_token";

function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as ApiEnvelope<T> | undefined;
  if (!body) throw new ApiError("INVALID_RESPONSE", "Resposta inválida da API.", response.status, false);
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, response.status, body.error.recoverable);
  return body.data;
}

export type LoginResult = {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  tenantId: string;
  role: TenantRole;
};

export async function apiLogin(email: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${getApiBaseUrl()}/v1/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parseEnvelope<LoginResult>(response);
}

export type RefreshResult = { accessToken: string; expiresIn: number; tenantId: string; role: TenantRole };

export async function apiRefresh(): Promise<RefreshResult> {
  const csrfToken = readCsrfCookie();
  const response = await fetch(`${getApiBaseUrl()}/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
  });
  return parseEnvelope<RefreshResult>(response);
}

export async function apiLogout(): Promise<void> {
  const csrfToken = readCsrfCookie();
  const request = fetch(`${getApiBaseUrl()}/v1/auth/logout`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
  }).catch(() => undefined);
  await Promise.race([request, new Promise((resolve) => setTimeout(resolve, 2500))]);
}

export type SignupInput = {
  email: string;
  password: string;
  name: string;
  workspaceName?: string;
};

/** Cadastro público — Fase 2. Devolve o mesmo envelope de `/auth/login` já autenticado. */
export async function apiSignup(input: SignupInput): Promise<LoginResult> {
  const response = await fetch(`${getApiBaseUrl()}/v1/auth/signup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<LoginResult>(response);
}
