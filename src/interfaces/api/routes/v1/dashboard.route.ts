import type { FastifyInstance } from "fastify";
import { getDashboard, type DashboardDeps } from "../../../../application/dashboard/dashboard-use-cases.js";
import type { SlaPolicyScope } from "../../../../application/ports/dashboard-repository.port.js";
import { resolveAccessContext, assertCanConfigureTeam } from "../../../../application/identity/access-control-use-cases.js";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "../../../../domain/dashboard/dashboard-metrics.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission, requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const DASHBOARD_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    viewing: { type: "string", minLength: 1, maxLength: 120 },
    period: { type: "string", enum: [...DASHBOARD_PERIODS] },
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    connectionId: { type: "string", minLength: 1 },
  },
} as const;
const SLA_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "scopeType"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    scopeType: { type: "string", enum: ["workspace", "team", "connection"] },
    scopeId: { type: "string", minLength: 1 },
    firstResponseMinutes: { type: ["integer", "null"], minimum: 1, maximum: 100_000 },
    resolutionMinutes: { type: ["integer", "null"], minimum: 1, maximum: 1_000_000 },
  },
} as const;

function translate(error: unknown): never {
  if (error instanceof Error) {
    const [code, ...rest] = error.message.split(": ");
    const message = rest.join(": ") || error.message;
    if (code === "DASHBOARD_SCOPE_FORBIDDEN" || code === "SALES_REPORT_FORBIDDEN" || code === "ACCESS_TEAM_SCOPE_FORBIDDEN") throw new ForbiddenError(message);
    if (code === "DASHBOARD_WORKSPACE_NOT_FOUND") throw new NotFoundError(message);
    if (code === "DASHBOARD_PERIOD_INVALID" || code === "DASHBOARD_VIEWING_INVALID") throw new ValidationError(message);
  }
  throw error;
}

/**
 * Dashboard principal (Atendimento, SLA, CSAT, Comercial e Metas). Qualquer pessoa autenticada
 * vê ao menos os PRÓPRIOS números; equipes/empresa dependem do escopo — revalidado aqui, nunca só
 * escondido na tela. Fórmulas e regras temporais: `docs/dashboard-indicadores.md`.
 */
export async function registerDashboardRoutes(app: FastifyInstance, deps: DashboardDeps): Promise<void> {
  app.get("/dashboard", { schema: { querystring: DASHBOARD_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const query = request.query as { workspaceId: string; viewing?: string; period?: DashboardPeriod; from?: string; to?: string; connectionId?: string };
    try {
      return successEnvelope(await getDashboard(deps, principal, query), request.id);
    } catch (error) { translate(error); }
  });

  // SLA: prazos de primeira resposta e resolução, por empresa/equipe/canal. Empresa e canal são
  // configuração administrativa; a equipe pode ser configurada por quem a gerencia.
  app.get("/inbox/sla-policies", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const workspace = await deps.workspaceRepository.getById(workspaceId);
    if (!workspace || workspace.tenantId !== principal.tenantId) throw new NotFoundError("Workspace não encontrado.");
    return successEnvelope(await deps.dashboardRepository.listSlaPolicies(workspaceId), request.id);
  });

  app.put("/inbox/sla-policies", { schema: { body: SLA_BODY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const body = request.body as { workspaceId: string; scopeType: SlaPolicyScope; scopeId?: string; firstResponseMinutes?: number | null; resolutionMinutes?: number | null };
    try {
      const workspace = await deps.workspaceRepository.getById(body.workspaceId);
      if (!workspace || workspace.tenantId !== principal.tenantId) throw new NotFoundError("Workspace não encontrado.");
      if ((body.scopeType === "workspace") !== !body.scopeId) throw new ValidationError("SLA_SCOPE_INVALID: informe a equipe ou o canal (e nada para a empresa).");
      if (body.scopeType === "team") {
        const team = await deps.teamRepository?.getById(body.scopeId!);
        if (!team || team.tenantId !== principal.tenantId || team.workspaceId !== body.workspaceId) throw new NotFoundError("Equipe não encontrada.");
        assertCanConfigureTeam(await resolveAccessContext(deps, principal), "inbox:configure_kanban", "inbox", body.scopeId);
      } else {
        requirePermission(request, "inbox:manage_service");
      }
      if (!body.firstResponseMinutes && !body.resolutionMinutes) {
        await deps.dashboardRepository.deleteSlaPolicy({ workspaceId: body.workspaceId, scopeType: body.scopeType, scopeId: body.scopeId });
        return successEnvelope({ deleted: true }, request.id);
      }
      const policy = await deps.dashboardRepository.upsertSlaPolicy({
        tenantId: principal.tenantId,
        workspaceId: body.workspaceId,
        scopeType: body.scopeType,
        scopeId: body.scopeId,
        firstResponseSeconds: body.firstResponseMinutes ? body.firstResponseMinutes * 60 : undefined,
        resolutionSeconds: body.resolutionMinutes ? body.resolutionMinutes * 60 : undefined,
        updatedBy: principal.userId,
      });
      return successEnvelope(policy, request.id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      translate(error);
    }
  });
}
