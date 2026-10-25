import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  cancelProvisioningSession,
  connectRecorderAccount,
  disableRecorderAccount,
  getProvisioningSessionStatus,
  getRecordingCapacity,
  listTenantRecorderAccounts,
  reconnectRecorderAccount,
  RecorderAccountError,
  removeRecorderAccount,
  testRecorderAccount,
  type RecorderAccountActor,
  type RecorderAccountDeps,
} from "../../../../application/meetings/recorder-accounts.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { AppError, NotFoundError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { PROVISIONING_STREAM_PATH } from "../../meetings-provisioning-stream.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";

/**
 * Meetings → Configurações → Contas de gravação (self-service do cliente). Gerenciar exige
 * `meeting:manage_recorder_accounts` (admin/owner do tenant); o resumo de capacidade é visível a
 * quem lê reuniões. Nenhuma resposta carrega sessão, cookie ou referência a segredo.
 */
export type MeetingRecorderAccountRoutesDeps = RecorderAccountDeps & { workspaceRepository: WorkspaceRepositoryPort; streamAvailable: boolean };

const WORKSPACE_QUERY = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ACCOUNT_PARAMS = { type: "object", required: ["accountId"], properties: { accountId: { type: "string", minLength: 1, maxLength: 100 } } } as const;
const SESSION_PARAMS = { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string", minLength: 1, maxLength: 100 } } } as const;
const CONNECT_BODY = {
  type: "object",
  required: ["workspaceId", "label", "googleEmail"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1, maxLength: 80 },
    googleEmail: { type: "string", minLength: 3, maxLength: 254 },
  },
} as const;

function actorOf(request: FastifyRequest, permission: "meeting:read" | "meeting:manage_recorder_accounts"): RecorderAccountActor {
  const principal = requirePermission(request, permission);
  return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, permissions: principal.permissions };
}

function translate(error: unknown): never {
  if (error instanceof RecorderAccountError) {
    const message = error.message.slice(error.code.length + 1).trim();
    if (error.code === "RECORDER_ACCOUNT_NOT_FOUND" || error.code === "RECORDER_PROVISIONING_NOT_FOUND") throw new NotFoundError(message);
    const statusCode = error.code === "RECORDER_ACCOUNT_FORBIDDEN" ? 403 : error.code === "RECORDER_ACCOUNT_INVALID_INPUT" ? 400 : 409;
    throw new AppError({ code: error.code, message, statusCode, recoverable: statusCode === 409 });
  }
  throw error;
}

export async function registerMeetingRecorderAccountRoutes(app: FastifyInstance, deps: MeetingRecorderAccountRoutesDeps): Promise<void> {
  app.get("/meetings/recording-capacity", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:read");
    const { workspaceId } = request.query as { workspaceId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId });
    return successEnvelope(await getRecordingCapacity(deps, actor), request.id);
  });

  app.get("/meetings/recorder-accounts", { schema: { querystring: WORKSPACE_QUERY } }, async (request) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const { workspaceId } = request.query as { workspaceId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId });
    try {
      return successEnvelope({ ...(await listTenantRecorderAccounts(deps, actor)), selfServiceAvailable: deps.streamAvailable }, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/meetings/recorder-accounts", { schema: { body: CONNECT_BODY }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const body = request.body as { workspaceId: string; label: string; googleEmail: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId: body.workspaceId });
    try {
      const started = await connectRecorderAccount(deps, actor, body);
      reply.code(201);
      return successEnvelope({ ...started, streamPath: PROVISIONING_STREAM_PATH }, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/meetings/recorder-accounts/:accountId/reconnect", { schema: { params: ACCOUNT_PARAMS, body: WORKSPACE_QUERY }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const { accountId } = request.params as { accountId: string };
    const { workspaceId } = request.body as { workspaceId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId });
    try {
      const started = await reconnectRecorderAccount(deps, actor, { workspaceId, accountId });
      reply.code(201);
      return successEnvelope({ ...started, streamPath: PROVISIONING_STREAM_PATH }, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/meetings/recorder-accounts/:accountId/test", { schema: { params: ACCOUNT_PARAMS }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const { accountId } = request.params as { accountId: string };
    try {
      const account = await testRecorderAccount(deps, actor, { accountId });
      reply.code(202);
      return successEnvelope(account, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/meetings/recorder-accounts/:accountId/disable", { schema: { params: ACCOUNT_PARAMS }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const { accountId } = request.params as { accountId: string };
    try { return successEnvelope(await disableRecorderAccount(deps, actor, { accountId }), request.id); }
    catch (error) { translate(error); }
  });

  app.delete("/meetings/recorder-accounts/:accountId", { schema: { params: ACCOUNT_PARAMS }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const { accountId } = request.params as { accountId: string };
    try {
      await removeRecorderAccount(deps, actor, { accountId });
      return successEnvelope({ removed: true }, request.id);
    } catch (error) { translate(error); }
  });

  app.get("/meetings/recorder-provisioning/:sessionId", { schema: { params: SESSION_PARAMS } }, async (request) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const { sessionId } = request.params as { sessionId: string };
    try { return successEnvelope(await getProvisioningSessionStatus(deps, actor, { sessionId }), request.id); }
    catch (error) { translate(error); }
  });

  app.post("/meetings/recorder-provisioning/:sessionId/cancel", { schema: { params: SESSION_PARAMS }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "meeting:manage_recorder_accounts");
    const { sessionId } = request.params as { sessionId: string };
    try {
      await cancelProvisioningSession(deps, actor, { sessionId });
      return successEnvelope({ cancelled: true }, request.id);
    } catch (error) { translate(error); }
  });
}
