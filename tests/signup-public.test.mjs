import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresSessionRepository } from "../dist/infrastructure/storage/postgres/postgres-session-repository.js";
import { PostgresRefreshTokenRepository } from "../dist/infrastructure/storage/postgres/postgres-refresh-token-repository.js";
import { PostgresAuditLogRepository } from "../dist/infrastructure/storage/postgres/postgres-audit-log-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { JsonWebTokenJwtAdapter } from "../dist/infrastructure/auth/jsonwebtoken-jwt-adapter.js";
import { signupPublic } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

function makeDeps() {
  return {
    userRepository: new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") }),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") }),
    sessionRepository: new PostgresSessionRepository(db.pool, { idGenerator: () => nextId("session") }),
    refreshTokenRepository: new PostgresRefreshTokenRepository(db.pool, { idGenerator: () => nextId("token") }),
    auditLog: new PostgresAuditLogRepository(db.pool, { idGenerator: () => nextId("audit") }),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    passwordHasher: new BcryptPasswordHasher(),
    jwt: new JsonWebTokenJwtAdapter("test-secret"),
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
    idGenerator: (prefix) => nextId(prefix),
    now: () => new Date("2026-08-01T10:00:00Z"),
  };
}

before(async () => {
  db = await startTestPostgres({ port: 55441 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

test("signupPublic: cria User + Membership + Workspace + tenant_billing FREE e devolve tokens", async () => {
  const deps = makeDeps();

  const result = await signupPublic(deps, {
    email: "novo@example.com",
    password: "senha-forte-1234",
    name: "Novo Usuário",
    workspaceName: "Meu Primeiro Workspace",
  });

  assert.ok(result.accessToken, "access token retornado");
  assert.ok(result.refreshToken, "refresh token retornado");
  assert.equal(result.user.email, "novo@example.com");
  assert.equal(result.user.isPlatformAdmin, false);
  assert.equal(result.role, "admin");
  assert.ok(result.tenantId.startsWith("tenant-"));

  const userRow = await db.pool.query("select id, email, is_platform_admin from users where email = 'novo@example.com'");
  assert.equal(userRow.rows.length, 1);
  assert.equal(userRow.rows[0].is_platform_admin, false);

  const membership = await db.pool.query("select tenant_id, role from tenant_members where user_id = $1", [userRow.rows[0].id]);
  assert.equal(membership.rows.length, 1);
  assert.equal(membership.rows[0].role, "admin");
  assert.equal(membership.rows[0].tenant_id, result.tenantId);

  const workspaces = await db.pool.query("select name, kind, tenant_id from workspaces where tenant_id = $1", [result.tenantId]);
  assert.equal(workspaces.rows.length, 1);
  assert.equal(workspaces.rows[0].name, "Meu Primeiro Workspace");
  assert.equal(workspaces.rows[0].kind, "default");

  const billing = await db.pool.query("select plan_code, subscription_status, monthly_credits_quota from tenant_billing where tenant_id = $1", [result.tenantId]);
  assert.equal(billing.rows.length, 1);
  assert.equal(billing.rows[0].plan_code, "FREE");
  assert.equal(billing.rows[0].subscription_status, "trial");
  assert.equal(Number(billing.rows[0].monthly_credits_quota), 50);
});

test("signupPublic: workspaceName ausente cai no default 'Workspace de <name>'", async () => {
  const deps = makeDeps();
  const result = await signupPublic(deps, { email: "sem-ws@example.com", password: "senha-forte-1234", name: "Bianca" });
  const ws = await db.pool.query("select name from workspaces where tenant_id = $1", [result.tenantId]);
  assert.equal(ws.rows[0].name, "Workspace de Bianca");
});

test("signupPublic: email duplicado lança SIGNUP_EMAIL_ALREADY_REGISTERED e não cria nada", async () => {
  const deps = makeDeps();
  await signupPublic(deps, { email: "dup@example.com", password: "senha-forte-1234", name: "Primeiro" });

  const before = await db.pool.query("select count(*)::int as c from users where email = 'dup@example.com'");
  assert.equal(before.rows[0].c, 1);

  await assert.rejects(
    () => signupPublic(deps, { email: "dup@example.com", password: "outra-senha-1234", name: "Segundo" }),
    /SIGNUP_EMAIL_ALREADY_REGISTERED/,
  );

  const after = await db.pool.query("select count(*)::int as c from users where email = 'dup@example.com'");
  assert.equal(after.rows[0].c, 1);
});

test("signupPublic: senha curta lança IDENTITY_VALIDATION_ERROR", async () => {
  const deps = makeDeps();
  await assert.rejects(
    () => signupPublic(deps, { email: "short@example.com", password: "1234567", name: "Curta" }),
    /IDENTITY_VALIDATION_ERROR/,
  );
});

test("signupPublic: cada cadastro gera tenantId distinto", async () => {
  const deps = makeDeps();
  const a = await signupPublic(deps, { email: "a1@example.com", password: "senha-forte-1234", name: "A" });
  const b = await signupPublic(deps, { email: "b1@example.com", password: "senha-forte-1234", name: "B" });
  assert.notEqual(a.tenantId, b.tenantId);
});
