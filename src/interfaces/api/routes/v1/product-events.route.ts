import type { FastifyInstance } from "fastify";
import { recordProductEvent, type ProductAnalyticsUseCaseDeps } from "../../../../application/product-analytics/product-analytics-use-cases.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Subconjunto que o CLIENTE pode reportar diretamente — eventos de COMPORTAMENTO, nunca de
 * ESTADO real (seção 12: "nunca confiar somente em eventos disparados pelo navegador"). Todo
 * evento crítico (checkout_completed, subscription_upgraded, trial_converted, deal_won, etc.)
 * só nasce no backend, a partir do próprio use-case que já sabe que aquilo de fato aconteceu —
 * este endpoint público rejeita qualquer nome fora desta lista, mesmo que o vocabulário geral
 * (`PRODUCT_EVENT_NAMES`) o reconheça. */
const CLIENT_ALLOWED_EVENT_NAMES = ["landing_view", "pricing_view", "plan_selected", "signup_started"] as const;

export type ProductEventsRoutesDeps = ProductAnalyticsUseCaseDeps;

const RECORD_BODY_SCHEMA = {
  type: "object",
  required: ["eventName"],
  additionalProperties: false,
  properties: {
    eventName: { type: "string", enum: [...CLIENT_ALLOWED_EVENT_NAMES] },
    anonymousId: { type: "string", maxLength: 100 },
    sessionId: { type: "string", maxLength: 100 },
    properties: { type: "object" },
  },
} as const;

/**
 * `POST /v1/product-events` — único ponto de entrada para eventos de COMPORTAMENTO reportados
 * pelo navegador (landing/pricing/plan_selected/signup_started), inclusive ANTES do login
 * (`anonymousId` do visitante, nunca um fingerprint invasivo). Quando o request já carrega um
 * JWT válido, `tenantId`/`userId` são anexados a partir do principal — NUNCA do corpo — pra
 * nunca permitir que um cliente reivindique ser outro tenant. Nunca lança por falha de escrita
 * (ver `recordProductEvent`); rate-limitado pelo middleware global (mesmo bucket "write" de
 * qualquer outra rota, ver `rate-limit.middleware.ts`).
 */
export async function registerProductEventsRoutes(app: FastifyInstance, deps: ProductEventsRoutesDeps): Promise<void> {
  app.post("/product-events", { schema: { body: RECORD_BODY_SCHEMA } }, async (request, reply) => {
    const body = request.body as { eventName: (typeof CLIENT_ALLOWED_EVENT_NAMES)[number]; anonymousId?: string; sessionId?: string; properties?: Record<string, unknown> };
    const principal = request.zunoContext.principal;

    await recordProductEvent(deps, {
      eventName: body.eventName,
      source: "client",
      anonymousId: body.anonymousId,
      sessionId: body.sessionId,
      tenantId: principal?.tenantId,
      userId: principal?.userId,
      properties: body.properties,
    });

    reply.code(202);
    return successEnvelope({ recorded: true }, request.id);
  });
}
