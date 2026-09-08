import type { FastifyInstance } from "fastify";
import { acceptInvite, inviteMember, listTenantInvites, listTenantMembers, removeMember, revokeInvite, updateMemberRole } from "../../../../application/identity/invite-use-cases.js";
import type { InviteUseCaseDeps } from "../../../../application/identity/invite-use-cases.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission, requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const INVITE_BODY_SCHEMA = {
  type: "object",
  required: ["email", "role"],
  additionalProperties: false,
  properties: { email: { type: "string", minLength: 3, maxLength: 320 }, role: { type: "string", enum: ["owner", "admin", "editor", "viewer"] } },
} as const;
const UPDATE_ROLE_BODY_SCHEMA = { type: "object", required: ["role"], additionalProperties: false, properties: { role: { type: "string", enum: ["owner", "admin", "editor", "viewer"] } } } as const;
const ACCEPT_BODY_SCHEMA = { type: "object", required: ["token"], additionalProperties: false, properties: { token: { type: "string", minLength: 1 } } } as const;
const USER_ID_PARAMS_SCHEMA = { type: "object", required: ["userId"], properties: { userId: { type: "string", minLength: 1 } } } as const;
const INVITE_ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

function translateInviteError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("INVITE_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("INVITE_NOT_PENDING")) throw new ValidationError(error.message);
    if (error.message.startsWith("INVITE_EXPIRED")) throw new ValidationError(error.message);
    if (error.message.startsWith("INVITE_EMAIL_MISMATCH")) throw new ValidationError(error.message);
    if (error.message.startsWith("USER_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("MEMBERSHIP_NOT_FOUND")) throw new NotFoundError(error.message);
  }
  throw error;
}

/**
 * CRM/Comercial (Fase 1) — Usuários. Fecha o gap encontrado na auditoria: até aqui não existia
 * convite/troca de papel/remoção nenhuma, só signup e listagem read-only.
 */
export async function registerTenantMembersRoutes(app: FastifyInstance, deps: InviteUseCaseDeps): Promise<void> {
  app.get("/tenant-members", async (request) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const members = await listTenantMembers(deps, principal.tenantId);
    return successEnvelope(members, request.id);
  });

  app.get("/tenant-members/invites", async (request) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const invites = await listTenantInvites(deps, principal.tenantId);
    return successEnvelope(invites, request.id);
  });

  app.post("/tenant-members/invites", { schema: { body: INVITE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { email, role } = request.body as { email: string; role: "owner" | "admin" | "editor" | "viewer" };
    const { invite, rawToken } = await inviteMember(deps, { tenantId: principal.tenantId, email, role, invitedByUserId: principal.userId });
    reply.code(201);
    // `rawToken` só existe nesta resposta — nunca persistido em claro (mesmo racional de RefreshToken).
    // Em produção real isto sai por e-mail; devolver aqui também é o que permite testar o fluxo
    // ponta a ponta sem um provedor de e-mail configurado ainda.
    return successEnvelope({ ...invite, rawToken }, request.id);
  });

  app.post("/tenant-members/invites/:id/revoke", { schema: { params: INVITE_ID_PARAMS_SCHEMA } }, async (request) => {
    requirePermission(request, "tenant_member:manage");
    const { id } = request.params as { id: string };
    const revoked = await revokeInvite(deps, id);
    if (!revoked) throw new ValidationError("INVITE_NOT_PENDING: convite não está mais pendente.");
    return successEnvelope(revoked, request.id);
  });

  app.post("/tenant-members/invites/accept", { schema: { body: ACCEPT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const { token } = request.body as { token: string };
    try {
      const membership = await acceptInvite(deps, { rawToken: token, userId: principal.userId });
      return successEnvelope(membership, request.id);
    } catch (error) {
      translateInviteError(error);
    }
  });

  app.patch("/tenant-members/:userId", { schema: { params: USER_ID_PARAMS_SCHEMA, body: UPDATE_ROLE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { userId } = request.params as { userId: string };
    const { role } = request.body as { role: "owner" | "admin" | "editor" | "viewer" };
    try {
      const updated = await updateMemberRole(deps, { userId, tenantId: principal.tenantId, role });
      return successEnvelope(updated, request.id);
    } catch (error) {
      translateInviteError(error);
    }
  });

  app.delete("/tenant-members/:userId", { schema: { params: USER_ID_PARAMS_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { userId } = request.params as { userId: string };
    await removeMember(deps, { userId, tenantId: principal.tenantId });
    reply.code(204);
    return null;
  });
}
