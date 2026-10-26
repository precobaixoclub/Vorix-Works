import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthPrincipal, Permission } from "../../../../domain/identity/identity.model.js";
import { RADAR_KEYWORD_CATEGORIES, RADAR_RISK_LEVELS, type RadarKeywordCategory, type RadarRiskLevel, type RadarSettings } from "../../../../domain/radar/radar.model.js";
import type { TeamMembershipRepositoryPort } from "../../../../application/ports/team-repository.port.js";
import type { RadarScope } from "../../../../application/ports/radar-repository.port.js";
import { readableTeamIds, resolveAccessContext, scopeFor } from "../../../../application/identity/access-control-use-cases.js";
import {
  deleteRadarKeyword,
  dismissRadarAlert,
  getRadarAlertDetail,
  getRadarCredits,
  getRadarSettings,
  getRadarStats,
  listRadarAlerts,
  listRadarKeywords,
  reactivateRadarAlert,
  reanalyzeRadarAlert,
  resolveRadarScope,
  setRadarTeamEnabled,
  updateRadarSettings,
  upsertRadarKeyword,
  type RadarUseCaseDeps,
} from "../../../../application/radar/radar-use-cases.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Radar de Sentimento / Radar Operacional (réplica adaptada do CMDesk, pedido explícito do
 * usuário), com controle por créditos de IA.
 *
 * `tenantId` vem SEMPRE do principal autenticado, e toda rota resolve o escopo do usuário
 * (`resolveRadarScope`) antes de ler ou agir — nenhuma rota do Radar ignora tenant/equipe.
 *
 * Nenhuma rota de leitura consome crédito: listar, filtrar, ver detalhe e ver o último diagnóstico
 * só leem do banco. Crédito só é consumido por uma análise profunda de fato executada (`POST
 * /radar/alerts/:conversationId/reanalyze`, ou o gatilho automático no worker).
 *
 * Falta de crédito NUNCA vira erro HTTP nas rotas de leitura — a tela abre normalmente, com o
 * score heurístico e o último diagnóstico; o estado da IA vai nos próprios dados.
 */
export type RadarRoutesDeps = RadarUseCaseDeps & {
  /** `undefined` só em setups sem identidade real — nesse caso quem não é owner/admin fica
   * restrito às conversas atribuídas a si mesmo (nunca ganha escopo a mais por falta de dado). */
  teamMembershipRepository?: TeamMembershipRepositoryPort;
};

const WORKSPACE_QUERY_PROPERTIES = { workspaceId: { type: "string", minLength: 1 } } as const;
const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: WORKSPACE_QUERY_PROPERTIES } as const;
const CONVERSATION_PARAMS_SCHEMA = { type: "object", required: ["conversationId"], properties: { conversationId: { type: "string", minLength: 1 } } } as const;

const LIST_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    ...WORKSPACE_QUERY_PROPERTIES,
    level: { type: "string", enum: [...RADAR_RISK_LEVELS] },
    teamId: { type: "string", minLength: 1 },
    agentId: { type: "string", minLength: 1 },
    minScore: { type: "integer", minimum: 0, maximum: 100 },
    dismissed: { type: "boolean" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;

const STATS_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { ...WORKSPACE_QUERY_PROPERTIES, teamId: { type: "string", minLength: 1 }, agentId: { type: "string", minLength: 1 } },
} as const;

const DISMISS_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { ...WORKSPACE_QUERY_PROPERTIES, note: { type: "string", maxLength: 500 } },
} as const;

const WORKSPACE_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: WORKSPACE_QUERY_PROPERTIES } as const;

const SETTINGS_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    ...WORKSPACE_QUERY_PROPERTIES,
    radarEnabled: { type: "boolean" },
    aiAnalysisEnabled: { type: "boolean" },
    aiTriggerThreshold: { type: "integer", minimum: 1, maximum: 100 },
    aiCooldownMinutes: { type: "integer", minimum: 1, maximum: 1440 },
    slaMinutes: { type: "integer", minimum: 1, maximum: 10080 },
  },
} as const;

const TEAM_FLAG_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "enabled"],
  properties: { ...WORKSPACE_QUERY_PROPERTIES, enabled: { type: "boolean" } },
} as const;

const KEYWORD_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "keyword", "category"],
  properties: {
    ...WORKSPACE_QUERY_PROPERTIES,
    teamId: { type: "string", minLength: 1 },
    keyword: { type: "string", minLength: 2, maxLength: 80 },
    category: { type: "string", enum: [...RADAR_KEYWORD_CATEGORIES] },
    weight: { type: "integer", minimum: 0, maximum: 100 },
    enabled: { type: "boolean" },
  },
} as const;

const RADAR_ERROR_STATUS: Record<string, number> = {
  RADAR_ALERT_NOT_FOUND: 404,
  RADAR_TEAM_NOT_FOUND: 404,
  RADAR_WORKSPACE_NOT_FOUND: 404,
  RADAR_KEYWORD_NOT_FOUND: 404,
  RADAR_INVALID_SETTINGS: 400,
  RADAR_INVALID_KEYWORD: 400,
};

function toAppError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const code = error.message.split(":")[0];
  const statusCode = RADAR_ERROR_STATUS[code];
  if (!statusCode) return error;
  return new AppError({ code, message: error.message.slice(code.length + 1).trim() || error.message, statusCode, recoverable: true });
}

export async function registerRadarRoutes(app: FastifyInstance, deps: RadarRoutesDeps): Promise<void> {
  async function resolveScope(principal: AuthPrincipal, workspaceId: string): Promise<RadarScope> {
    const context = await resolveAccessContext(deps, principal);
    const level = scopeFor(context, "inbox");
    return resolveRadarScope({ tenantId: principal.tenantId, workspaceId, userId: principal.userId, level, teamIds: level === "team" ? readableTeamIds(context) : [] });
  }

  async function authorize(request: FastifyRequest, permission: Permission, workspaceId: string): Promise<{ principal: AuthPrincipal; scope: RadarScope }> {
    const principal = requirePermission(request, permission);
    return { principal, scope: await resolveScope(principal, workspaceId) };
  }

  app.get("/radar/alerts", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const query = request.query as { workspaceId: string; level?: RadarRiskLevel; teamId?: string; agentId?: string; minScore?: number; dismissed?: boolean; limit?: number; offset?: number };
    const { scope } = await authorize(request, "radar:read", query.workspaceId);
    const alerts = await listRadarAlerts(deps, {
      scope,
      filter: { level: query.level, teamId: query.teamId, agentId: query.agentId, minScore: query.minScore, dismissed: query.dismissed, limit: query.limit, offset: query.offset },
    });
    return successEnvelope({ alerts }, request.id);
  });

  app.get("/radar/stats", { schema: { querystring: STATS_QUERY_SCHEMA } }, async (request) => {
    const query = request.query as { workspaceId: string; teamId?: string; agentId?: string };
    const { scope } = await authorize(request, "radar:read", query.workspaceId);
    const stats = await getRadarStats(deps, { scope, filter: { teamId: query.teamId, agentId: query.agentId } });
    return successEnvelope(stats, request.id);
  });

  /** Saldo de créditos de IA para o banner/indicador da tela — reaproveita o serviço central de
   * créditos, só leitura. */
  app.get("/radar/credits", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "radar:read");
    const credits = await getRadarCredits(deps, { tenantId: principal.tenantId });
    return successEnvelope(credits, request.id);
  });

  app.get("/radar/alerts/:conversationId", { schema: { params: CONVERSATION_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const { scope } = await authorize(request, "radar:read", workspaceId);
    try {
      return successEnvelope(await getRadarAlertDetail(deps, { scope, conversationId }), request.id);
    } catch (error) {
      throw toAppError(error);
    }
  });

  app.post("/radar/alerts/:conversationId/dismiss", { schema: { params: CONVERSATION_PARAMS_SCHEMA, body: DISMISS_BODY_SCHEMA } }, async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    const body = request.body as { workspaceId: string; note?: string };
    const { principal, scope } = await authorize(request, "radar:manage", body.workspaceId);
    try {
      return successEnvelope(await dismissRadarAlert(deps, { scope, conversationId, userId: principal.userId, note: body.note }), request.id);
    } catch (error) {
      throw toAppError(error);
    }
  });

  app.post("/radar/alerts/:conversationId/reactivate", { schema: { params: CONVERSATION_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    const body = request.body as { workspaceId: string };
    const { principal, scope } = await authorize(request, "radar:manage", body.workspaceId);
    try {
      return successEnvelope(await reactivateRadarAlert(deps, { scope, conversationId, userId: principal.userId }), request.id);
    } catch (error) {
      throw toAppError(error);
    }
  });

  /**
   * "Analisar agora" — única rota do Radar que pode consumir crédito. Sempre responde 200 com o
   * desfecho em `outcome` (`completed` | `blocked_no_credits` | `cooldown` | `failed_provider` |
   * `disabled`): falta de crédito ou cooldown são estados de negócio que a tela explica ao
   * usuário, nunca um erro técnico.
   */
  app.post("/radar/alerts/:conversationId/reanalyze", { schema: { params: CONVERSATION_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    const body = request.body as { workspaceId: string };
    const { principal, scope } = await authorize(request, "radar:analyze", body.workspaceId);
    try {
      return successEnvelope(await reanalyzeRadarAlert(deps, { scope, conversationId, userId: principal.userId }), request.id);
    } catch (error) {
      throw toAppError(error);
    }
  });

  app.get("/radar/settings", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "radar:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await getRadarSettings(deps, { tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.put("/radar/settings", { schema: { body: SETTINGS_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "radar:configure");
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Partial<RadarSettings>;
    try {
      return successEnvelope(await updateRadarSettings(deps, { tenantId: principal.tenantId, workspaceId, patch }), request.id);
    } catch (error) {
      throw toAppError(error);
    }
  });

  app.put("/radar/teams/:teamId", { schema: { params: { type: "object", required: ["teamId"], properties: { teamId: { type: "string", minLength: 1 } } }, body: TEAM_FLAG_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "radar:configure");
    const { teamId } = request.params as { teamId: string };
    const body = request.body as { workspaceId: string; enabled: boolean };
    try {
      await setRadarTeamEnabled(deps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, teamId, enabled: body.enabled });
      return successEnvelope({ teamId, radarEnabled: body.enabled }, request.id);
    } catch (error) {
      throw toAppError(error);
    }
  });

  app.get(
    "/radar/keywords",
    { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { ...WORKSPACE_QUERY_PROPERTIES, teamId: { type: "string", minLength: 1 } } } } },
    async (request) => {
      const principal = requirePermission(request, "radar:read");
      const query = request.query as { workspaceId: string; teamId?: string };
      return successEnvelope(await listRadarKeywords(deps, { tenantId: principal.tenantId, workspaceId: query.workspaceId, teamId: query.teamId }), request.id);
    },
  );

  app.put("/radar/keywords", { schema: { body: KEYWORD_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "radar:configure");
    const body = request.body as { workspaceId: string; teamId?: string; keyword: string; category: RadarKeywordCategory; weight?: number; enabled?: boolean };
    try {
      return successEnvelope(await upsertRadarKeyword(deps, { tenantId: principal.tenantId, ...body }), request.id);
    } catch (error) {
      throw toAppError(error);
    }
  });

  app.delete(
    "/radar/keywords/:id",
    { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } }, querystring: WORKSPACE_QUERY_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "radar:configure");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };
      try {
        await deleteRadarKeyword(deps, { tenantId: principal.tenantId, workspaceId, id });
        return successEnvelope({ deleted: true }, request.id);
      } catch (error) {
        throw toAppError(error);
      }
    },
  );
}
