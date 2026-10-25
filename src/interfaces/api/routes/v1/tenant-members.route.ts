import type { FastifyInstance } from "fastify";
import { acceptInvite, inviteMember, listTenantInvites, listTenantMembers, revokeInvite } from "../../../../application/identity/invite-use-cases.js";
import type { InviteUseCaseDeps } from "../../../../application/identity/invite-use-cases.js";
import { registerUser } from "../../../../application/identity/register-user.usecase.js";
import { updateMemberProfile } from "../../../../application/identity/member-profile-use-cases.js";
import type { PasswordHasherPort } from "../../../../application/ports/password-hasher.port.js";
import { normalizeUserAvatar } from "../../../../infrastructure/auth/user-avatar.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";
import type { AuthPrincipal } from "../../../../domain/identity/identity.model.js";
import { hasPermission, ROLE_PERMISSIONS, TENANT_ROLES } from "../../../../domain/identity/identity.model.js";
import { ACCESS_PROFILE_LABELS, PERMISSION_CATALOG } from "../../../../domain/identity/access-control.js";
import {
  assertCanAssignRole,
  getMemberAccess,
  removeMemberSafely,
  resolveAccessContext,
  setMemberStatus,
  teamScopeUserIds,
  updateMemberAccess,
  type AccessControlDeps,
} from "../../../../application/identity/access-control-use-cases.js";
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

const ACCESS_BODY_SCHEMA = {
  type: "object",
  required: ["role"],
  additionalProperties: false,
  properties: {
    role: { type: "string", enum: ["owner", "admin", "editor", "viewer"] },
    permissionGrants: { type: "array", maxItems: 200, items: { type: "string", minLength: 1, maxLength: 80 } },
    permissionRevokes: { type: "array", maxItems: 200, items: { type: "string", minLength: 1, maxLength: 80 } },
  },
} as const;

function translateInviteError(error: unknown): never {
  if (error instanceof Error) {
    // Perfis e permissões (0173) — proteções de acesso.
    if (error.message.startsWith("ACCESS_LAST_OWNER")) throw new ConflictError(error.message);
    if (error.message.startsWith("ACCESS_PERMISSION_UNKNOWN")) throw new ValidationError(error.message);
    if (error.message.startsWith("ACCESS_")) throw new ForbiddenError(error.message.replace(/^[A-Z_]+: /, ""));
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
type TenantMembersRoutesDeps = InviteUseCaseDeps
  & Partial<Pick<AccessControlDeps, "teamRepository" | "teamMembershipRepository" | "accessAuditLog" | "onAccessChanged">>
  & { passwordHasher?: PasswordHasherPort; assertCanAddMember?: (tenantId: string) => Promise<void> };

/**
 * Quem a pessoa pode VER na lista de usuários: com `tenant_member:manage`, todos; senão (gerente
 * com `tenant_member:read`), só os colegas das equipes de que participa. Ver nunca é editar.
 */
async function visibleMemberIds(deps: TenantMembersRoutesDeps, principal: AuthPrincipal): Promise<Set<string> | undefined> {
  if (hasPermission(principal, "tenant_member:manage")) return undefined;
  return new Set(await teamScopeUserIds(deps, await resolveAccessContext(deps, principal)));
}

export async function registerTenantMembersRoutes(app: FastifyInstance, deps: TenantMembersRoutesDeps): Promise<void> {
  const accessDeps: AccessControlDeps = deps;

  app.get("/tenant-members", async (request) => {
    const principal = requirePermission(request, "tenant_member:read");
    const visible = await visibleMemberIds(deps, principal);
    const members = (await listTenantMembers(deps, principal.tenantId)).filter((member) => !visible || visible.has(member.userId));
    const profiles = await Promise.all(members.map(async (member) => {
      const user = await deps.userRepository.getById(member.userId);
      return {
        ...member,
        name: user?.name,
        email: user?.email,
        avatarUrl: user?.avatarUrl,
        // Quantas exceções sobre o perfil — a lista mostra "personalizado" sem abrir o usuário.
        customizedPermissions: member.permissionGrants.length + member.permissionRevokes.length,
      };
    }));
    return successEnvelope(profiles, request.id);
  });

  /** Catálogo das permissões por categoria + padrão de cada perfil — base da tela de edição. */
  app.get("/tenant-members/access-catalog", async (request) => {
    requirePermission(request, "tenant_member:read");
    return successEnvelope({
      profiles: TENANT_ROLES.map((role) => ({ role, label: ACCESS_PROFILE_LABELS[role], permissions: ROLE_PERMISSIONS[role] })),
      categories: PERMISSION_CATALOG,
    }, request.id);
  });

  /** Trilha estruturada de alterações de acesso (perfil, permissões, equipes, status). */
  app.get("/tenant-members/access-audit", { schema: { querystring: { type: "object", properties: { userId: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 500 } } } } }, async (request) => {
    const principal = requirePermission(request, "tenant_member:manage_permissions");
    const { userId, limit } = request.query as { userId?: string; limit?: number };
    return successEnvelope(await deps.accessAuditLog?.list({ tenantId: principal.tenantId, targetUserId: userId, limit }) ?? [], request.id);
  });

  app.get("/tenant-members/:userId/access", { schema: { params: USER_ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "tenant_member:read");
    const { userId } = request.params as { userId: string };
    try {
      const visible = await visibleMemberIds(deps, principal);
      if (visible && !visible.has(userId)) throw new NotFoundError("Usuário não encontrado nesta conta.");
      return successEnvelope(await getMemberAccess(accessDeps, { tenantId: principal.tenantId, userId }), request.id);
    } catch (error) { translateInviteError(error); }
  });

  /** Perfil + exceções de uma vez. Proteções: nunca o próprio usuário, nunca além do próprio acesso,
   * Administrador principal intocável, sempre um Administrador ativo. Auditado. */
  app.put("/tenant-members/:userId/access", { schema: { params: USER_ID_PARAMS_SCHEMA, body: ACCESS_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "tenant_member:manage_permissions");
    const { userId } = request.params as { userId: string };
    const body = request.body as { role: "owner" | "admin" | "editor" | "viewer"; permissionGrants?: string[]; permissionRevokes?: string[] };
    try {
      const actor = await resolveAccessContext(deps, principal);
      return successEnvelope(await updateMemberAccess(accessDeps, actor, { userId, ...body }), request.id);
    } catch (error) { translateInviteError(error); }
  });

  app.post("/tenant-members/:userId/disable", { schema: { params: USER_ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { userId } = request.params as { userId: string };
    try {
      return successEnvelope(await setMemberStatus(accessDeps, await resolveAccessContext(deps, principal), { userId, status: "disabled" }), request.id);
    } catch (error) { translateInviteError(error); }
  });

  app.post("/tenant-members/:userId/enable", { schema: { params: USER_ID_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { userId } = request.params as { userId: string };
    try {
      return successEnvelope(await setMemberStatus(accessDeps, await resolveAccessContext(deps, principal), { userId, status: "active" }), request.id);
    } catch (error) { translateInviteError(error); }
  });

  app.post("/tenant-members", { bodyLimit: 3_000_000, schema: { body: CREATE_MEMBER_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const body = request.body as { name: string; email: string; password: string; role: "owner" | "admin" | "editor" | "viewer"; avatarUrl?: string | null };
    try {
      if (!deps.passwordHasher) throw new ValidationError("Cadastro indisponível neste ambiente.");
      assertCanAssignRole(await resolveAccessContext(deps, principal), body.role);
      await deps.assertCanAddMember?.(principal.tenantId);
      const avatarUrl = await normalizeUserAvatar(body.avatarUrl);
      const { user, membership } = await registerUser({ ...deps, passwordHasher: deps.passwordHasher }, { ...body, tenantId: principal.tenantId, avatarUrl: avatarUrl ?? undefined });
      await deps.accessAuditLog?.record({ tenantId: principal.tenantId, actorUserId: principal.userId, targetUserId: user.id, eventType: "member_created", newValue: { role: membership.role } });
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
      const target = await deps.membershipRepository.getByUserAndTenant(userId, principal.tenantId);
      if (!target) throw new NotFoundError("Usuário não encontrado nesta conta.");
      if (target.role === "owner" && principal.role !== "owner" && userId !== principal.userId) throw new ForbiddenError("Só um Administrador pode editar os dados de outro Administrador.");
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
    try { assertCanAssignRole(await resolveAccessContext(deps, principal), role); } catch (error) { translateInviteError(error); }
    const { invite, rawToken } = await inviteMember(deps, { tenantId: principal.tenantId, email, role, invitedByUserId: principal.userId });
    await deps.accessAuditLog?.record({ tenantId: principal.tenantId, actorUserId: principal.userId, eventType: "invite_created", newValue: { email, role } });
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
    const principal = requirePermission(request, "tenant_member:manage_permissions");
    const { userId } = request.params as { userId: string };
    const { role } = request.body as { role: "owner" | "admin" | "editor" | "viewer" };
    try {
      const access = await updateMemberAccess(accessDeps, await resolveAccessContext(deps, principal), { userId, role });
      return successEnvelope(access, request.id);
    } catch (error) {
      translateInviteError(error);
    }
  });

  app.delete("/tenant-members/:userId", { schema: { params: USER_ID_PARAMS_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { userId } = request.params as { userId: string };
    try {
      await removeMemberSafely(accessDeps, await resolveAccessContext(deps, principal), { userId });
    } catch (error) { translateInviteError(error); }
    reply.code(204);
    return null;
  });
}
