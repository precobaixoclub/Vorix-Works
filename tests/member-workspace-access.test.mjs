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
import { setMemberWorkspaceAccess } from "../dist/application/platform-admin/platform-admin.usecases.js";
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

test("admin restricts a person to chosen workspaces; the guard hides the others and the owner keeps everything", async () => {
  const [store, office] = [await deps.workspaceRepository.create({ tenantId, name: "Loja" }), await deps.workspaceRepository.create({ tenantId, name: "Escritório" })];
  const foreign = await deps.workspaceRepository.create({ tenantId: "another-tenant", name: "Outra conta" });
  const owner = await member("owner", true); const seller = await member("editor");
  const changed = [];
  const adminDeps = { ...deps, onAccessChanged: (userId) => changed.push(userId) };

  await assert.rejects(setMemberWorkspaceAccess(adminDeps, { tenantId, userId: seller, workspaceIds: [], actor: { userId: "root" } }), /INVALID_WORKSPACE_ACCESS/);
  await assert.rejects(setMemberWorkspaceAccess(adminDeps, { tenantId, userId: seller, workspaceIds: [foreign.id], actor: { userId: "root" } }), /INVALID_WORKSPACE_ACCESS/);
  await assert.rejects(setMemberWorkspaceAccess(adminDeps, { tenantId, userId: owner, workspaceIds: [store.id], actor: { userId: "root" } }), /INVALID_WORKSPACE_ACCESS/);
  await assert.rejects(setMemberWorkspaceAccess(adminDeps, { tenantId, userId: "nobody", workspaceIds: null, actor: { userId: "root" } }), /MEMBER_NOT_FOUND/);

  await setMemberWorkspaceAccess(adminDeps, { tenantId, userId: seller, workspaceIds: [store.id, store.id], reason: "Só a loja", actor: { userId: "root" } });
  assert.deepEqual((await deps.membershipRepository.getByUserAndTenant(seller, tenantId)).workspaceIds, [store.id]);
  assert.deepEqual(changed, [seller]);
  const audit = await deps.accessAuditLog.list({ tenantId, targetUserId: seller });
  assert.equal(audit[0].eventType, "workspace_access_changed"); assert.deepEqual(audit[0].newValue, { workspaceIds: [store.id], reason: "Só a loja" });

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

  await setMemberWorkspaceAccess(adminDeps, { tenantId, userId: seller, workspaceIds: null, actor: { userId: "root" } });
  assert.equal((await deps.membershipRepository.getByUserAndTenant(seller, tenantId)).workspaceIds, null);
});
