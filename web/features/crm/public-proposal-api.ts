import { getApiBaseUrl } from "@/lib/api-error";
import { ApiError } from "@/lib/api-client";
import type { BillingType, ProposalStatus } from "./types";

/**
 * Cliente da API PÚBLICA de propostas (`/v1/public/proposals/:token`) — o token da URL é a
 * autenticação, então isto usa `fetch` puro (sem `apiClient`, que assume uma sessão Vorix
 * autenticada). Mesmo padrão de `features/platform-plans/api.ts` (pricing pública).
 */

/** Payload público: lista FECHADA de campos (nunca custo, mínimo, ids internos ou auditoria). */
export type PublicProposal = {
  number?: string;
  version: number;
  title: string;
  introduction?: string;
  items: { name: string; description?: string; quantity: number; unitPriceCents: number; subtotalCents: number; billingType?: BillingType }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  validUntil?: string;
  conditions?: string;
  notes?: string;
  terms?: string;
  status: ProposalStatus;
  sentAt?: string;
  respondedAt?: string;
  rejectionReason?: string;
  superseded: boolean;
  customerName?: string;
  customerCompany?: string;
  issuerName?: string;
  declineReasons: string[];
};

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function unwrap<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as Envelope<T> | undefined;
  if (!body) throw new ApiError("INVALID_RESPONSE", "Resposta inválida.", response.status, false);
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, response.status, false);
  return body.data;
}

const base = (token: string) => `${getApiBaseUrl()}/v1/public/proposals/${encodeURIComponent(token)}`;

export async function getPublicProposal(token: string): Promise<PublicProposal> {
  return unwrap<PublicProposal>(await fetch(base(token), { method: "GET", cache: "no-store" }));
}

export async function acceptPublicProposal(token: string): Promise<PublicProposal> {
  return unwrap<PublicProposal>(await fetch(`${base(token)}/accept`, { method: "POST" }));
}

export async function rejectPublicProposal(token: string, rejection?: { reason?: string; comment?: string }): Promise<PublicProposal> {
  return unwrap<PublicProposal>(await fetch(`${base(token)}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rejection ?? {}) }));
}

/** Heartbeat de leitura (tempo aproximado) — falha silenciosa, nunca atrapalha o cliente. */
export function sendProposalEngagement(token: string, seconds: number): void {
  void fetch(`${base(token)}/engagement`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seconds }), keepalive: true }).catch(() => undefined);
}

export function sendProposalDownload(token: string): void {
  void fetch(`${base(token)}/download`, { method: "POST", keepalive: true }).catch(() => undefined);
}
