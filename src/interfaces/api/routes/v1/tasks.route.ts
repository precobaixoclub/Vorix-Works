import type { FastifyInstance } from "fastify";
import { cancelTask, completeTask, createTask, getTask, listTasks, updateTask } from "../../../../application/crm/task-use-cases.js";
import type { TaskUseCaseDeps } from "../../../../application/crm/task-use-cases.js";
import { TASK_STATUSES, TASK_TYPES } from "../../../../domain/crm/crm.model.js";
import { NotFoundError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const LIST_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    contactId: { type: "string" },
    dealId: { type: "string" },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    status: { type: "string", enum: [...TASK_STATUSES] },
    cursor: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 500 },
  },
} as const;
const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "type", "title"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    contactId: { type: "string" },
    dealId: { type: "string" },
    type: { type: "string", enum: [...TASK_TYPES] },
    title: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    dueAt: { type: "string" },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
  },
} as const;
const UPDATE_BODY_SCHEMA = { ...CREATE_BODY_SCHEMA, required: ["workspaceId"] } as const;

function translateTaskError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("TASK_NOT_FOUND")) throw new NotFoundError(error.message);
  throw error;
}

export async function registerTasksRoutes(app: FastifyInstance, deps: TaskUseCaseDeps): Promise<void> {
  app.get("/tasks", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "task:read");
    const query = request.query as { workspaceId: string; contactId?: string; dealId?: string; ownerUserId?: string; teamId?: string; status?: (typeof TASK_STATUSES)[number]; cursor?: string; limit?: number };
    const tasks = await listTasks(deps, { tenantId: principal.tenantId, ...query });
    return successEnvelope(tasks, request.id);
  });

  app.post("/tasks", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "task:manage");
    const body = request.body as Record<string, unknown> & { workspaceId: string; type: (typeof TASK_TYPES)[number]; title: string };
    const task = await createTask(deps, { tenantId: principal.tenantId, ...body } as never);
    reply.code(201);
    return successEnvelope(task, request.id);
  });

  app.get("/tasks/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "task:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const task = await getTask(deps, { taskId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(task, request.id);
    } catch (error) {
      translateTaskError(error);
    }
  });

  app.patch("/tasks/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "task:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const task = await updateTask(deps, { taskId: id, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(task, request.id);
    } catch (error) {
      translateTaskError(error);
    }
  });

  app.post("/tasks/:id/complete", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "task:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const task = await completeTask(deps, { taskId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(task, request.id);
    } catch (error) {
      translateTaskError(error);
    }
  });

  app.post("/tasks/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "task:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const task = await cancelTask(deps, { taskId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(task, request.id);
    } catch (error) {
      translateTaskError(error);
    }
  });
}
