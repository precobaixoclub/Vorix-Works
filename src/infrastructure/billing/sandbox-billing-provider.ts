import { randomUUID } from "node:crypto";
import type {
  BillingProviderPort,
  CancelSubscriptionInput,
  ChangeSubscriptionInput,
  ChangeSubscriptionResult,
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreateCustomerPortalInput,
  CreateCustomerPortalResult,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  GetPaymentMethodInput,
  GetPaymentMethodResult,
  HandleWebhookInput,
  HandleWebhookResult,
  ResumeSubscriptionInput,
} from "../../application/ports/billing-provider.port.js";

/**
 * `SandboxBillingProvider` — SaaS Commercialization, Fase 1. Determinístico, sem chamada externa
 * — mesmo papel de `FakeMessagingProvider`/`FakeAiModelProvider` no repositório: usado em dev/
 * teste, e como fallback seguro quando nenhum gateway real está configurado
 * (`BILLING_PROVIDER_ENABLED` desligado ou sem `STRIPE_SECRET_KEY`). Nunca cobra ninguém de
 * verdade. `handleWebhook` aqui aceita o corpo cru como o próprio evento JSON (sem verificação de
 * assinatura — não existe segredo real pra verificar em sandbox), útil para simular localmente
 * disparando um POST manual.
 */
export class SandboxBillingProvider implements BillingProviderPort {
  readonly providerId = "sandbox";

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const providerSessionId = `sandbox-session-${randomUUID()}`;
    const url = new URL(input.successUrl);
    url.searchParams.set("sandbox_session_id", providerSessionId);
    url.searchParams.set("sandbox_tenant_id", input.tenantId);
    return { ok: true, checkoutUrl: url.toString(), providerSessionId };
  }

  async createSubscription(_input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    return { ok: true, providerSubscriptionId: `sandbox-sub-${randomUUID()}`, status: "active" };
  }

  async changeSubscription(_input: ChangeSubscriptionInput): Promise<ChangeSubscriptionResult> {
    return { ok: true, status: "active", prorationAmountCents: 0 };
  }

  async cancelSubscription(_input: CancelSubscriptionInput): Promise<{ ok: true }> {
    return { ok: true };
  }

  async resumeSubscription(_input: ResumeSubscriptionInput): Promise<{ ok: true }> {
    return { ok: true };
  }

  async getPaymentMethod(_input: GetPaymentMethodInput): Promise<GetPaymentMethodResult> {
    return { ok: true, paymentMethod: { providerPaymentMethodId: "sandbox-pm-0000", brand: "sandbox", last4: "4242", expMonth: 12, expYear: 2099 } };
  }

  async createCustomerPortal(input: CreateCustomerPortalInput): Promise<CreateCustomerPortalResult> {
    return { ok: true, portalUrl: input.returnUrl };
  }

  async handleWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult> {
    const parsed = JSON.parse(input.rawBody.toString("utf8")) as { id?: string; type?: string; data?: Record<string, unknown> };
    return {
      ok: true,
      event: {
        providerEventId: parsed.id ?? `sandbox-evt-${randomUUID()}`,
        eventType: parsed.type ?? "unknown",
        data: parsed.data ?? {},
      },
    };
  }
}
