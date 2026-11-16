import type { FastifyInstance } from "fastify";
import {
  adminMeetingPlanAction,
  cancelMeetingPlan,
  getMeetingPlanOverview,
  MEETING_PLAN_ADMIN_ACTIONS,
  MeetingPlanAccessError,
  MeetingPlanCheckoutClosedError,
  requestMeetingPlanChange,
  revertMeetingPlanCancellation,
  startMeetingTrial,
  type MeetingPlanAdminAction,
  type MeetingPlanDeps,
} from "../../../../application/meetings/meeting-plans.js";
import { MEETING_PLAN_CODES, MeetingPlanError, type MeetingPlanCode } from "../../../../domain/meetings/meeting-plans.model.js";
import { ConflictError, ForbiddenError, ValidationError } from "../../http/app-error.js";
import { requirePlatformAdmin, requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Planos de gravação do Meetings. Fora de `/v1/meetings` de propósito: o guarda de solução barra
 * esse prefixo para quem ainda não tem o Meetings — e é justamente quem precisa ver os planos e
 * iniciar o teste gratuito. Toda regra (teste único, franquia, troca, cancelamento) é do backend.
 */
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MeetingPlanAccessError) throw new ForbiddenError(error.message.replace(/^MEETING_PLAN_FORBIDDEN: /, ""));
    if (error instanceof MeetingPlanCheckoutClosedError) throw new ConflictError(error.message.replace(/^MEETING_PLAN_CHECKOUT_CLOSED: /, ""), { code: "MEETING_PLAN_CHECKOUT_CLOSED" });
    if (error instanceof MeetingPlanError) {
      const message = error.message.replace(/^[A-Z_]+: /, "");
      if (error.code === "INVALID_PLAN") throw new ValidationError(message);
      throw new ConflictError(message, { code: error.code });
    }
    if (error instanceof Error && error.message.startsWith("MEETING_PLAN_CONFLICT")) throw new ConflictError(error.message.replace(/^MEETING_PLAN_CONFLICT: /, ""));
    throw error;
  }
}

const EMPTY_BODY = { type: "object", additionalProperties: false, properties: {} } as const;
const CHANGE_BODY = { type: "object", required: ["planCode"], additionalProperties: false, properties: { planCode: { type: "string", enum: [...MEETING_PLAN_CODES] } } } as const;
const TENANT_PARAMS = { type: "object", required: ["tenantId"], properties: { tenantId: { type: "string", minLength: 1, maxLength: 120 } } } as const;
const ADMIN_BODY = {
  type: "object",
  required: ["action"],
  additionalProperties: false,
  properties: { action: { type: "string", enum: [...MEETING_PLAN_ADMIN_ACTIONS] }, planCode: { type: "string", enum: [...MEETING_PLAN_CODES] } },
} as const;

export async function registerMeetingPlanRoutes(app: FastifyInstance, deps: MeetingPlanDeps): Promise<void> {
  const actorOf = (request: Parameters<typeof requirePrincipal>[0]) => {
    const principal = requirePrincipal(request);
    return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role };
  };

  app.get("/meeting-plans", async (request) => successEnvelope(await run(() => getMeetingPlanOverview(deps, actorOf(request))), request.id));

  app.post("/meeting-plans/trial", { schema: { body: EMPTY_BODY } }, async (request, reply) => {
    const actor = actorOf(request);
    await run(() => startMeetingTrial(deps, actor));
    reply.code(201);
    return successEnvelope(await getMeetingPlanOverview(deps, actor), request.id);
  });

  app.post("/meeting-plans/change", { schema: { body: CHANGE_BODY } }, async (request) => {
    const actor = actorOf(request);
    const { planCode } = request.body as { planCode: MeetingPlanCode };
    await run(() => requestMeetingPlanChange(deps, actor, planCode));
    return successEnvelope(await getMeetingPlanOverview(deps, actor), request.id);
  });

  app.post("/meeting-plans/cancel", { schema: { body: EMPTY_BODY } }, async (request) => {
    const actor = actorOf(request);
    await run(() => cancelMeetingPlan(deps, actor));
    return successEnvelope(await getMeetingPlanOverview(deps, actor), request.id);
  });

  app.post("/meeting-plans/revert-cancel", { schema: { body: EMPTY_BODY } }, async (request) => {
    const actor = actorOf(request);
    await run(() => revertMeetingPlanCancellation(deps, actor));
    return successEnvelope(await getMeetingPlanOverview(deps, actor), request.id);
  });

  // ── Admin da plataforma: concessão manual e registro de pagamento (auditados) ──
  app.get("/admin/meeting-plans/:tenantId", { schema: { params: TENANT_PARAMS } }, async (request) => {
    requirePlatformAdmin(request);
    const { tenantId } = request.params as { tenantId: string };
    const overview = await getMeetingPlanOverview(deps, { tenantId, userId: "platform-admin", role: "viewer" });
    return successEnvelope({ ...overview, events: await deps.plans.listEvents(tenantId, 50) }, request.id);
  });

  app.post("/admin/meeting-plans/:tenantId", { schema: { params: TENANT_PARAMS, body: ADMIN_BODY } }, async (request) => {
    const admin = requirePlatformAdmin(request);
    const { tenantId } = request.params as { tenantId: string };
    const body = request.body as { action: MeetingPlanAdminAction; planCode?: MeetingPlanCode };
    const subscription = await run(() => adminMeetingPlanAction(deps, { tenantId, adminUserId: admin.userId, action: body.action, ...(body.planCode ? { planCode: body.planCode } : {}) }));
    return successEnvelope({ subscription: subscription ?? null }, request.id);
  });
}
