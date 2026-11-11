import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import Fastify from "fastify";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresAccessAuditLog } from "../dist/infrastructure/storage/postgres/postgres-access-audit-log.js";
import { AccessResolver } from "../dist/application/identity/access-resolver.js";
import { getMemberAccess, resolveAccessContext, updateMemberAccess } from "../dist/application/identity/access-control-use-cases.js";
import { registerWorkspaceTenantGuard } from "../dist/interfaces/api/http/workspace-tenant-guard.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

let db; let deps; let counter = 0;
const nextId = (prefix) => `${prefix}-mwa-${++counter}`;
const tenantId = "tenant-member-workspaces";

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, join(process.cwd(), "db/migrations"));
  deps = {
    userRepository: new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") }),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") }),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    accessAuditLog: new PostgresAccessAuditLog(db.pool),
  };
});
after(async () => db?.stop());

async function member(role, isAccountOwner = false) {
  const user = await deps.userRepository.create({ email: `${nextId("p")}@x.com`, passwordHash: "x", name: role });
  await deps.membershipRepository.create({ userId: user.id, tenantId, role, isAccountOwner });
  return user.id;
}

test("the account itself restricts a person to chosen workspaces; the guard hides the others and the owner keeps everything", async () => {
  const [store, office] = [await deps.workspaceRepository.create({ tenantId, name: "Loja" }), await deps.workspaceRepository.create({ tenantId, name: "Escritório" })];
  const foreign = await deps.workspaceRepository.create({ tenantId: "another-tenant", name: "Outra conta" });
  const owner = await member("owner", true); const manager = await member("admin"); const seller = await member("editor");
  const changed = [];
  const accessDeps = { ...deps, onAccessChanged: (userId) => changed.push(userId) };
  const ownerActor = await resolveAccessContext(deps, { tenantId, userId: owner, role: "owner", isAccountOwner: true });
  const save = (actor, userId, workspaceIds, role = "editor") => updateMemberAccess(accessDeps, actor, { userId, role, workspaceIds });

  await assert.rejects(save(ownerActor, seller, []), /ACCESS_WORKSPACE_INVALID/);
  await assert.rejects(save(ownerActor, seller, [foreign.id]), /ACCESS_WORKSPACE_INVALID/);
  await assert.rejects(save(ownerActor, owner, [store.id], "owner"), /ACCESS_SELF_CHANGE_FORBIDDEN/);
  // Invalid choice saves nothing (not even the profile).
  await assert.rejects(save(ownerActor, seller, [foreign.id], "admin"), /ACCESS_WORKSPACE_INVALID/);
  assert.equal((await deps.membershipRepository.getByUserAndTenant(seller, tenantId)).role, "editor");

  const view = await save(ownerActor, seller, [store.id, store.id]);
  assert.deepEqual(view.workspaceIds, [store.id]);
  assert.deepEqual(changed, [seller]);
  const audit = await deps.accessAuditLog.list({ tenantId, targetUserId: seller });
  assert.equal(audit[0].eventType, "workspace_access_changed"); assert.deepEqual(audit[0].newValue, { workspaceIds: [store.id] });
  // Unchanged choice is not a change (no new audit line).
  await save(ownerActor, seller, [store.id]);
  assert.equal((await deps.accessAuditLog.list({ tenantId, targetUserId: seller })).length, audit.length);

  // A manager limited to the store can only hand out the store — never "all", never the office.
  await save(ownerActor, manager, [store.id], "admin");
  const managerActor = await resolveAccessContext(deps, { tenantId, userId: manager, role: "admin", workspaceIds: [store.id] });
  const managerPermissions = { ...managerActor, permissions: [...managerActor.permissions, "tenant_member:manage_permissions"] };
  await assert.rejects(save(managerPermissions, seller, null), /ACCESS_ESCALATION_FORBIDDEN/);
  await assert.rejects(save(managerPermissions, seller, [office.id]), /ACCESS_ESCALATION_FORBIDDEN/);
  assert.equal((await getMemberAccess(deps, { tenantId, userId: owner })).workspaceIds, null);

  const resolver = new AccessResolver(deps.membershipRepository);
  const sellerPrincipal = await resolver.resolve({ userId: seller, tenantId, role: "editor", sessionId: "s", isPlatformAdmin: false });
  const ownerPrincipal = await resolver.resolve({ userId: owner, tenantId, role: "owner", sessionId: "s", isPlatformAdmin: false });
  assert.deepEqual(sellerPrincipal.workspaceIds, [store.id]); assert.equal(ownerPrincipal.workspaceIds, undefined);

  const app = Fastify(); registerErrorHandler(app);
  app.addHook("onRequest", async request => { request.zunoContext = { principal: request.headers["x-user"] === "owner" ? ownerPrincipal : sellerPrincipal }; });
  registerWorkspaceTenantGuard(app, deps.workspaceRepository);
  app.get("/contacts", async () => ({ ok: true }));
  app.get("/workspaces/:id", async () => ({ ok: true }));
  app.post("/workspaces/:id/activate", async () => ({ ok: true }));
  const status = async (url, user = "seller", method = "GET") => (await app.inject({ method, url, headers: { "x-user": user } })).statusCode;
  assert.equal(await status(`/contacts?workspaceId=${store.id}`), 200);
  assert.equal(await status(`/contacts?workspaceId=${office.id}`), 404);
  assert.equal(await status(`/workspaces/${office.id}`), 404);
  assert.equal(await status(`/workspaces/${store.id}`), 200);
  assert.equal(await status(`/contacts?workspaceId=${office.id}`, "owner"), 200);
  // `/workspaces/:id/*` only gets the per-person check (activation of inactive workspaces stays possible).
  assert.equal(await status(`/workspaces/${office.id}/activate`, "owner", "POST"), 200);
  await app.close();

  await save(ownerActor, seller, null);
  assert.equal((await deps.membershipRepository.getByUserAndTenant(seller, tenantId)).workspaceIds, null);
});
