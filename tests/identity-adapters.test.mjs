import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresSessionRepository } from "../dist/infrastructure/storage/postgres/postgres-session-repository.js";
import { PostgresRefreshTokenRepository } from "../dist/infrastructure/storage/postgres/postgres-refresh-token-repository.js";
import { PostgresAuditLogRepository } from "../dist/infrastructure/storage/postgres/postgres-audit-log-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55430 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

// ---------------------------------------------------------------------------------------------
// PostgresUserRepository
// ---------------------------------------------------------------------------------------------

test("Postgres User: create() + getByEmail()/getById() round trip", async () => {
  const repo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const created = await repo.create({ email: "Ana@Example.com", passwordHash: "hash-1", name: "Ana" });
  assert.equal(created.status, "active");

  const byEmailLowercase = await repo.getByEmail("ana@example.com");
  assert.equal(byEmailLowercase.id, created.id);

  const byId = await repo.getById(created.id);
  assert.equal(byId.email, "Ana@Example.com");
});

test("Postgres User: email duplicado (case-insensitive) lança USER_EMAIL_ALREADY_EXISTS", async () => {
  const repo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  await repo.create({ email: "duplicado@example.com", passwordHash: "hash", name: "X" });
  await assert.rejects(
    () => repo.create({ email: "Duplicado@Example.com", passwordHash: "hash", name: "Y" }),
    /USER_EMAIL_ALREADY_EXISTS/,
  );
});

test("Postgres User: touchLastLogin() preenche last_login_at", async () => {
  const repo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const created = await repo.create({ email: "login@example.com", passwordHash: "hash", name: "X" });
  assert.equal(created.lastLoginAt, undefined);
  await repo.touchLastLogin(created.id);
  const updated = await repo.getById(created.id);
  assert.ok(updated.lastLoginAt);
});

// ---------------------------------------------------------------------------------------------
// PostgresTenantMembershipRepository
// ---------------------------------------------------------------------------------------------

test("Postgres Membership: create()/getByUserAndTenant()/listByUser()", async () => {
  const userRepo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepo = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  const user = await userRepo.create({ email: "membro@example.com", passwordHash: "hash", name: "X" });

  const membership = await membershipRepo.create({ userId: user.id, tenantId: "tenant-a", role: "editor" });
  assert.equal(membership.role, "editor");

  const found = await membershipRepo.getByUserAndTenant(user.id, "tenant-a");
  assert.equal(found.id, membership.id);

  await membershipRepo.create({ userId: user.id, tenantId: "tenant-b", role: "viewer" });
  const all = await membershipRepo.listByUser(user.id);
  assert.equal(all.length, 2);
});

test("Postgres Membership: mesmo usuário duas vezes no mesmo tenant lança MEMBERSHIP_ALREADY_EXISTS", async () => {
  const userRepo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepo = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  const user = await userRepo.create({ email: "duplicado-membro@example.com", passwordHash: "hash", name: "X" });
  await membershipRepo.create({ userId: user.id, tenantId: "tenant-dup", role: "owner" });
  await assert.rejects(() => membershipRepo.create({ userId: user.id, tenantId: "tenant-dup", role: "viewer" }), /MEMBERSHIP_ALREADY_EXISTS/);
});

// ---------------------------------------------------------------------------------------------
// PostgresSessionRepository
// ---------------------------------------------------------------------------------------------

test("Postgres Session: create()/touch()/revoke()/updateActiveTenant()", async () => {
  const userRepo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const sessionRepo = new PostgresSessionRepository(db.pool, { idGenerator: () => nextId("session") });
  const user = await userRepo.create({ email: "sessao@example.com", passwordHash: "hash", name: "X" });

  const session = await sessionRepo.create({ userId: user.id, activeTenantId: "tenant-a", userAgent: "vitest", ipAddress: "127.0.0.1" });
  assert.equal(session.revokedAt, undefined);

  await sessionRepo.updateActiveTenant(session.id, "tenant-b");
  const afterSwitch = await sessionRepo.getById(session.id);
  assert.equal(afterSwitch.activeTenantId, "tenant-b");

  await sessionRepo.touch(session.id);
  const touched = await sessionRepo.getById(session.id);
  assert.ok(new Date(touched.lastUsedAt).getTime() >= new Date(session.lastUsedAt).getTime());

  await sessionRepo.revoke(session.id);
  const revoked = await sessionRepo.getById(session.id);
  assert.ok(revoked.revokedAt);
});

// ---------------------------------------------------------------------------------------------
// PostgresRefreshTokenRepository
// ---------------------------------------------------------------------------------------------

test("Postgres RefreshToken: create()/getByHash()/markRotated()/revoke()/revokeAllForSession()", async () => {
  const userRepo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const sessionRepo = new PostgresSessionRepository(db.pool, { idGenerator: () => nextId("session") });
  const tokenRepo = new PostgresRefreshTokenRepository(db.pool, { idGenerator: () => nextId("token") });
  const user = await userRepo.create({ email: "token@example.com", passwordHash: "hash", name: "X" });
  const session = await sessionRepo.create({ userId: user.id, activeTenantId: "tenant-a" });

  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const token1 = await tokenRepo.create({ sessionId: session.id, userId: user.id, tokenHash: "hash-1", expiresAt });
  assert.equal(token1.revokedAt, undefined);

  const found = await tokenRepo.getByHash("hash-1");
  assert.equal(found.id, token1.id);

  const token2 = await tokenRepo.create({ sessionId: session.id, userId: user.id, tokenHash: "hash-2", expiresAt });
  await tokenRepo.markRotated(token1.id, token2.id);
  const rotated = await tokenRepo.getByHash("hash-1");
  assert.ok(rotated.revokedAt);
  assert.equal(rotated.replacedByTokenId, token2.id);

  const token3 = await tokenRepo.create({ sessionId: session.id, userId: user.id, tokenHash: "hash-3", expiresAt });
  await tokenRepo.revokeAllForSession(session.id);
  const afterRevokeAll = await tokenRepo.getByHash("hash-3");
  assert.ok(afterRevokeAll.revokedAt);
  void token3;
});

test("Postgres RefreshToken: apagar a sessão faz cascata nos refresh tokens", async () => {
  const userRepo = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const sessionRepo = new PostgresSessionRepository(db.pool, { idGenerator: () => nextId("session") });
  const tokenRepo = new PostgresRefreshTokenRepository(db.pool, { idGenerator: () => nextId("token") });
  const user = await userRepo.create({ email: "cascata@example.com", passwordHash: "hash", name: "X" });
  const session = await sessionRepo.create({ userId: user.id, activeTenantId: "tenant-a" });
  await tokenRepo.create({ sessionId: session.id, userId: user.id, tokenHash: "hash-cascata", expiresAt: new Date(Date.now() + 60_000).toISOString() });

  await db.pool.query("delete from user_sessions where id = $1", [session.id]);
  const afterDelete = await tokenRepo.getByHash("hash-cascata");
  assert.equal(afterDelete, undefined);
});

// ---------------------------------------------------------------------------------------------
// PostgresAuditLogRepository
// ---------------------------------------------------------------------------------------------

test("Postgres AuditLog: record() grava o evento", async () => {
  const auditRepo = new PostgresAuditLogRepository(db.pool, { idGenerator: () => nextId("audit") });
  await auditRepo.record({ eventType: "login_success", userId: "user-x", tenantId: "tenant-a", sessionId: "session-x", metadata: { via: "test" } });

  const rows = await db.pool.query("select * from auth_audit_log where user_id = $1", ["user-x"]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].event_type, "login_success");
  assert.equal(rows.rows[0].metadata.via, "test");
});
