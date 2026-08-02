import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresSessionRepository } from "../dist/infrastructure/storage/postgres/postgres-session-repository.js";
import { PostgresRefreshTokenRepository } from "../dist/infrastructure/storage/postgres/postgres-refresh-token-repository.js";
import { PostgresAuditLogRepository } from "../dist/infrastructure/storage/postgres/postgres-audit-log-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { JsonWebTokenJwtAdapter } from "../dist/infrastructure/auth/jsonwebtoken-jwt-adapter.js";
import { login, logout, refresh, registerUser, switchTenant } from "../dist/application/identity/index.js";
import { assertPermission, hasPermission } from "../dist/domain/identity/identity.model.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

function makeDeps(overrides = {}) {
  return {
    userRepository: new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") }),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") }),
    sessionRepository: new PostgresSessionRepository(db.pool, { idGenerator: () => nextId("session") }),
    refreshTokenRepository: new PostgresRefreshTokenRepository(db.pool, { idGenerator: () => nextId("token") }),
    auditLog: new PostgresAuditLogRepository(db.pool, { idGenerator: () => nextId("audit") }),
    passwordHasher: new BcryptPasswordHasher(),
    jwt: new JsonWebTokenJwtAdapter("test-secret"),
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
    ...overrides,
  };
}

async function seedUser(deps, { email = `user-${++counter}@example.com`, password = "senha-forte-123", tenantId = "tenant-a", role = "owner" } = {}) {
  const { user, membership } = await registerUser(deps, { email, password, name: "Usuária de Teste", tenantId, role });
  return { user, membership, password };
}

before(async () => {
  db = await startTestPostgres({ port: 55440 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

// ---------------------------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------------------------

test("login: fluxo válido devolve access token decodificável e refresh token", async () => {
  const deps = makeDeps();
  const { user, password } = await seedUser(deps, { tenantId: "tenant-login-1" });

  const result = await login(deps, { email: user.email, password });
  assert.equal(result.tenantId, "tenant-login-1");
  assert.equal(result.role, "owner");
  assert.ok(result.refreshToken);

  const decoded = deps.jwt.verify(result.accessToken);
  assert.equal(decoded.valid, true);
  assert.equal(decoded.payload.userId, user.id);
  assert.equal(decoded.payload.tenantId, "tenant-login-1");
});

test("login: senha inválida lança IDENTITY_INVALID_CREDENTIALS e registra auditoria", async () => {
  const deps = makeDeps();
  const { user } = await seedUser(deps, { tenantId: "tenant-login-2" });

  await assert.rejects(() => login(deps, { email: user.email, password: "senha-errada" }), /IDENTITY_INVALID_CREDENTIALS/);

  const audit = await db.pool.query("select * from auth_audit_log where user_id = $1 and event_type = 'login_failed'", [user.id]);
  assert.equal(audit.rows.length, 1);
});

test("login: email inexistente lança a MESMA mensagem genérica (nunca revela se o email existe)", async () => {
  const deps = makeDeps();
  await assert.rejects(() => login(deps, { email: "ninguem@example.com", password: "qualquer" }), /IDENTITY_INVALID_CREDENTIALS/);
});

test("login: usuário sem nenhuma membership lança IDENTITY_NO_TENANT_ACCESS", async () => {
  const deps = makeDeps();
  const passwordHash = await deps.passwordHasher.hash("senha-forte-123");
  const user = await deps.userRepository.create({ email: "sem-tenant@example.com", passwordHash, name: "Sem Tenant" });

  await assert.rejects(() => login(deps, { email: user.email, password: "senha-forte-123" }), /IDENTITY_NO_TENANT_ACCESS/);
});

// ---------------------------------------------------------------------------------------------
// refresh — rotação, expiração, replay
// ---------------------------------------------------------------------------------------------

test("refresh: rotação — token antigo é revogado e substituído, token novo funciona", async () => {
  const deps = makeDeps();
  const { user, password } = await seedUser(deps, { tenantId: "tenant-refresh-1" });
  const loginResult = await login(deps, { email: user.email, password });

  const refreshed = await refresh(deps, { refreshToken: loginResult.refreshToken });
  assert.notEqual(refreshed.refreshToken, loginResult.refreshToken);
  assert.equal(refreshed.tenantId, "tenant-refresh-1");

  // O token novo funciona para um segundo refresh.
  const refreshedAgain = await refresh(deps, { refreshToken: refreshed.refreshToken });
  assert.notEqual(refreshedAgain.refreshToken, refreshed.refreshToken);
});

test("refresh: token expirado lança IDENTITY_REFRESH_TOKEN_EXPIRED", async () => {
  let fakeNow = new Date("2026-01-01T00:00:00.000Z");
  const deps = makeDeps({ now: () => fakeNow, refreshTokenTtlSeconds: 60 });
  const { user, password } = await seedUser(deps, { tenantId: "tenant-refresh-2" });
  const loginResult = await login(deps, { email: user.email, password });

  fakeNow = new Date(fakeNow.getTime() + 61_000);
  await assert.rejects(() => refresh(deps, { refreshToken: loginResult.refreshToken }), /IDENTITY_REFRESH_TOKEN_EXPIRED/);
});

test("refresh: reusar um token já rotacionado (replay) revoga a sessão inteira", async () => {
  const deps = makeDeps();
  const { user, password } = await seedUser(deps, { tenantId: "tenant-refresh-3" });
  const loginResult = await login(deps, { email: user.email, password });

  const firstRefresh = await refresh(deps, { refreshToken: loginResult.refreshToken });

  // Reusar o token ORIGINAL (já rotacionado/revogado) — replay.
  await assert.rejects(() => refresh(deps, { refreshToken: loginResult.refreshToken }), /IDENTITY_REFRESH_TOKEN_REUSED/);

  // A sessão inteira foi revogada como resposta — mesmo o token NOVO (válido até agora) para de funcionar.
  await assert.rejects(() => refresh(deps, { refreshToken: firstRefresh.refreshToken }), /IDENTITY_SESSION_REVOKED|IDENTITY_INVALID_REFRESH_TOKEN/);

  const audit = await db.pool.query("select * from auth_audit_log where user_id = $1 and event_type = 'refresh_replay_detected'", [user.id]);
  assert.equal(audit.rows.length, 1);
});

test("refresh: token inexistente/inválido lança IDENTITY_INVALID_REFRESH_TOKEN", async () => {
  const deps = makeDeps();
  await assert.rejects(() => refresh(deps, { refreshToken: "token-que-nunca-existiu" }), /IDENTITY_INVALID_REFRESH_TOKEN/);
});

// ---------------------------------------------------------------------------------------------
// logout — revogação
// ---------------------------------------------------------------------------------------------

test("logout: revoga a sessão — refresh subsequente falha", async () => {
  const deps = makeDeps();
  const { user, password } = await seedUser(deps, { tenantId: "tenant-logout-1" });
  const loginResult = await login(deps, { email: user.email, password });

  const decoded = deps.jwt.verify(loginResult.accessToken);
  await logout(deps, { sessionId: decoded.payload.sessionId });

  await assert.rejects(() => refresh(deps, { refreshToken: loginResult.refreshToken }), /IDENTITY_SESSION_REVOKED|IDENTITY_INVALID_REFRESH_TOKEN/);

  const session = await deps.sessionRepository.getById(decoded.payload.sessionId);
  assert.ok(session.revokedAt);
});

// ---------------------------------------------------------------------------------------------
// switch-tenant
// ---------------------------------------------------------------------------------------------

test("switchTenant: usuário com múltiplas memberships troca de contexto com sucesso", async () => {
  const deps = makeDeps();
  const { user, password, membership } = await seedUser(deps, { tenantId: "tenant-switch-1", role: "owner" });
  await deps.membershipRepository.create({ userId: user.id, tenantId: "tenant-switch-2", role: "viewer" });

  const loginResult = await login(deps, { email: user.email, password });
  const decoded = deps.jwt.verify(loginResult.accessToken);
  assert.equal(decoded.payload.tenantId, "tenant-switch-1");

  const switched = await switchTenant(deps, { userId: user.id, sessionId: decoded.payload.sessionId, targetTenantId: "tenant-switch-2" });
  assert.equal(switched.tenantId, "tenant-switch-2");
  assert.equal(switched.role, "viewer");

  const newDecoded = deps.jwt.verify(switched.accessToken);
  assert.equal(newDecoded.payload.tenantId, "tenant-switch-2");

  // O próximo refresh já reflete o tenant trocado (a sessão é a fonte de verdade).
  const refreshed = await refresh(deps, { refreshToken: loginResult.refreshToken });
  assert.equal(refreshed.tenantId, "tenant-switch-2");
  assert.equal(refreshed.role, "viewer");
  void membership;
});

test("switchTenant: tenant sem membership lança IDENTITY_NO_TENANT_ACCESS", async () => {
  const deps = makeDeps();
  const { user, password } = await seedUser(deps, { tenantId: "tenant-switch-3" });
  const loginResult = await login(deps, { email: user.email, password });
  const decoded = deps.jwt.verify(loginResult.accessToken);

  await assert.rejects(
    () => switchTenant(deps, { userId: user.id, sessionId: decoded.payload.sessionId, targetTenantId: "tenant-nao-pertence" }),
    /IDENTITY_NO_TENANT_ACCESS/,
  );
});

// ---------------------------------------------------------------------------------------------
// RBAC — domínio puro
// ---------------------------------------------------------------------------------------------

test("RBAC: gradiente de permissões por papel", () => {
  assert.equal(hasPermission("viewer", "workspace:read"), true);
  assert.equal(hasPermission("viewer", "workspace:update"), false);
  assert.equal(hasPermission("editor", "workspace:update"), true);
  assert.equal(hasPermission("editor", "workspace:create"), false);
  assert.equal(hasPermission("admin", "workspace:create"), true);
  assert.equal(hasPermission("owner", "workspace:transition"), true);
});

test("RBAC: assertPermission lança IDENTITY_FORBIDDEN quando o papel não tem a permissão", () => {
  assert.throws(() => assertPermission("viewer", "workspace:create"), /IDENTITY_FORBIDDEN/);
  assert.doesNotThrow(() => assertPermission("owner", "workspace:create"));
});

// ---------------------------------------------------------------------------------------------
// JwtPort — expiração
// ---------------------------------------------------------------------------------------------

test("JsonWebTokenJwtAdapter: token expirado é reconhecido distintamente de token inválido", () => {
  const jwt = new JsonWebTokenJwtAdapter("test-secret");
  const expiredToken = jwt.sign({ userId: "u1", tenantId: "t1", role: "owner", sessionId: "s1" }, -1);
  const expiredResult = jwt.verify(expiredToken);
  assert.deepEqual(expiredResult, { valid: false, reason: "expired" });

  const invalidResult = jwt.verify("nao-e-um-jwt-valido");
  assert.deepEqual(invalidResult, { valid: false, reason: "invalid" });

  const wrongSecretToken = new JsonWebTokenJwtAdapter("outro-secret").sign({ userId: "u1", tenantId: "t1", role: "owner", sessionId: "s1" }, 900);
  assert.deepEqual(jwt.verify(wrongSecretToken), { valid: false, reason: "invalid" });
});
