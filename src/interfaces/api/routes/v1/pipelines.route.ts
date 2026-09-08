import type { FastifyInstance } from "fastify";
import {
  createPipeline,
  createStage,
  deleteStage,
  listPipelines,
  listStages,
  updateStage,
} from "../../../../application/crm/pipeline-use-cases.js";
import type { PipelineUseCaseDeps } from "../../../../application/crm/pipeline-use-cases.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const STAGE_PARAMS_SCHEMA = { type: "object", required: ["id", "stageId"], properties: { id: { type: "string", minLength: 1 }, stageId: { type: "string", minLength: 1 } } } as const;
const CREATE_PIPELINE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 120 } },
} as const;
const CREATE_STAGE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name", "position"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    position: { type: "integer", minimum: 0 },
    isWon: { type: "boolean" },
    isLost: { type: "boolean" },
  },
} as const;
const UPDATE_STAGE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    position: { type: "integer", minimum: 0 },
    isWon: { type: "boolean" },
    isLost: { type: "boolean" },
  },
} as const;

function translatePipelineError(error: unknown): never {
  if (error instanceof Error && (error.message.startsWith("PIPELINE_NOT_FOUND") || error.message.startsWith("PIPELINE_STAGE_NOT_FOUND"))) {
    throw new NotFoundError(error.message);
  }
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23503") {
    throw new ValidationError("PIPELINE_STAGE_HAS_DEALS: esta etapa tem negócios associados — mova-os antes de excluir a etapa.");
  }
  throw error;
}

export async function registerPipelinesRoutes(app: FastifyInstance, deps: PipelineUseCaseDeps): Promise<void> {
  app.get("/pipelines", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const pipelines = await listPipelines(deps, principal.tenantId, workspaceId);
    return successEnvelope(pipelines, request.id);
  });

  app.post("/pipelines", { schema: { body: CREATE_PIPELINE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "deal:manage");
    const { workspaceId, name } = request.body as { workspaceId: string; name: string };
    const pipeline = await createPipeline(deps, { tenantId: principal.tenantId, workspaceId, name });
    reply.code(201);
    return successEnvelope(pipeline, request.id);
  });

  app.get("/pipelines/:id/stages", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const stages = await listStages(deps, { pipelineId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(stages, request.id);
    } catch (error) {
      translatePipelineError(error);
    }
  });

  app.post("/pipelines/:id/stages", { schema: { params: ID_PARAMS_SCHEMA, body: CREATE_STAGE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "deal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, name, position, isWon, isLost } = request.body as { workspaceId: string; name: string; position: number; isWon?: boolean; isLost?: boolean };
    try {
      const stage = await createStage(deps, { pipelineId: id, tenantId: principal.tenantId, workspaceId, name, position, isWon, isLost });
      reply.code(201);
      return successEnvelope(stage, request.id);
    } catch (error) {
      translatePipelineError(error);
    }
  });

  app.patch("/pipelines/:id/stages/:stageId", { schema: { params: STAGE_PARAMS_SCHEMA, body: UPDATE_STAGE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "deal:manage");
    const { id, stageId } = request.params as { id: string; stageId: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const stage = await updateStage(deps, { pipelineId: id, stageId, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(stage, request.id);
    } catch (error) {
      translatePipelineError(error);
    }
  });

  app.delete("/pipelines/:id/stages/:stageId", { schema: { params: STAGE_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "deal:manage");
    const { id, stageId } = request.params as { id: string; stageId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await deleteStage(deps, { pipelineId: id, stageId, tenantId: principal.tenantId, workspaceId });
      reply.code(204);
      return null;
    } catch (error) {
      translatePipelineError(error);
    }
  });
}
