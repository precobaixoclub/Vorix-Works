import type { TeamMembershipRepositoryPort } from "../../../../application/ports/team-repository.port.js";
import { hasPermission } from "../../../../domain/identity/identity.model.js";
import { readableTeamIds, resolveAccessContext, scopeFor, teamScopeUserIds } from "../../../../application/identity/access-control-use-cases.js";
import { ForbiddenError } from "../../http/app-error.js";
import type { FastifyInstance } from "fastify";
import { getCommercialMetrics } from "../../../../application/crm/commercial-metrics-use-cases.js";
import type { CommercialMetricsUseCaseDeps } from "../../../../application/crm/commercial-metrics-use-cases.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
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

export async function registerCommercialMetricsRoutes(app: FastifyInstance, deps: CommercialMetricsUseCaseDeps & { teamMembershipRepository?: TeamMembershipRepositoryPort }): Promise<void> {
  app.get("/commercial-metrics", { schema: { querystring: QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const query = request.query as import("../../../../application/ports/commercial-metrics-repository.port.js").CommercialMetricsFilter & { workspaceId: string; pipelineId?: string; ownerUserId?: string; teamId?: string; origin?: string; dateFrom?: string; dateTo?: string };
    // Escopo (0173): sem `deal:view_all`, o relatório é sempre recortado — equipe própria (com
    // `deal:view_team`) ou só as próprias oportunidades. Nunca o agregado da empresa.
    if (!hasPermission(principal, "deal:view_all")) {
      const context = await resolveAccessContext(deps, principal);
      const teamScope = scopeFor(context, "deal") === "team";
      if (query.teamId && !(teamScope && readableTeamIds(context).includes(query.teamId))) throw new ForbiddenError("Esta equipe está fora do seu escopo.");
      query.ownerUserIdsIn = teamScope ? await teamScopeUserIds(deps, context) : [principal.userId];
      if (teamScope) { query.teamIdsIn = readableTeamIds(context); query.ownUserId = principal.userId; }
      if (!query.teamId) {
        const allowed = teamScope ? await teamScopeUserIds(deps, context) : [principal.userId];
        if (query.ownerUserId && !allowed.includes(query.ownerUserId)) throw new ForbiddenError("Esta pessoa está fora do seu escopo.");
        query.ownerUserId = query.ownerUserId ?? principal.userId;
      }
    }
    const report = await getCommercialMetrics(deps, { ...query, tenantId: principal.tenantId });
    return successEnvelope(report, request.id);
  });
}
