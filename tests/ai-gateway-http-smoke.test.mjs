import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { buildApiContainer } from "../dist/interfaces/api/di/container.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresAiExecutionRepository } from "../dist/infrastructure/storage/postgres/postgres-ai-execution-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { AiGateway } from "../dist/application/ai-gateway/ai-gateway.js";
import { InMemoryAiCircuitBreaker } from "../dist/infrastructure/ai-gateway/in-memory-ai-circuit-breaker.js";
import { InMemoryAiRateLimiter } from "../dist/infrastructure/ai-gateway/in-memory-ai-rate-limiter.js";
import { InMemoryAiTelemetry } from "../dist/infrastructure/ai-gateway/in-memory-ai-telemetry.js";
import { FakeAiModelProvider, fakeSuccess } from "../dist/infrastructure/ai/fake-ai-model-provider.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * "Smoke test com FakeAiProvider" pedido na validação final da Sprint 08 — via `app.inject`
 * (sem porta de rede real, mas exercitando o app Fastify REAL de ponta a ponta: rota → caso de
 * uso → Conversation Engine → Briefing → AiGatewayPort → provider). `buildApp({ container })`
 * aceita um container pronto — construímos um via `buildApiContainer` normal (Postgres real via
 * PGlite) e só trocamos `aiGateway`/`aiExtractionEnabled` por uma instância com
 * `FakeAiModelProvider`, sem precisar reimplementar a raiz de composição inteira.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55550 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function buildTestAppWithFakeAi() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-ai-gateway-http-smoke",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "postgres",
    ZUNO_LOG_LEVEL: "silent",
  });
  const container = buildApiContainer(config);

  const provider = new FakeAiModelProvider({
    id: "anthropic",
    script: [
      fakeSuccess({
        schemaVersion: 1,
        candidates: [],
        ambiguities: [],
        unsupportedClaims: [],
        warnings: [],
      }),
    ],
  });
  container.aiGateway = new AiGateway({
    providers: [provider],
    bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    rateLimiter: new InMemoryAiRateLimiter(),
    circuitBreaker: new InMemoryAiCircuitBreaker(),
    executionRepository: new PostgresAiExecutionRepository(db.pool),
    telemetry: new InMemoryAiTelemetry(),
  });
  container.aiExtractionEnabled = true;

  const app = await buildApp({ config, container });
  return { app, provider };
}

async function seedUserAndLogin(app, { email, tenantId }) {
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  await registerUser(
    { userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() },
    { email, password: "senha-forte-123", name: "Usuária", tenantId, role: "owner" },
  );
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: "senha-forte-123" } });
  return login.json().data.accessToken;
}

test("Smoke (FakeAiProvider, app Fastify real via app.inject): campanha incompleta aciona a IA de ponta a ponta e devolve aiAssisted", async () => {
  const { app } = await buildTestAppWithFakeAi();
  const accessToken = await seedUserAndLogin(app, { email: "ai-smoke-1@example.com", tenantId: "tenant-ai-smoke-1" });

  const workspaceResponse = await app.inject({ method: "POST", url: "/v1/workspaces", headers: { authorization: `Bearer ${accessToken}` }, payload: { name: "W" } });
  const workspace = workspaceResponse.json().data;

  const conversationResponse = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { workspaceId: workspace.id },
  });
  const conversation = conversationResponse.json().data;

  const messageResponse = await app.inject({
    method: "POST",
    url: `/v1/conversations/${conversation.id}/messages?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { content: "quero criar uma campanha para vender tênis novo" },
  });
  assert.equal(messageResponse.statusCode, 200);
  const body = messageResponse.json().data;
  assert.equal(typeof body.aiAssisted, "boolean", "o campo aiAssisted deve estar presente na resposta pública");
  assert.equal(body.aiFallbackUsed, false);
  assert.ok(!("prompt" in body) && !("model" in body) && !("tokens" in body) && !("cost" in body), "nunca expõe prompt/model/tokens/custo ao cliente");

  await app.close();
});

test("Smoke (Gateway desligado, app Fastify real): comportamento idêntico à Sprint 07 — sem campos de IA", async () => {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-ai-gateway-http-smoke-off",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "postgres",
    ZUNO_LOG_LEVEL: "silent",
  });
  const app = await buildApp({ config });
  const accessToken = await seedUserAndLogin(app, { email: "ai-smoke-2@example.com", tenantId: "tenant-ai-smoke-2" });

  const workspaceResponse = await app.inject({ method: "POST", url: "/v1/workspaces", headers: { authorization: `Bearer ${accessToken}` }, payload: { name: "W" } });
  const workspace = workspaceResponse.json().data;
  const conversationResponse = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { workspaceId: workspace.id },
  });
  const conversation = conversationResponse.json().data;

  const messageResponse = await app.inject({
    method: "POST",
    url: `/v1/conversations/${conversation.id}/messages?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { content: "oi" },
  });
  const body = messageResponse.json().data;
  assert.equal(body.aiAssisted, undefined);
  assert.equal(body.decision.action, "respond");

  await app.close();
});
