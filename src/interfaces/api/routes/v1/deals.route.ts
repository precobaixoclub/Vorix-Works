import type { FastifyInstance } from "fastify";
import {
  createDeal,
  getDeal,
  getDealsSummary,
  getDealTimeline,
  listDeals,
  moveDealStage,
  updateDeal,
} from "../../../../application/crm/deal-use-cases.js";
import type { DealUseCaseDeps } from "../../../../application/crm/deal-use-cases.js";
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
  },
} as const;

function translateDealError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("DEAL_NOT_FOUND")) throw new NotFoundError(error.message);
  if (error instanceof Error && (error.message.startsWith("DEAL_STAGE_PIPELINE_MISMATCH") || error.message.startsWith("DEAL_LOSS_REASON_REQUIRED"))) {
    throw new ValidationError(error.message);
  }
  throw error;
}

export async function registerDealsRoutes(app: FastifyInstance, deps: DealUseCaseDeps): Promise<void> {
  app.get("/deals", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const query = request.query as { workspaceId: string; pipelineId?: string; stageId?: string; contactId?: string; ownerUserId?: string; teamId?: string; origin?: string; search?: string; cursor?: string; limit?: number };
    const deals = await listDeals(deps, { tenantId: principal.tenantId, ...query });
    return successEnvelope(deals, request.id);
  });

  app.get("/deals/summary", { schema: { querystring: SUMMARY_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const query = request.query as { workspaceId: string; pipelineId: string; ownerUserId?: string; teamId?: string; origin?: string; search?: string };
    const summary = await getDealsSummary(deps, { tenantId: principal.tenantId, ...query });
    return successEnvelope(summary, request.id);
  });

  app.post("/deals", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "deal:manage");
    const body = request.body as Record<string, unknown> & { workspaceId: string; pipelineId: string; stageId: string; title: string };
    try {
      const deal = await createDeal(deps, { tenantId: principal.tenantId, ...body } as never);
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
      const deal = await updateDeal(deps, { dealId: id, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(deal, request.id);
    } catch (error) {
      translateDealError(error);
    }
  });

  app.post("/deals/:id/move-stage", { schema: { params: ID_PARAMS_SCHEMA, body: MOVE_STAGE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, stageId, lossReason } = request.body as { workspaceId: string; stageId: string; lossReason?: string };
    try {
      const deal = await moveDealStage(deps, { dealId: id, tenantId: principal.tenantId, workspaceId, targetStageId: stageId, lossReason });
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
