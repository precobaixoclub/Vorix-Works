import type { BillingProviderPort } from "../ports/billing-provider.port.js";
import type { AddonDefinitionRepositoryPort, PlanVersionRepositoryPort } from "../ports/plan-version-repository.port.js";
import type { SubscriptionRepositoryPort } from "../ports/subscription-repository.port.js";
import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";
import type { PlatformPlanCode } from "../../domain/platform-billing/platform-plan-catalog.js";

export type CheckoutUseCaseDeps = {
  billingProvider: BillingProviderPort;
  planVersionRepository: PlanVersionRepositoryPort;
  addonDefinitionRepository: AddonDefinitionRepositoryPort;
  subscriptionRepository: SubscriptionRepositoryPort;
};

export type StartCheckoutInput = {
  tenantId: string;
  customerEmail: string;
  planCode: PlatformPlanCode;
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
  addonCodes?: readonly string[];
};

export type StartCheckoutOutput = { checkoutUrl: string; providerSessionId: string };

function priceRefFor(providerId: string, planId: string, ref: string | undefined): string {
  if (ref) return ref;
  // `SandboxBillingProvider` nunca valida `providerPlanPriceRef` — usa o próprio id como
  // referência determinística. Um gateway real sem o Price configurado é um erro de configuração
  // (ver `CHECKOUT_PRICE_NOT_CONFIGURED` abaixo), nunca cai aqui.
  if (providerId === "sandbox") return planId;
  throw new Error(`CHECKOUT_PRICE_NOT_CONFIGURED: "${planId}" não tem Price configurado para o gateway "${providerId}".`);
}

/**
 * Inicia o checkout de um plano pago — SaaS Commercialization, Fase 2. NUNCA cria/ativa a
 * `Subscription` aqui: isso só acontece quando o webhook confirmar `checkout.session.completed`
 * (ver `webhook-use-cases.ts`) — o não-negociável "nenhuma decisão de assinatura depende só do
 * retorno HTTP/redirect do gateway".
 */
export async function startCheckout(deps: CheckoutUseCaseDeps, input: StartCheckoutInput): Promise<StartCheckoutOutput> {
  if (input.planCode === "ENTERPRISE") {
    throw new Error("CHECKOUT_PLAN_NOT_SELF_SERVICE: o plano Enterprise é vendido por contato, não por checkout self-service.");
  }

  const existing = await deps.subscriptionRepository.getActiveByTenant(input.tenantId);
  if (existing) {
    throw new Error("CHECKOUT_ALREADY_SUBSCRIBED: este tenant já tem uma assinatura ativa — use a troca de plano, não um novo checkout.");
  }

  const planVersion = await deps.planVersionRepository.getActiveVersion(input.planCode);
  if (!planVersion) {
    throw new Error(`CHECKOUT_PLAN_VERSION_NOT_FOUND: nenhuma versão ativa cadastrada para o plano "${input.planCode}".`);
  }

  const providerId = deps.billingProvider.providerId;
  const planPriceRef = priceRefFor(
    providerId,
    planVersion.id,
    input.billingInterval === "monthly" ? planVersion.monthlyProviderPriceRef : planVersion.yearlyProviderPriceRef,
  );

  const addonPriceRefs: string[] = [];
  for (const code of input.addonCodes ?? []) {
    if (!planVersion.allowedAddonCodes.includes(code)) {
      throw new Error(`CHECKOUT_ADDON_NOT_ALLOWED: o add-on "${code}" não é permitido no plano "${input.planCode}".`);
    }
    const addon = await deps.addonDefinitionRepository.getByCode(code);
    if (!addon || !addon.active) {
      throw new Error(`CHECKOUT_ADDON_NOT_FOUND: add-on "${code}" não existe ou está inativo.`);
    }
    addonPriceRefs.push(
      priceRefFor(providerId, addon.code, input.billingInterval === "monthly" ? addon.monthlyProviderPriceRef : addon.yearlyProviderPriceRef),
    );
  }

  const result = await deps.billingProvider.createCheckout({
    tenantId: input.tenantId,
    planVersionId: planVersion.id,
    providerPlanPriceRef: planPriceRef,
    billingInterval: input.billingInterval,
    customerEmail: input.customerEmail,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    trialDays: planVersion.trialDays ?? undefined,
    addonPriceRefs,
  });

  if (!result.ok) {
    throw new Error(`CHECKOUT_PROVIDER_ERROR(${result.kind}): ${result.message}`);
  }
  return { checkoutUrl: result.checkoutUrl, providerSessionId: result.providerSessionId };
}
