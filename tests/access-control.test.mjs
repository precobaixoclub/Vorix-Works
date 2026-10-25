import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresAccessAuditLog } from "../dist/infrastructure/storage/postgres/postgres-access-audit-log.js";
import { AccessResolver } from "../dist/application/identity/access-resolver.js";
import {
  assertTeamMembershipChangeAllowed,
  canConfigureTeam,
  removeMemberSafely,
  resolveAccessContext,
  scopeFor,
  setMemberStatus,
  updateMemberAccess,
} from "../dist/application/identity/access-control-use-cases.js";
import { assertAccessChangeAllowed, normalizeAccessChange } from "../dist/domain/identity/access-control.js";
import { effectivePermissions, hasPermission, ROLE_PERMISSIONS } from "../dist/domain/identity/identity.model.js";
import { isConversationVisible } from "../dist/application/ports/inbox-conversation-repository.port.js";
import { resolveDealScope } from "../dist/application/sales/sales-context.js";
import { resolveReportSubject } from "../dist/application/sales/sales-performance-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Perfis, direitos de acesso e escopo (migration 0173): perfil = preset, exceções individuais,
 * escopo por equipe, proteções contra autoelevação/autobloqueio e auditoria estruturada.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-acc-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

function repos() {
  return {
    userRepository: new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") }),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") }),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    teamRepository: new PostgresTeamRepository(db.pool),
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    accessAuditLog: new PostgresAccessAuditLog(db.pool),
  };
}

async function company(tenantId) {
  const deps = repos();
  const workspace = await deps.workspaceRepository.create({ tenantId, name: "W" });
  const person = async (role, { accountOwner = false } = {}) => {
    const user = await deps.userRepository.create({ email: `${nextId("p")}@x.com`, passwordHash: "x", name: role });
    await deps.membershipRepository.create({ userId: user.id, tenantId, role });
    if (accountOwner) await db.pool.query("update tenant_members set is_account_owner = true where user_id = $1 and tenant_id = $2", [user.id, tenantId]);
    return user.id;
  };
  const principalOf = async (userId) => {
    const membership = await deps.membershipRepository.getByUserAndTenant(userId, tenantId);
    return { userId, tenantId, role: membership.role, sessionId: "s", isPlatformAdmin: false, permissions: effectivePermissions(membership.role, membership.permissionGrants, membership.permissionRevokes), isAccountOwner: membership.isAccountOwner };
  };
  const contextOf = async (userId) => resolveAccessContext(deps, await principalOf(userId));
  return { deps, workspace, person, principalOf, contextOf };
}

test("presets: Administrador global, Gerente por equipe sem gestão de acesso, Atendente individual", () => {
  for (const permission of ["tenant_member:manage", "tenant_member:manage_permissions", "team:manage", "inbox:view_all", "deal:view_all", "goal:read_all", "sales_report:read_all"]) {
    assert.ok(ROLE_PERMISSIONS.owner.includes(permission), `owner tem ${permission}`);
    assert.ok(!ROLE_PERMISSIONS.admin.includes(permission), `gerente NÃO tem ${permission}`);
  }
  for (const permission of ["inbox:view_team", "deal:view_team", "goal:read_team", "sales_report:read_team", "inbox:configure_kanban", "pipeline:configure", "inbox:waive_csat", "tenant_member:read"]) {
    assert.ok(ROLE_PERMISSIONS.admin.includes(permission), `gerente tem ${permission}`);
    assert.ok(!ROLE_PERMISSIONS.editor.includes(permission), `atendente NÃO tem ${permission}`);
  }
  assert.ok(ROLE_PERMISSIONS.editor.includes("inbox:reply") && ROLE_PERMISSIONS.editor.includes("goal:read"));
  assert.equal(scopeFor({ permissions: ROLE_PERMISSIONS.editor }, "inbox"), "own");
  assert.equal(scopeFor({ permissions: ROLE_PERMISSIONS.admin }, "deal"), "team");
  assert.equal(scopeFor({ permissions: ROLE_PERMISSIONS.owner }, "goal"), "all");
});

test("exceções individuais: concedida, removida e a removida vence; normalização descarta redundâncias", () => {
  const permissions = effectivePermissions("editor", ["inbox:view_team"], ["deal:win"]);
  assert.ok(permissions.includes("inbox:view_team"));
  assert.ok(!permissions.includes("deal:win"));
  assert.ok(hasPermission({ role: "editor", permissions }, "inbox:view_team"));
  assert.ok(!hasPermission("editor", "inbox:view_team"), "o preset puro não muda");
  const normalized = normalizeAccessChange({ role: "editor", grants: ["inbox:reply", "inbox:view_team", "inbox:view_team"], revokes: ["inbox:view_all", "deal:win"] });
  assert.deepEqual(normalized.grants, ["inbox:view_team"], "conceder o que o perfil já dá é redundante");
  assert.deepEqual(normalized.revokes, ["deal:win"], "remover o que o perfil não dá é redundante");
  assert.throws(() => normalizeAccessChange({ role: "editor", grants: ["nao:existe"], revokes: [] }), /ACCESS_PERMISSION_UNKNOWN/);
});

test("proteções: sem autoalteração, sem autoelevação, só Administrador cria Administrador, principal intocável, sempre um Administrador", () => {
  const owner = { userId: "o", role: "owner", permissions: ROLE_PERMISSIONS.owner, isAccountOwner: false };
  const target = (patch = {}) => ({ userId: "t", role: "editor", status: "active", isAccountOwner: false, permissionGrants: [], permissionRevokes: [], ...patch });
  const change = (role, grants = [], revokes = []) => ({ role, grants, revokes });

  assert.throws(() => assertAccessChangeAllowed({ actor: owner, target: target({ userId: "o", role: "owner" }), next: change("owner", [], ["team:manage"]), activeOwnerCount: 2 }), /ACCESS_SELF_CHANGE_FORBIDDEN/);
  const delegated = { userId: "g", role: "admin", permissions: [...ROLE_PERMISSIONS.admin, "tenant_member:manage_permissions"], isAccountOwner: false };
  assert.throws(() => assertAccessChangeAllowed({ actor: delegated, target: target(), next: change("owner"), activeOwnerCount: 1 }), /só um Administrador/);
  assert.throws(() => assertAccessChangeAllowed({ actor: delegated, target: target(), next: change("editor", ["inbox:view_all"]), activeOwnerCount: 1 }), /ACCESS_ESCALATION_FORBIDDEN/);
  assertAccessChangeAllowed({ actor: delegated, target: target(), next: change("editor", ["inbox:view_team"]), activeOwnerCount: 1 });
  const gerente = { userId: "g2", role: "admin", permissions: ROLE_PERMISSIONS.admin, isAccountOwner: false };
  assert.throws(() => assertAccessChangeAllowed({ actor: gerente, target: target(), next: change("editor", ["inbox:view_team"]), activeOwnerCount: 1 }), /ACCESS_FORBIDDEN/, "gerente comum não gerencia permissões");
  assert.throws(() => assertAccessChangeAllowed({ actor: owner, target: target({ role: "owner", isAccountOwner: true }), next: change("admin"), activeOwnerCount: 2 }), /ACCESS_ACCOUNT_OWNER_PROTECTED/);
  assert.throws(() => assertAccessChangeAllowed({ actor: owner, target: target({ role: "owner", isAccountOwner: true }), next: change("owner", [], ["tenant_member:manage"]), activeOwnerCount: 2 }), /ACCESS_ACCOUNT_OWNER_PROTECTED/);
  assert.throws(() => assertAccessChangeAllowed({ actor: owner, target: target({ role: "owner" }), next: change("admin"), activeOwnerCount: 1 }), /ACCESS_LAST_OWNER/);
  assertAccessChangeAllowed({ actor: owner, target: target({ role: "owner" }), next: change("admin"), activeOwnerCount: 2 });
});

test("alterar acesso: aplica perfil + exceções, audita cada diferença e vale na próxima requisição (resolvedor)", async () => {
  const tenantId = "tenant-acc-1";
  const { deps, person, contextOf } = await company(tenantId);
  const ownerId = await person("owner", { accountOwner: true });
  const carlosId = await person("editor");
  const resolver = new AccessResolver(deps.membershipRepository);
  const accessDeps = { ...deps, onAccessChanged: (userId, tenant) => resolver.invalidate(userId, tenant) };
  const principal = { userId: carlosId, tenantId, role: "editor", sessionId: "s", isPlatformAdmin: false };
  assert.equal(scopeFor({ permissions: (await resolver.resolve(principal)).permissions }, "inbox"), "own");

  const view = await updateMemberAccess(accessDeps, await contextOf(ownerId), { userId: carlosId, role: "editor", permissionGrants: ["inbox:view_team"], permissionRevokes: ["deal:win"] });
  assert.deepEqual(view.permissionGrants, ["inbox:view_team"]);
  assert.equal(view.permissions.find((item) => item.permission === "inbox:view_team").origin, "granted");
  assert.equal(view.permissions.find((item) => item.permission === "deal:win").origin, "revoked");
  assert.equal(view.permissions.find((item) => item.permission === "inbox:reply").origin, "profile");
  const resolved = await resolver.resolve(principal);
  assert.equal(scopeFor({ permissions: resolved.permissions }, "inbox"), "team", "exceção vale sem novo login");

  const promoted = await updateMemberAccess(accessDeps, await contextOf(ownerId), { userId: carlosId, role: "admin" });
  assert.equal(promoted.role, "admin");
  assert.deepEqual(promoted.permissionGrants, [], "trocar de perfil recarrega o padrão do novo perfil");
  const audit = await deps.accessAuditLog.list({ tenantId, targetUserId: carlosId });
  const types = audit.map((entry) => entry.eventType);
  assert.ok(types.includes("role_changed") && types.includes("permission_granted") && types.includes("permission_revoked"));
  const roleChange = audit.find((entry) => entry.eventType === "role_changed");
  assert.deepEqual(roleChange.previousValue, { role: "editor" });
  assert.deepEqual(roleChange.newValue, { role: "admin" });
  assert.equal(roleChange.actorUserId, ownerId);

  await assert.rejects(updateMemberAccess(accessDeps, await contextOf(carlosId), { userId: carlosId, role: "owner" }), /ACCESS_FORBIDDEN|ACCESS_SELF_CHANGE_FORBIDDEN/);
});

test("desativar: perde acesso na hora; principal e último Administrador protegidos; remover idem", async () => {
  const tenantId = "tenant-acc-2";
  const { deps, person, contextOf } = await company(tenantId);
  const ownerId = await person("owner", { accountOwner: true });
  const anaId = await person("editor");
  const resolver = new AccessResolver(deps.membershipRepository);
  const accessDeps = { ...deps, onAccessChanged: (userId, tenant) => resolver.invalidate(userId, tenant) };
  const anaPrincipal = { userId: anaId, tenantId, role: "editor", sessionId: "s", isPlatformAdmin: false };
  assert.ok(await resolver.resolve(anaPrincipal));
  await setMemberStatus(accessDeps, await contextOf(ownerId), { userId: anaId, status: "disabled" });
  assert.equal(await resolver.resolve(anaPrincipal), undefined, "desativado não autentica mais");
  await setMemberStatus(accessDeps, await contextOf(ownerId), { userId: anaId, status: "active" });
  assert.ok(await resolver.resolve(anaPrincipal));

  const secondOwner = await person("owner");
  await assert.rejects(setMemberStatus(accessDeps, await contextOf(secondOwner), { userId: ownerId, status: "disabled" }), /ACCESS_ACCOUNT_OWNER_PROTECTED/);
  await assert.rejects(setMemberStatus(accessDeps, await contextOf(ownerId), { userId: ownerId, status: "disabled" }), /ACCESS_SELF_CHANGE_FORBIDDEN/);
  await assert.rejects(removeMemberSafely(accessDeps, await contextOf(secondOwner), { userId: ownerId }), /ACCESS_ACCOUNT_OWNER_PROTECTED/);
  const types = (await deps.accessAuditLog.list({ tenantId, targetUserId: anaId })).map((entry) => entry.eventType);
  assert.ok(types.includes("member_disabled") && types.includes("member_enabled"));
});

test("equipes: escopo por participação, configuração só nas equipes gerenciadas, sem mexer nas próprias", async () => {
  const tenantId = "tenant-acc-3";
  const { deps, workspace, person, contextOf } = await company(tenantId);
  const mariaId = await person("admin");
  const carlosId = await person("editor");
  const anaId = await person("editor");
  const comercial = await deps.teamRepository.create({ tenantId, workspaceId: workspace.id, name: "Comercial" });
  const sdr = await deps.teamRepository.create({ tenantId, workspaceId: workspace.id, name: "SDR" });
  const suporte = await deps.teamRepository.create({ tenantId, workspaceId: workspace.id, name: "Suporte" });
  await deps.teamMembershipRepository.add({ teamId: comercial.id, userId: mariaId, role: "admin", attendanceLevel: "N1" });
  await deps.teamMembershipRepository.add({ teamId: sdr.id, userId: mariaId, role: "admin", attendanceLevel: "N1" });
  await deps.teamMembershipRepository.add({ teamId: comercial.id, userId: carlosId, role: "editor", attendanceLevel: "N1" });
  await deps.teamMembershipRepository.add({ teamId: sdr.id, userId: anaId, role: "editor", attendanceLevel: "N1" });

  const maria = await contextOf(mariaId);
  assert.deepEqual([...maria.managedTeamIds].sort(), [comercial.id, sdr.id].sort());
  assert.ok(canConfigureTeam(maria, "inbox:configure_kanban", "inbox", comercial.id));
  assert.ok(!canConfigureTeam(maria, "inbox:configure_kanban", "inbox", suporte.id), "não configura equipe que não gerencia");
  assert.ok(!canConfigureTeam(maria, "pipeline:configure", "deal", undefined), "funil da empresa toda exige escopo global");
  assert.throws(() => assertTeamMembershipChangeAllowed(maria, { userId: carlosId, changesManager: false }), /ACCESS_FORBIDDEN/, "gerente não altera equipes");

  // Conversas: Carlos (atendente) não vê as de Ana; Maria (gerente) vê das duas equipes; fila visível.
  const carlos = await contextOf(carlosId);
  const ownVisibility = { userIds: [carlosId], teamIds: [], queueTeamIds: carlos.memberTeamIds };
  assert.ok(isConversationVisible({ assignedUserId: carlosId }, ownVisibility));
  assert.ok(!isConversationVisible({ assignedUserId: anaId, currentTeamId: sdr.id }, ownVisibility));
  assert.ok(isConversationVisible({ currentTeamId: comercial.id }, ownVisibility), "fila da própria equipe");
  assert.ok(!isConversationVisible({ currentTeamId: suporte.id }, ownVisibility), "fila de outra equipe não");
  const teamVisibility = { userIds: [mariaId, carlosId, anaId], teamIds: maria.memberTeamIds, queueTeamIds: maria.memberTeamIds };
  assert.ok(isConversationVisible({ assignedUserId: anaId, currentTeamId: sdr.id }, teamVisibility));
  assert.ok(!isConversationVisible({ assignedUserId: "outro", currentTeamId: suporte.id }, teamVisibility));

  // Oportunidades: dealVisibility "own" no workspace — atendente só as próprias; gerente as das equipes.
  const salesConfigRepository = { getSettings: async () => ({ tenantId, workspaceId: workspace.id, dealVisibility: "own" }) };
  const carlosScope = await resolveDealScope({ salesConfigRepository, teamMembershipRepository: deps.teamMembershipRepository }, { tenantId, userId: carlosId, role: "editor", permissions: carlos.permissions }, workspace.id);
  assert.deepEqual(carlosScope, { ownerUserIdsIn: [carlosId] });
  const mariaScope = await resolveDealScope({ salesConfigRepository, teamMembershipRepository: deps.teamMembershipRepository }, { tenantId, userId: mariaId, role: "admin", permissions: maria.permissions }, workspace.id);
  assert.deepEqual([...mariaScope.ownerUserIdsIn].sort(), [mariaId, carlosId, anaId].sort());

  // Dashboard: Maria vê Comercial, SDR e consolidado; não vê Suporte nem a empresa; Carlos só a si.
  const mariaActor = { tenantId, userId: mariaId, role: "admin", permissions: maria.permissions };
  assert.deepEqual(await resolveReportSubject(deps, mariaActor, { teamId: comercial.id }), { teamId: comercial.id });
  assert.deepEqual([...(await resolveReportSubject(deps, mariaActor, { teamId: "mine" })).teamIds].sort(), [comercial.id, sdr.id].sort());
  await assert.rejects(resolveReportSubject(deps, mariaActor, { teamId: suporte.id }), /SALES_REPORT_FORBIDDEN/);
  const carlosActor = { tenantId, userId: carlosId, role: "editor", permissions: carlos.permissions };
  assert.deepEqual(await resolveReportSubject(deps, carlosActor, {}), { userId: carlosId });
  await assert.rejects(resolveReportSubject(deps, carlosActor, { userId: anaId }), /SALES_REPORT_FORBIDDEN/);
});

test("migração 0173: Gestor antigo mantém o acesso como exceções e o owner mais antigo vira principal", async () => {
  const tenantId = "tenant-acc-legacy";
  const { deps, person } = await company(tenantId);
  const firstOwner = await person("owner");
  await person("owner");
  const legacyAdmin = await person("admin");
  const sql = await readFile(join(MIGRATIONS_DIR, "0173_access_profiles_and_scope.sql"), "utf8");
  const statements = sql.replace(/^--.*$/gm, "").match(/update tenant_members[\s\S]*?;/g);
  assert.equal(statements.length, 2);
  await db.pool.query("update tenant_members set permission_grants = '{}' where tenant_id = $1", [tenantId]);
  for (const statement of statements) await db.pool.query(statement.replace("where role = 'admin'", `where role = 'admin' and tenant_id = '${tenantId}'`));
  const owner = await deps.membershipRepository.getByUserAndTenant(firstOwner, tenantId);
  assert.equal(owner.isAccountOwner, true);
  const admin = await deps.membershipRepository.getByUserAndTenant(legacyAdmin, tenantId);
  const permissions = effectivePermissions(admin.role, admin.permissionGrants, admin.permissionRevokes);
  for (const permission of ["tenant_member:manage", "team:manage", "inbox:view_all", "deal:view_all", "inbox:manage_connections"]) assert.ok(permissions.includes(permission), `gestor legado mantém ${permission}`);
});
