import type { FastifyInstance } from "fastify";
import {
  createDeal,
  getDeal,
  getContactOpenDealsSummary,
  getDealsSummary,
  getDealTimeline,
  listDeals,
  moveDealStage,
  updateDeal,
} from "../../../../application/crm/deal-use-cases.js";
import type { DealUseCaseDeps } from "../../../../application/crm/deal-use-cases.js";
import { dealVisibleInScope, resolveDealScope } from "../../../../application/sales/sales-context.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const LIST_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    pipelineId: { type: "string" },
    stageId: { type: "string" },
    contactId: { type: "string" },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    origin: { type: "string" },
    search: { type: "string" },
    status: { type: "string", enum: ["open", "won", "lost", "cancelled"] },
    cursor: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 500 },
  },
} as const;
const SUMMARY_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "pipelineId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    pipelineId: { type: "string", minLength: 1 },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    origin: { type: "string" },
    search: { type: "string" },
  },
} as const;
const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "pipelineId", "stageId", "title"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    pipelineId: { type: "string", minLength: 1 },
    stageId: { type: "string", minLength: 1 },
    contactId: { type: "string" },
    title: { type: "string", minLength: 1, maxLength: 200 },
    valueCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    origin: { type: "string", maxLength: 60 },
    expectedCloseDate: { type: "string", format: "date" },
    probability: { type: "integer", minimum: 0, maximum: 100 },
    forecastCategory: { type: "string", enum: ["pipeline", "best_case", "commit"] },
    contractMonths: { type: "integer", minimum: 1, maximum: 600 },
    priceBookId: { type: "string" },
  },
} as const;
const UPDATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    contactId: { type: "string" },
    title: { type: "string", minLength: 1, maxLength: 200 },
    valueCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    origin: { type: "string", maxLength: 60 },
    expectedCloseDate: { type: "string", format: "date" },
  },
} as const;
const MOVE_STAGE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "stageId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    stageId: { type: "string", minLength: 1 },
    lossReason: { type: "string", minLength: 1, maxLength: 400 },
    lossComment: { type: "string", maxLength: 2000 },
  },
} as const;

function translateDealError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("DEAL_NOT_FOUND")) throw new NotFoundError(error.message);
  if (error instanceof Error && (error.message.startsWith("DEAL_STAGE_PIPELINE_MISMATCH") || error.message.startsWith("DEAL_LOSS_REASON_REQUIRED") || error.message.startsWith("DEAL_STAGE_REQUIREMENTS_MISSING") || error.message.startsWith("DEAL_FINAL_VALUE_REQUIRED") || error.message.startsWith("DEAL_CLOSED") || error.message.startsWith("DEAL_VALUE_CALCULATED"))) {
    throw new ValidationError(error.message);
  }
  throw error;
}

export async function registerDealsRoutes(app: FastifyInstance, deps: DealUseCaseDeps): Promise<void> {
  app.get("/deals", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const query = request.query as { workspaceId: string; pipelineId?: string; stageId?: string; contactId?: string; ownerUserId?: string; teamId?: string; origin?: string; search?: string; status?: "open" | "won" | "lost" | "cancelled"; cursor?: string; limit?: number };
    const scope = deps.sales ? await resolveDealScope(deps.sales, { tenantId: principal.tenantId, userId: principal.userId, role: principal.role }, query.workspaceId) : {};
    const deals = await listDeals(deps, { tenantId: principal.tenantId, ...query, ...scope });
    return successEnvelope(deals, request.id);
  });

  app.get("/deals/summary", { schema: { querystring: SUMMARY_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const query = request.query as { workspaceId: string; pipelineId: string; ownerUserId?: string; teamId?: string; origin?: string; search?: string };
    const summary = await getDealsSummary(deps, { tenantId: principal.tenantId, ...query });
    return successEnvelope(summary, request.id);
  });

  app.get("/deals/open-by-contact", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const scope = deps.sales ? await resolveDealScope(deps.sales, { tenantId: principal.tenantId, userId: principal.userId, role: principal.role }, workspaceId) : {};
    const summary = await getContactOpenDealsSummary(deps, { tenantId: principal.tenantId, workspaceId, ...scope });
    return successEnvelope(summary, request.id);
  });

  app.post("/deals", { schema: { body: CREATE_BODY_SCHEMA }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const principal = requirePermission(request, "deal:manage");
    const body = request.body as Record<string, unknown> & { workspaceId: string; pipelineId: string; stageId: string; title: string };
    try {
      const deal = await createDeal(deps, { tenantId: principal.tenantId, ...body, actorUserId: principal.userId } as never);
      reply.code(201);
      return successEnvelope(deal, request.id);
    } catch (error) {
      translateDealError(error);
    }
  });

  app.get("/deals/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const deal = await getDeal(deps, { dealId: id, tenantId: principal.tenantId, workspaceId });
      if (deps.sales && !dealVisibleInScope(deal, await resolveDealScope(deps.sales, { tenantId: principal.tenantId, userId: principal.userId, role: principal.role }, workspaceId))) {
        throw new Error(`DEAL_NOT_FOUND: oportunidade "${id}" não existe.`);
      }
      return successEnvelope(deal, request.id);
    } catch (error) {
      translateDealError(error);
    }
  });

  app.patch("/deals/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const deal = await updateDeal(deps, { dealId: id, tenantId: principal.tenantId, workspaceId, patch: patch as never, actorUserId: principal.userId });
      return successEnvelope(deal, request.id);
    } catch (error) {
      translateDealError(error);
    }
  });

  app.post("/deals/:id/move-stage", { schema: { params: ID_PARAMS_SCHEMA, body: MOVE_STAGE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, stageId, lossReason, lossComment } = request.body as { workspaceId: string; stageId: string; lossReason?: string; lossComment?: string };
    try {
      const deal = await moveDealStage(deps, { dealId: id, tenantId: principal.tenantId, workspaceId, targetStageId: stageId, lossReason, lossComment, actorUserId: principal.userId });
      return successEnvelope(deal, request.id);
    } catch (error) {
      translateDealError(error);
    }
  });

  app.get("/deals/:id/timeline", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const timeline = await getDealTimeline(deps, { dealId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(timeline, request.id);
    } catch (error) {
      translateDealError(error);
    }
  });
}
