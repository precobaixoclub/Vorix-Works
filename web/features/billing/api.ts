import { apiClient } from "@/lib/api-client";
import type { BillingInterval, BillingOverview, CapacityChangeResult, CapacityPreviewResult, CapacityState, DowngradePreview, PlatformPlanCode } from "./types";

/** Rotas `/v1/billing/*` — SaaS Commercialization, Fases 2-4. Escopadas ao tenant do usuário
 * autenticado (`requirePrincipal`); nenhum parâmetro de tenant é passado pelo cliente. */

export async function fetchBillingOverview(): Promise<BillingOverview> {
  return apiClient.get<BillingOverview>("/v1/billing/overview");
}

export async function startCheckout(input: { planCode: PlatformPlanCode; billingInterval: BillingInterval }): Promise<{ checkoutUrl: string; providerSessionId: string }> {
  return apiClient.post("/v1/billing/checkout", input);
}

/** Trial sem cartão — cria a Subscription real direto, sem passar pelo gateway de pagamento. */
export async function startTrial(planCode: PlatformPlanCode): Promise<unknown> {
  return apiClient.post("/v1/billing/start-trial", { planCode });
}

export async function fetchDowngradePreview(newPlanCode: PlatformPlanCode): Promise<DowngradePreview> {
  return apiClient.get<DowngradePreview>(`/v1/billing/downgrade-preview?newPlanCode=${encodeURIComponent(newPlanCode)}`);
}

export async function changePlan(input: { newPlanCode: PlatformPlanCode; billingInterval: BillingInterval }): Promise<{ changed: true }> {
  return apiClient.post("/v1/billing/change-plan", input);
}

export async function purchaseAddon(input: { addonCode: string; quantity: number; billingInterval: BillingInterval }): Promise<{ purchased: true }> {
  return apiClient.post("/v1/billing/addons", input);
}

export async function removeAddon(subscriptionItemId: string): Promise<void> {
  await apiClient.delete(`/v1/billing/addons/${encodeURIComponent(subscriptionItemId)}`);
}

export async function cancelSubscription(reason?: string): Promise<{ cancelAtPeriodEnd: true }> {
  return apiClient.post("/v1/billing/cancel", { reason });
}

export async function reactivateSubscription(): Promise<{ reactivated: true }> {
  return apiClient.post("/v1/billing/reactivate", {});
}

export async function openBillingPortal(returnPath?: string): Promise<{ portalUrl: string }> {
  return apiClient.post("/v1/billing/portal", returnPath ? { returnPath } : {});
}

/** Pricing/Capacity Etapa B — capacidade (usuários/números WhatsApp) self-service. */
export async function fetchCapacityState(): Promise<CapacityState> {
  return apiClient.get<CapacityState>("/v1/billing/capacity");
}

/** Preview NUNCA muda nada (seção 10-11 do pedido) — só o backend calcula, frontend só exibe. */
export async function previewCapacity(input: { users: number; whatsappConnections: number }): Promise<CapacityPreviewResult> {
  return apiClient.post("/v1/billing/capacity/preview", input);
}

/** Idempotency-Key gerado por confirmação (seção 8 do pedido: duplo clique nunca dobra o efeito) —
 * cada chamada de `applyCapacity` recebe uma chave nova, então dois cliques distintos SÃO duas
 * intenções reais; só o retry automático de uma MESMA chamada reusaria a mesma chave (o
 * `apiClient` não faz retry de POST sozinho hoje, então isto já cobre o caso prático de duplo
 * clique acidental no botão — cada clique gera sua própria chave). */
export async function applyCapacity(input: { users?: number; whatsappConnections?: number }): Promise<CapacityChangeResult> {
  return apiClient.post("/v1/billing/capacity/apply", input, { headers: { "Idempotency-Key": crypto.randomUUID() } });
}

export async function cancelPendingCapacityChange(pendingChangeId: string): Promise<{ cancelled: true }> {
  return apiClient.post(`/v1/billing/capacity/pending/${encodeURIComponent(pendingChangeId)}/cancel`, {});
}
