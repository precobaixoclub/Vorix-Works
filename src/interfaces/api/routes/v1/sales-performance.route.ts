import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  deleteGoal,
  getDealGoalImpact,
  getForecast,
  getPerformance,
  getSalesReports,
  getTeamPerformance,
  listGoals,
  setMonthlyGoals, upsertGoal,
  type SalesPerformanceDeps,
} from "../../../../application/sales/sales-performance-use-cases.js";
import type { SalesActor } from "../../../../application/sales/sales-context.js";
import { generateDealAiInsights, getDealInsights, type DealInsightsDeps } from "../../../../application/sales/deal-insights-use-cases.js";
import { dealVisibleInScope, mustDealInWorkspace, resolveDealScope } from "../../../../application/sales/sales-context.js";
import { ForbiddenError, NotFoundError, ServiceUnavailableLikeError, ValidationError } from "./sales-performance-errors.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import type { Permission } from "../../../../domain/identity/identity.model.js";

const WS = { type: "string", minLength: 1 } as const;
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const PERIOD = { type: "string", enum: ["monthly", "quarterly", "annual"] } as const;
const SUBJECT_QUERY = { type: "object", required: ["workspaceId"], properties: { workspaceId: WS, userId: { type: "string" }, teamId: { type: "string" }, periodType: PERIOD, periodStart: DATE } } as const;

function translate(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("SALES_REPORT_FORBIDDEN")) throw new ForbiddenError(error.message);
    if (error.message.startsWith("SALES_GOAL_NOT_FOUND") || error.message.startsWith("DEAL_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("SALES_GOAL_INVALID")) throw new ValidationError(error.message);
    if (error.message.startsWith("DEAL_INSIGHTS_UNAVAILABLE") || error.message.startsWith("DEAL_INSIGHTS_FAILED")) throw new ServiceUnavailableLikeError(error.message);
  }
  throw error;
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    translate(error);
  }
}

function actorFor(request: FastifyRequest, permission: Permission): SalesActor {
  const principal = requirePermission(request, permission);
  return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role };
}

export async function registerSalesPerformanceRoutes(app: FastifyInstance, deps: SalesPerformanceDeps & Partial<Pick<DealInsightsDeps, "proposalRepository" | "conversationReader" | "insightsGenerator">>): Promise<void> {
  async function visible(actor: SalesActor, workspaceId: string, dealId: string) {
    const deal = await mustDealInWorkspace(deps, dealId, actor.tenantId, workspaceId);
    if (!dealVisibleInScope(deal, await resolveDealScope(deps, actor, workspaceId))) throw new Error(`DEAL_NOT_FOUND: oportunidade "${dealId}" não existe.`);
  }

  /** IA comercial — parte determinística (riscos, explicações, impacto na meta), sempre disponível. */
  app.get("/deals/:id/insights", { schema: { params: { type: "object", required: ["id"], properties: { id: WS } }, querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    if (!deps.proposalRepository) throw new NotFoundError("DEAL_NOT_FOUND: insights indisponíveis.");
    return successEnvelope(await guard(async () => {
      await visible(actor, workspaceId, id);
      return getDealInsights(deps as DealInsightsDeps, actor, { workspaceId, dealId: id });
    }), request.id);
  });

  /** IA sob demanda (custo de IA só quando o vendedor pede). Sugestão — nunca execução. */
  app.post("/deals/:id/insights/ai", { schema: { params: { type: "object", required: ["id"], properties: { id: WS } }, body: { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: WS } } } }, async (request) => {
    const actor = actorFor(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    if (!deps.proposalRepository) throw new NotFoundError("DEAL_NOT_FOUND: insights indisponíveis.");
    return successEnvelope(await guard(async () => {
      await visible(actor, workspaceId, id);
      return generateDealAiInsights(deps as DealInsightsDeps, actor, { workspaceId, dealId: id });
    }), request.id);
  });

  app.get("/sales-goals", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS, year: { type: "integer", minimum: 2000, maximum: 2100 }, periodType: PERIOD } } } }, async (request) => {
    const actor = actorFor(request, "goal:read");
    const query = request.query as { workspaceId: string; year?: number; periodType?: "monthly" | "quarterly" | "annual" };
    return successEnvelope(await guard(() => listGoals(deps, actor, query)), request.id);
  });

  app.put("/sales-goals", {
    schema: { body: { type: "object", required: ["workspaceId", "scopeType", "metric", "periodType", "periodStart", "targetValue"], additionalProperties: false, properties: {
      workspaceId: WS, scopeType: { type: "string", enum: ["user", "team", "company"] }, scopeId: { type: "string" },
      metric: { type: "string", enum: ["sales_revenue", "gross_margin", "won_opportunities", "mrr"] }, periodType: PERIOD, periodStart: DATE,
      targetValue: { type: "integer", minimum: 1, maximum: 9_000_000_000_000 }, currency: { type: "string", minLength: 3, maxLength: 3 },
    } } },
  }, async (request) => {
    const actor = actorFor(request, "goal:manage");
    const body = request.body as Parameters<typeof upsertGoal>[2];
    return successEnvelope(await guard(() => upsertGoal(deps, actor, body)), request.id);
  });

  app.put("/sales-goals/monthly", {
    schema: { body: { type: "object", required: ["workspaceId", "scopeType", "metric", "year", "months"], additionalProperties: false, properties: {
      workspaceId: WS, scopeType: { type: "string", enum: ["user", "team", "company"] }, scopeId: { type: "string" },
      metric: { type: "string", enum: ["sales_revenue", "gross_margin", "won_opportunities", "mrr"] }, year: { type: "integer", minimum: 2000, maximum: 2100 },
      months: { type: "array", minItems: 12, maxItems: 12, items: { type: ["integer", "null"], minimum: 0, maximum: 9_000_000_000_000 } },
      currency: { type: "string", minLength: 3, maxLength: 3 },
    } } },
  }, async (request) => {
    const actor = actorFor(request, "goal:manage");
    const body = request.body as Parameters<typeof setMonthlyGoals>[2];
    return successEnvelope(await guard(() => setMonthlyGoals(deps, actor, body)), request.id);
  });

  app.delete("/sales-goals/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: WS } }, querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS } } } }, async (request, reply) => {
    const actor = actorFor(request, "goal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await guard(() => deleteGoal(deps, actor, { workspaceId, goalId: id }));
    reply.code(204);
    return null;
  });

  app.get("/sales-performance", { schema: { querystring: SUBJECT_QUERY } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; userId?: string; teamId?: string; periodType?: "monthly" | "quarterly" | "annual"; periodStart?: string };
    return successEnvelope(await guard(() => getPerformance(deps, actor, query)), request.id);
  });

  app.get("/sales-performance/team", { schema: { querystring: SUBJECT_QUERY } }, async (request) => {
    const actor = actorFor(request, "sales_report:read_team");
    const query = request.query as { workspaceId: string; teamId?: string; periodType?: "monthly" | "quarterly" | "annual"; periodStart?: string };
    return successEnvelope(await guard(() => getTeamPerformance(deps, actor, query)), request.id);
  });

  app.get("/sales-forecast", { schema: { querystring: SUBJECT_QUERY } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; userId?: string; teamId?: string; periodType?: "monthly" | "quarterly" | "annual"; periodStart?: string };
    return successEnvelope(await guard(() => getForecast(deps, actor, query)), request.id);
  });

  app.get("/sales-reports", { schema: { querystring: { type: "object", required: ["workspaceId", "from", "to"], properties: { workspaceId: WS, from: DATE, to: DATE, userId: { type: "string" }, teamId: { type: "string" }, pipelineId: { type: "string" }, origin: { type: "string" } } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const query = request.query as { workspaceId: string; from: string; to: string; userId?: string; teamId?: string; pipelineId?: string; origin?: string };
    const to = new Date(`${query.to}T00:00:00.000Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    return successEnvelope(await guard(() => getSalesReports(deps, actor, { ...query, from: `${query.from}T00:00:00.000Z`, to: to.toISOString() })), request.id);
  });

  app.get("/deals/:id/goal-impact", { schema: { params: { type: "object", required: ["id"], properties: { id: WS } }, querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS } } } }, async (request) => {
    const actor = actorFor(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await guard(async () => {
      const deal = await mustDealInWorkspace(deps, id, actor.tenantId, workspaceId);
      if (!dealVisibleInScope(deal, await resolveDealScope(deps, actor, workspaceId))) throw new Error(`DEAL_NOT_FOUND: oportunidade "${id}" não existe.`);
      return getDealGoalImpact(deps, actor, { workspaceId, dealId: id });
    }), request.id);
  });
}
