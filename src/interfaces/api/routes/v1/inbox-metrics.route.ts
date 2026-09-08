import type { FastifyInstance } from "fastify";
import { getInboxMetrics } from "../../../../application/inbox/inbox-metrics-use-cases.js";
import type { InboxMetricsUseCaseDeps } from "../../../../application/inbox/inbox-metrics-use-cases.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    dateFrom: { type: "string" },
    dateTo: { type: "string" },
  },
} as const;

export async function registerInboxMetricsRoutes(app: FastifyInstance, deps: InboxMetricsUseCaseDeps): Promise<void> {
  app.get("/inbox/metrics", { schema: { querystring: QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { workspaceId, dateFrom, dateTo } = request.query as { workspaceId: string; dateFrom?: string; dateTo?: string };
    const report = await getInboxMetrics(deps, { tenantId: principal.tenantId, workspaceId, dateFrom, dateTo });
    return successEnvelope(report, request.id);
  });
}
