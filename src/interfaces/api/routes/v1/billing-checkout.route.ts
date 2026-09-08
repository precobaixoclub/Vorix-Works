import type { FastifyInstance } from "fastify";
import { startCheckout } from "../../../../application/billing/checkout-use-cases.js";
import type { CheckoutUseCaseDeps } from "../../../../application/billing/checkout-use-cases.js";
import { startTrial, type TrialUseCaseDeps } from "../../../../application/billing/trial-use-cases.js";
import type { UserRepositoryPort } from "../../../../application/ports/user-repository.port.js";
import { BILLING_INTERVALS } from "../../../../domain/platform-billing/subscription.model.js";
import { PLATFORM_PLAN_CODES } from "../../../../domain/platform-billing/platform-plan-catalog.js";
import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

function translateCheckoutError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("CHECKOUT_ALREADY_SUBSCRIBED")) throw new ConflictError(error.message);
    if (error.message.startsWith("CHECKOUT_PLAN_VERSION_NOT_FOUND")) throw new NotFoundError(error.message);
    if (
      error.message.startsWith("CHECKOUT_PLAN_NOT_SELF_SERVICE") ||
      error.message.startsWith("CHECKOUT_ADDON_NOT_ALLOWED") ||
      error.message.startsWith("CHECKOUT_ADDON_NOT_FOUND") ||
      error.message.startsWith("CHECKOUT_CUSTOMER_EMAIL_NOT_FOUND")
    ) {
      throw new ValidationError(error.message);
    }
  }
  throw error;
}

function translateTrialError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("TRIAL_PLAN_VERSION_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("TRIAL_ALREADY_HAS_SUBSCRIPTION")) throw new ConflictError(error.message);
    if (error.message.startsWith("TRIAL_DISABLED") || error.message.startsWith("TRIAL_NOT_AVAILABLE_FOR_PLAN")) {
      throw new ValidationError(error.message);
    }
  }
  throw error;
}

export type BillingCheckoutRoutesDeps = CheckoutUseCaseDeps & {
  userRepository: UserRepositoryPort;
  appBaseUrl: string;
};

const START_TRIAL_BODY_SCHEMA = {
  type: "object",
  required: ["planCode"],
  additionalProperties: false,
  properties: { planCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] } },
} as const;

const CHECKOUT_BODY_SCHEMA = {
  type: "object",
  required: ["planCode", "billingInterval"],
  additionalProperties: false,
  properties: {
    planCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] },
    billingInterval: { type: "string", enum: [...BILLING_INTERVALS] },
    addonCodes: { type: "array", items: { type: "string" } },
    successPath: { type: "string", maxLength: 300 },
    cancelPath: { type: "string", maxLength: 300 },
  },
} as const;

/**
 * `POST /v1/billing/checkout` — SaaS Commercialization, Fase 2. Devolve uma URL de checkout do
 * gateway configurado; NUNCA cria/ativa a assinatura aqui — só o webhook confirmado faz isso (ver
 * `webhook-use-cases.ts`). `successPath`/`cancelPath` são caminhos relativos ao frontend (nunca
 * uma URL arbitrária vinda do cliente) — combinados com `appBaseUrl`, configurado pelo servidor.
 */
export async function registerBillingCheckoutRoutes(app: FastifyInstance, deps: BillingCheckoutRoutesDeps): Promise<void> {
  app.post("/billing/checkout", { schema: { body: CHECKOUT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const body = request.body as {
      planCode: (typeof PLATFORM_PLAN_CODES)[number];
      billingInterval: (typeof BILLING_INTERVALS)[number];
      addonCodes?: string[];
      successPath?: string;
      cancelPath?: string;
    };

    const user = await deps.userRepository.getById(principal.userId);
    if (!user) {
      throw new ValidationError("CHECKOUT_CUSTOMER_EMAIL_NOT_FOUND: não foi possível determinar o email de cobrança do usuário.");
    }
    const customerEmail = user.email;

    const successUrl = new URL(body.successPath ?? "/configuracoes/plano?checkout=sucesso", deps.appBaseUrl).toString();
    const cancelUrl = new URL(body.cancelPath ?? "/configuracoes/plano?checkout=cancelado", deps.appBaseUrl).toString();

    const result = await startCheckout(deps, {
      tenantId: principal.tenantId,
      customerEmail,
      planCode: body.planCode,
      billingInterval: body.billingInterval,
      addonCodes: body.addonCodes,
      successUrl,
      cancelUrl,
    }).catch(translateCheckoutError);

    return successEnvelope(result, request.id);
  });
}

export type BillingTrialRoutesDeps = TrialUseCaseDeps;

/**
 * `POST /v1/billing/start-trial` — Trial + Product Analytics. Trial SEM cartão: cria a
 * `Subscription` real diretamente (nunca passa por `BillingProviderPort`, não há nada pra cobrar
 * ainda). `trialEnabled` (kill switch) e `PlanVersion.trialDays` (o plano de fato oferecer trial)
 * são checagens INDEPENDENTES dentro de `startTrial` — nunca uma substitui a outra.
 */
export async function registerBillingTrialRoutes(app: FastifyInstance, deps: BillingTrialRoutesDeps): Promise<void> {
  app.post("/billing/start-trial", { schema: { body: START_TRIAL_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = request.body as { planCode: (typeof PLATFORM_PLAN_CODES)[number] };
    const subscription = await startTrial(deps, { tenantId: principal.tenantId, planCode: body.planCode }).catch(translateTrialError);
    reply.code(201);
    return successEnvelope(subscription, request.id);
  });
}
