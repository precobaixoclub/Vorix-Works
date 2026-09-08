import type { FastifyInstance } from "fastify";
import { getCommercialMetrics } from "../../../../application/crm/commercial-metrics-use-cases.js";
import type { CommercialMetricsUseCaseDeps } from "../../../../application/crm/commercial-metrics-use-cases.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    pipelineId: { type: "string" },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    origin: { type: "string" },
    dateFrom: { type: "string" },
    dateTo: { type: "string" },
  },
} as const;

export async function registerCommercialMetricsRoutes(app: FastifyInstance, deps: CommercialMetricsUseCaseDeps): Promise<void> {
  app.get("/commercial-metrics", { schema: { querystring: QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const query = request.query as { workspaceId: string; pipelineId?: string; ownerUserId?: string; teamId?: string; origin?: string; dateFrom?: string; dateTo?: string };
    const report = await getCommercialMetrics(deps, { tenantId: principal.tenantId, ...query });
    return successEnvelope(report, request.id);
  });
}
