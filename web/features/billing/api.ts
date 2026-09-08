import { apiClient } from "@/lib/api-client";
import type { BillingInterval, BillingOverview, DowngradePreview, PlatformPlanCode } from "./types";

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
