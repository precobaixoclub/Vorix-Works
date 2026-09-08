import type { FastifyInstance } from "fastify";
import { addTeamMember, createTeam, deleteTeam, listTeamMembers, listTeams, removeTeamMember, updateTeam } from "../../../../application/identity/team-use-cases.js";
import type { TeamUseCaseDeps } from "../../../../application/identity/team-use-cases.js";
import { NotFoundError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CREATE_BODY_SCHEMA = { type: "object", required: ["workspaceId", "name"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 200 } } } as const;
const UPDATE_BODY_SCHEMA = { type: "object", required: ["workspaceId", "name"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 200 } } } as const;
const ADD_MEMBER_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "userId", "role"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, userId: { type: "string", minLength: 1 }, role: { type: "string", enum: ["owner", "admin", "editor", "viewer"] } },
} as const;

function translateTeamError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("TEAM_NOT_FOUND")) throw new NotFoundError(error.message);
  throw error;
}

export async function registerTeamsRoutes(app: FastifyInstance, deps: TeamUseCaseDeps): Promise<void> {
  app.get("/teams", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "team:manage");
    const { workspaceId } = request.query as { workspaceId: string };
    const teams = await listTeams(deps, { tenantId: principal.tenantId, workspaceId });
    return successEnvelope(teams, request.id);
  });

  app.post("/teams", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "team:manage");
    const { workspaceId, name } = request.body as { workspaceId: string; name: string };
    const team = await createTeam(deps, { tenantId: principal.tenantId, workspaceId, name });
    reply.code(201);
    return successEnvelope(team, request.id);
  });

  app.patch("/teams/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "team:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, name } = request.body as { workspaceId: string; name: string };
    try {
      const team = await updateTeam(deps, { teamId: id, tenantId: principal.tenantId, workspaceId, name });
      return successEnvelope(team, request.id);
    } catch (error) {
      translateTeamError(error);
    }
  });

  app.delete("/teams/:id", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "team:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      await deleteTeam(deps, { teamId: id, tenantId: principal.tenantId, workspaceId });
      reply.code(204);
      return null;
    } catch (error) {
      translateTeamError(error);
    }
  });

  app.get("/teams/:id/members", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "team:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const members = await listTeamMembers(deps, { teamId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(members, request.id);
    } catch (error) {
      translateTeamError(error);
    }
  });

  app.post("/teams/:id/members", { schema: { params: ID_PARAMS_SCHEMA, body: ADD_MEMBER_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "team:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, userId, role } = request.body as { workspaceId: string; userId: string; role: "owner" | "admin" | "editor" | "viewer" };
    try {
      const membership = await addTeamMember(deps, { teamId: id, tenantId: principal.tenantId, workspaceId, userId, role });
      reply.code(201);
      return successEnvelope(membership, request.id);
    } catch (error) {
      translateTeamError(error);
    }
  });

  app.delete("/teams/:id/members/:userId", {
    schema: { params: { type: "object", required: ["id", "userId"], properties: { id: { type: "string" }, userId: { type: "string" } } }, body: WORKSPACE_QUERY_SCHEMA },
  }, async (request, reply) => {
    const principal = requirePermission(request, "team:manage");
    const { id, userId } = request.params as { id: string; userId: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      await removeTeamMember(deps, { teamId: id, tenantId: principal.tenantId, workspaceId, userId });
      reply.code(204);
      return null;
    } catch (error) {
      translateTeamError(error);
    }
  });
}
