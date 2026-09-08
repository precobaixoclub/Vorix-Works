import type { FastifyInstance } from "fastify";
import {
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRule,
  listAutomationRules,
  listAutomationRunLogs,
  updateAutomationRule,
} from "../../../../application/crm/automation-use-cases.js";
import type { AutomationUseCaseDeps } from "../../../../application/crm/automation-use-cases.js";
import { AUTOMATION_ACTIONS, AUTOMATION_CONDITION_FIELDS, AUTOMATION_TRIGGERS } from "../../../../domain/crm/crm.model.js";
import { NotFoundError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CONDITION_SCHEMA = {
  type: "object",
  required: ["field", "equals"],
  additionalProperties: false,
  properties: { field: { type: "string", enum: [...AUTOMATION_CONDITION_FIELDS] }, equals: { type: "string", minLength: 1, maxLength: 120 } },
} as const;
const ACTION_CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskType: { type: "string" },
    taskTitle: { type: "string", maxLength: 200 },
    tag: { type: "string", maxLength: 60 },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    targetStageId: { type: "string" },
  },
} as const;
const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name", "trigger", "action", "actionConfig"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    trigger: { type: "string", enum: [...AUTOMATION_TRIGGERS] },
    conditions: { type: "array", items: CONDITION_SCHEMA, maxItems: 3 },
    action: { type: "string", enum: [...AUTOMATION_ACTIONS] },
    actionConfig: ACTION_CONFIG_SCHEMA,
  },
} as const;
const UPDATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: { ...CREATE_BODY_SCHEMA.properties, active: { type: "boolean" } },
} as const;

function translateAutomationError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("AUTOMATION_RULE_NOT_FOUND")) throw new NotFoundError(error.message);
  throw error;
}

export async function registerAutomationRulesRoutes(app: FastifyInstance, deps: AutomationUseCaseDeps): Promise<void> {
  app.get("/automation-rules", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "automation:manage");
    const { workspaceId } = request.query as { workspaceId: string };
    const rules = await listAutomationRules(deps, { tenantId: principal.tenantId, workspaceId });
    return successEnvelope(rules, request.id);
  });

  app.post("/automation-rules", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "automation:manage");
    const body = request.body as Record<string, unknown> & { workspaceId: string };
    const rule = await createAutomationRule(deps, { tenantId: principal.tenantId, conditions: [], ...body } as never);
    reply.code(201);
    return successEnvelope(rule, request.id);
  });

  app.get("/automation-rules/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "automation:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const rule = await getAutomationRule(deps, { ruleId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(rule, request.id);
    } catch (error) {
      translateAutomationError(error);
    }
  });

  app.patch("/automation-rules/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "automation:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const rule = await updateAutomationRule(deps, { ruleId: id, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(rule, request.id);
    } catch (error) {
      translateAutomationError(error);
    }
  });

  app.delete("/automation-rules/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "automation:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await deleteAutomationRule(deps, { ruleId: id, tenantId: principal.tenantId, workspaceId });
      reply.code(204);
      return null;
    } catch (error) {
      translateAutomationError(error);
    }
  });

  app.get("/automation-rules/:id/run-logs", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "automation:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const logs = await listAutomationRunLogs(deps, { ruleId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(logs, request.id);
    } catch (error) {
      translateAutomationError(error);
    }
  });
}
