import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55450 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-auth-api",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
  });
  return buildApp({ config });
}

async function seedUser({ email, password, tenantId, role = "owner" }) {
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  return registerUser(
    { userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() },
    { email, password, name: "Usuária API", tenantId, role },
  );
}

function extractCookie(response, name) {
  return response.cookies.find((cookie) => cookie.name === name)?.value;
}

function cookieHeader(...pairs) {
  return pairs.map(([name, value]) => `${name}=${value}`).join("; ");
}

// ---------------------------------------------------------------------------------------------
// POST /v1/auth/login
// ---------------------------------------------------------------------------------------------

test("POST /v1/auth/login: fluxo válido devolve accessToken e cookies HttpOnly", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "login-api@example.com", password: "senha-forte-123", tenantId: "tenant-api-1" });

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "login-api@example.com", password: "senha-forte-123" },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.data.accessToken);
  assert.equal(body.data.tenantId, "tenant-api-1");
  assert.equal(body.data.role, "owner");

  const refreshCookie = response.cookies.find((c) => c.name === "zuno_refresh_token");
  assert.ok(refreshCookie);
  assert.equal(refreshCookie.httpOnly, true);
  const csrfCookie = response.cookies.find((c) => c.name === "zuno_csrf_token");
  assert.ok(csrfCookie);
  assert.notEqual(csrfCookie.httpOnly, true);

  await app.close();
});

test("POST /v1/auth/login: senha errada responde 401 INVALID_CREDENTIALS", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "senha-errada@example.com", password: "senha-forte-123", tenantId: "tenant-api-2" });

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "senha-errada@example.com", password: "senha-incorreta" },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "INVALID_CREDENTIALS");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Access token protegendo rotas de negócio
// ---------------------------------------------------------------------------------------------

test("GET /v1/workspaces: com access token válido responde 200; sem token responde 401", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "protegido@example.com", password: "senha-forte-123", tenantId: "tenant-api-3" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "protegido@example.com", password: "senha-forte-123" } });
  const { accessToken } = login.json().data;

  const withToken = await app.inject({ method: "GET", url: "/v1/workspaces", headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(withToken.statusCode, 200);

  const withoutToken = await app.inject({ method: "GET", url: "/v1/workspaces" });
  assert.equal(withoutToken.statusCode, 401);
  assert.equal(withoutToken.json().error.code, "UNAUTHORIZED");
  await app.close();
});

test("RBAC via JWT real: viewer não consegue criar workspace (403)", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "viewer-api@example.com", password: "senha-forte-123", tenantId: "tenant-api-4", role: "viewer" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "viewer-api@example.com", password: "senha-forte-123" } });
  const { accessToken } = login.json().data;

  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { name: "Não deveria existir" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "FORBIDDEN");
  await app.close();
});

test("Isolamento cross-tenant via JWT real: usuário do tenant B não acessa workspace do tenant A", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "dono-a@example.com", password: "senha-forte-123", tenantId: "tenant-api-cross-a" });
  await seedUser({ email: "dono-b@example.com", password: "senha-forte-123", tenantId: "tenant-api-cross-b" });

  const loginA = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "dono-a@example.com", password: "senha-forte-123" } });
  const loginB = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "dono-b@example.com", password: "senha-forte-123" } });

  const created = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: { authorization: `Bearer ${loginA.json().data.accessToken}` },
    payload: { name: "Segredo do tenant A" },
  });
  const workspaceId = created.json().data.id;

  const crossTenantGet = await app.inject({
    method: "GET",
    url: `/v1/workspaces/${workspaceId}`,
    headers: { authorization: `Bearer ${loginB.json().data.accessToken}` },
  });
  assert.equal(crossTenantGet.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// POST /v1/auth/refresh — CSRF + rotação via cookie
// ---------------------------------------------------------------------------------------------

test("POST /v1/auth/refresh: sem header X-CSRF-Token responde 403 (mesmo com cookie válido)", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "csrf-1@example.com", password: "senha-forte-123", tenantId: "tenant-api-5" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "csrf-1@example.com", password: "senha-forte-123" } });
  const refreshToken = extractCookie(login, "zuno_refresh_token");
  const csrfToken = extractCookie(login, "zuno_csrf_token");

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/refresh",
    headers: { cookie: cookieHeader(["zuno_refresh_token", refreshToken], ["zuno_csrf_token", csrfToken]) },
    // Propositalmente SEM o header X-CSRF-Token.
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "FORBIDDEN");
  await app.close();
});

test("POST /v1/auth/refresh: com CSRF correto rotaciona o refresh token e devolve accessToken novo", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "csrf-2@example.com", password: "senha-forte-123", tenantId: "tenant-api-6" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "csrf-2@example.com", password: "senha-forte-123" } });
  const refreshToken = extractCookie(login, "zuno_refresh_token");
  const csrfToken = extractCookie(login, "zuno_csrf_token");

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/refresh",
    headers: {
      cookie: cookieHeader(["zuno_refresh_token", refreshToken], ["zuno_csrf_token", csrfToken]),
      "x-csrf-token": csrfToken,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().data.accessToken);
  const newRefreshToken = extractCookie(response, "zuno_refresh_token");
  assert.notEqual(newRefreshToken, refreshToken);

  // O token antigo, reapresentado depois de rotacionado, agora falha.
  const replay = await app.inject({
    method: "POST",
    url: "/v1/auth/refresh",
    headers: {
      cookie: cookieHeader(["zuno_refresh_token", refreshToken], ["zuno_csrf_token", csrfToken]),
      "x-csrf-token": csrfToken,
    },
  });
  assert.equal(replay.statusCode, 401);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// POST /v1/auth/logout
// ---------------------------------------------------------------------------------------------

test("POST /v1/auth/logout: revoga a sessão e limpa os cookies", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "logout-api@example.com", password: "senha-forte-123", tenantId: "tenant-api-7" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "logout-api@example.com", password: "senha-forte-123" } });
  const refreshToken = extractCookie(login, "zuno_refresh_token");
  const csrfToken = extractCookie(login, "zuno_csrf_token");
  const { accessToken } = login.json().data;

  const logout = await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: {
      authorization: `Bearer ${accessToken}`,
      cookie: cookieHeader(["zuno_refresh_token", refreshToken], ["zuno_csrf_token", csrfToken]),
      "x-csrf-token": csrfToken,
    },
  });
  assert.equal(logout.statusCode, 200);
  const clearedRefresh = logout.cookies.find((c) => c.name === "zuno_refresh_token");
  assert.equal(clearedRefresh.value, "");

  const refreshAfterLogout = await app.inject({
    method: "POST",
    url: "/v1/auth/refresh",
    headers: {
      cookie: cookieHeader(["zuno_refresh_token", refreshToken], ["zuno_csrf_token", csrfToken]),
      "x-csrf-token": csrfToken,
    },
  });
  assert.equal(refreshAfterLogout.statusCode, 401);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// POST /v1/auth/switch-tenant
// ---------------------------------------------------------------------------------------------

test("POST /v1/auth/switch-tenant: usuário com múltiplos tenants troca de contexto", async () => {
  const app = await buildTestApp();
  const { user } = await seedUser({ email: "multi-tenant@example.com", password: "senha-forte-123", tenantId: "tenant-api-8a", role: "owner" });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  await membershipRepository.create({ userId: user.id, tenantId: "tenant-api-8b", role: "editor" });

  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "multi-tenant@example.com", password: "senha-forte-123" } });
  const { accessToken } = login.json().data;

  const switchResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/switch-tenant",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { tenantId: "tenant-api-8b" },
  });
  assert.equal(switchResponse.statusCode, 200);
  assert.equal(switchResponse.json().data.tenantId, "tenant-api-8b");
  assert.equal(switchResponse.json().data.role, "editor");

  const newAccessToken = switchResponse.json().data.accessToken;
  const listInNewTenant = await app.inject({ method: "GET", url: "/v1/workspaces", headers: { authorization: `Bearer ${newAccessToken}` } });
  assert.equal(listInNewTenant.statusCode, 200);
  await app.close();
});

test("POST /v1/auth/switch-tenant: tenant sem acesso responde 403", async () => {
  const app = await buildTestApp();
  await seedUser({ email: "sem-acesso@example.com", password: "senha-forte-123", tenantId: "tenant-api-9" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "sem-acesso@example.com", password: "senha-forte-123" } });

  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/switch-tenant",
    headers: { authorization: `Bearer ${login.json().data.accessToken}` },
    payload: { tenantId: "tenant-que-nao-pertence" },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});
