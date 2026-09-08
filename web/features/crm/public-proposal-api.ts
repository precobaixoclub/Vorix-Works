import { getApiBaseUrl } from "@/lib/api-error";
import { ApiError } from "@/lib/api-client";
import type { Proposal } from "./types";

/**
 * Cliente da API PÚBLICA de propostas (`/v1/public/proposals/:token`) — o token da URL é a
 * autenticação, então isto usa `fetch` puro (sem `apiClient`, que assume uma sessão Vorix
 * autenticada). Mesmo padrão de `features/platform-plans/api.ts` (pricing pública).
 */

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function unwrap<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as Envelope<T> | undefined;
  if (!body) throw new ApiError("INVALID_RESPONSE", "Resposta inválida.", response.status, false);
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, response.status, false);
  return body.data;
}

export async function getPublicProposal(token: string): Promise<Proposal> {
  const response = await fetch(`${getApiBaseUrl()}/v1/public/proposals/${encodeURIComponent(token)}`, { method: "GET", cache: "no-store" });
  return unwrap<Proposal>(response);
}

export async function acceptPublicProposal(token: string): Promise<Proposal> {
  const response = await fetch(`${getApiBaseUrl()}/v1/public/proposals/${encodeURIComponent(token)}/accept`, { method: "POST" });
  return unwrap<Proposal>(response);
}

export async function rejectPublicProposal(token: string): Promise<Proposal> {
  const response = await fetch(`${getApiBaseUrl()}/v1/public/proposals/${encodeURIComponent(token)}/reject`, { method: "POST" });
  return unwrap<Proposal>(response);
}
