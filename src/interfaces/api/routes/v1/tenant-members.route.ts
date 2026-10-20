import type { FastifyInstance } from "fastify";
import { acceptInvite, inviteMember, listTenantInvites, listTenantMembers, removeMember, revokeInvite, updateMemberRole } from "../../../../application/identity/invite-use-cases.js";
import type { InviteUseCaseDeps } from "../../../../application/identity/invite-use-cases.js";
import { registerUser } from "../../../../application/identity/register-user.usecase.js";
import { updateMemberProfile } from "../../../../application/identity/member-profile-use-cases.js";
import type { PasswordHasherPort } from "../../../../application/ports/password-hasher.port.js";
import { normalizeUserAvatar } from "../../../../infrastructure/auth/user-avatar.js";
import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";
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
const PROFILE_PROPERTIES = {
  name: { type: "string", minLength: 1, maxLength: 150 },
  email: { type: "string", format: "email", maxLength: 320 },
  avatarUrl: { type: ["string", "null"], maxLength: 2_800_000 },
} as const;
const PROFILE_SCHEMA = { type: "object", required: ["name", "email"], additionalProperties: false, properties: PROFILE_PROPERTIES } as const;
const CREATE_MEMBER_SCHEMA = { type: "object", required: ["name", "email", "password", "role"], additionalProperties: false, properties: {
  ...PROFILE_PROPERTIES, password: { type: "string", minLength: 8, maxLength: 72 }, role: UPDATE_ROLE_BODY_SCHEMA.properties.role,
} } as const;

function translateInviteError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("USAGE_LIMIT_REACHED")) throw new ConflictError("Limite de usuários atingido. Ajuste a quantidade em Plano e cobrança antes de cadastrar outro usuário.");
    if (error.message.startsWith("IDENTITY_VALIDATION_ERROR") || error.message.startsWith("USER_EMAIL_ALREADY_EXISTS")) throw new ValidationError(error.message);
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
export async function registerTenantMembersRoutes(app: FastifyInstance, deps: InviteUseCaseDeps & { passwordHasher?: PasswordHasherPort; assertCanAddMember?: (tenantId: string) => Promise<void> }): Promise<void> {
  app.get("/tenant-members", async (request) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const members = await listTenantMembers(deps, principal.tenantId);
    const profiles = await Promise.all(members.map(async (member) => {
      const user = await deps.userRepository.getById(member.userId);
      return { ...member, name: user?.name, email: user?.email, avatarUrl: user?.avatarUrl };
    }));
    return successEnvelope(profiles, request.id);
  });

  app.post("/tenant-members", { bodyLimit: 3_000_000, schema: { body: CREATE_MEMBER_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const body = request.body as { name: string; email: string; password: string; role: "owner" | "admin" | "editor" | "viewer"; avatarUrl?: string | null };
    try {
      if (!deps.passwordHasher) throw new ValidationError("Cadastro indisponível neste ambiente.");
      await deps.assertCanAddMember?.(principal.tenantId);
      const avatarUrl = await normalizeUserAvatar(body.avatarUrl);
      const { user, membership } = await registerUser({ ...deps, passwordHasher: deps.passwordHasher }, { ...body, tenantId: principal.tenantId, avatarUrl: avatarUrl ?? undefined });
      reply.code(201);
      return successEnvelope({ ...membership, name: user.name, email: user.email, avatarUrl: user.avatarUrl }, request.id);
    } catch (error) { translateInviteError(error); }
  });

  app.patch("/tenant-members/:userId/profile", { bodyLimit: 3_000_000, schema: { params: USER_ID_PARAMS_SCHEMA, body: PROFILE_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { userId } = request.params as { userId: string };
    const body = request.body as { name: string; email: string; avatarUrl?: string | null };
    try {
      // Verifica o escopo antes de processar a imagem.
      if (!await deps.membershipRepository.getByUserAndTenant(userId, principal.tenantId)) throw new NotFoundError("Usuário não encontrado nesta conta.");
      const avatarUrl = await normalizeUserAvatar(body.avatarUrl);
      return successEnvelope(await updateMemberProfile(deps, { ...body, tenantId: principal.tenantId, userId, actorUserId: principal.userId, avatarUrl }), request.id);
    } catch (error) { translateInviteError(error); }
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
