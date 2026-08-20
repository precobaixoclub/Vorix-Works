import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { BackpressureController, BackupRestorePlanner, OperationalCircuitBreaker, OperationalRateLimiter, ProductionGuard, SecretManagerPublicationSecretStore, redactOperationalValue } from "../dist/application/operations/operational-services.js";
import { InMemoryOperationalStateRepository } from "../dist/infrastructure/storage/in-memory-operational-state-repository.js";
import { PostgresOperationalStateRepository } from "../dist/infrastructure/storage/postgres/postgres-operational-state-repository.js";
import { FailClosedProductionSecretManager, InMemorySecretManager } from "../dist/infrastructure/operations/secret-managers.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

function testConfig(env = {}) {
  return loadApiConfig({
    AUTH_MODE: "noop",
    DEV_PRINCIPAL_TENANT_ID: "tenant-ops",
    DEV_PRINCIPAL_USER_ID: "owner-ops",
    DEV_PRINCIPAL_ROLE: "owner",
    ZUNO_LOG_LEVEL: "silent",
    ...env,
  });
}

test("Production Guard: producao real falha fechado quando Secret Manager de producao nao esta pronto", async () => {
  const guard = new ProductionGuard(
    {
      environment: "production",
      providerEnvironment: "production",
      productionEnabled: true,
      canaryEnabled: true,
      canaryTenantIds: ["tenant-ops"],
      canaryWorkspaceIds: ["workspace-ops"],
      allowedProductionProviders: ["instagram"],
    },
    new FailClosedProductionSecretManager(),
  );

  const decision = await guard.decide({ tenantId: "tenant-ops", workspaceId: "workspace-ops", providerId: "instagram", requiresExternalSideEffect: true });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "secret_manager_not_ready");
});

test("Secret Manager: adapter de Publication nao expõe segredo em health e preserva lookup por referencia", async () => {
  const secretManager = new InMemorySecretManager();
  const store = new SecretManagerPublicationSecretStore(secretManager);
  await store.put({
    tenantId: "tenant-ops",
    workspaceId: "workspace-ops",
    providerId: "meta_pages_sandbox",
    credentialReferenceId: "cred-ops",
    value: { accessToken: "token-ops", pageId: "page-1" },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  });
  const resolved = await store.get({ tenantId: "tenant-ops", workspaceId: "workspace-ops", providerId: "meta_pages_sandbox", credentialReferenceId: "cred-ops" });
  assert.equal(resolved.value.accessToken, "token-ops");
  assert.equal(JSON.stringify(await store.health()).includes("token-ops"), false);
});

test("Circuit breaker persistente: abre, sobrevive a nova instancia, entra em half_open e fecha apos sucesso", async () => {
  const db = await startTestPostgres({ port: 55430 });
  try {
    await applyMigrations(db.pool, MIGRATIONS_DIR);
    const repo = new PostgresOperationalStateRepository(db.pool);
    let now = new Date("2026-07-30T10:00:00.000Z");
    const first = new OperationalCircuitBreaker(repo, { failureThreshold: 2, cooldownMs: 60_000, now: () => now });
    const key = { tenantId: "tenant-ops", workspaceId: "workspace-ops", scope: "publication_provider", target: "linkedin_sandbox" };
    await first.recordFailure(key, { code: "PROVIDER_TIMEOUT", category: "provider_unavailable" });
    const opened = await first.recordFailure(key, { code: "PROVIDER_TIMEOUT", category: "provider_unavailable" });
    assert.equal(opened.state, "open");

    const restarted = new OperationalCircuitBreaker(repo, { failureThreshold: 2, cooldownMs: 60_000, now: () => now });
    assert.equal((await restarted.canExecute(key)).allowed, false);
    now = new Date("2026-07-30T10:02:00.000Z");
    const halfOpen = await restarted.canExecute(key);
    assert.equal(halfOpen.allowed, true);
    assert.equal(halfOpen.snapshot.state, "half_open");
    const closed = await restarted.recordSuccess(key);
    assert.equal(closed.state, "closed");
    assert.equal(closed.failureCount, 0);
  } finally {
    await db.stop();
  }
});

test("Rate limiter: limita por grupo, tenant, principal e janela", async () => {
  const repo = new InMemoryOperationalStateRepository();
  let now = new Date("2026-07-30T10:00:00.000Z");
  const limiter = new OperationalRateLimiter(repo, { defaultLimit: 2, windowMs: 60_000, now: () => now });
  const input = { routeGroup: "publication_operate", tenantId: "tenant-ops", principalId: "owner-ops", ip: "127.0.0.1" };
  assert.equal((await limiter.consume(input)).allowed, true);
  assert.equal((await limiter.consume(input)).allowed, true);
  const blocked = await limiter.consume(input);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  now = new Date("2026-07-30T10:01:01.000Z");
  assert.equal((await limiter.consume(input)).allowed, true);
});

test("Backpressure: ativa quando outbox/dead letters excedem limites e registra sinal seguro", async () => {
  const repo = new InMemoryOperationalStateRepository();
  const controller = new BackpressureController(repo, {
    publicationQueueMax: 1,
    publicationOutboxPendingMax: 1,
    publicationDeadLetterMax: 0,
    schedulingLateMsMax: 60_000,
    analyticsDeadLetterMax: 0,
  });
  const signal = await controller.evaluatePublication({
    tenantId: "tenant-ops",
    workspaceId: "workspace-ops",
    metrics: {
      queueSize: 2,
      queueLatencyMs: 10,
      workerUtilization: 1,
      publicationThroughput: 0,
      deadLetters: 1,
      recoveries: 0,
      schedulerDelayMs: 0,
      lockContention: 0,
      outboxPending: 2,
      outboxClaimed: 0,
      outboxAgeMs: 10,
      dispatchSuccess: 0,
      dispatchFailure: 1,
      unknownOutcomes: 0,
      reconciliationPending: 0,
      reconciliationSuccess: 0,
      receiptMismatch: 0,
      leaseExpired: 0,
      fencingRejected: 0,
      credentialResolutionFailures: 0,
    },
  });
  assert.equal(signal.status, "active");
  assert.equal((await controller.list({ activeOnly: true })).length, 1);
});

test("API operacional: readiness falha com Secret Manager de producao nao configurado e system health exige permissao", async () => {
  const app = await buildApp({
    config: testConfig({
      EXECUTION_ENVIRONMENT: "production",
      PUBLICATION_PROVIDER_ENVIRONMENT: "production",
      PUBLICATION_PRODUCTION_ENABLED: "true",
      PUBLICATION_CANARY_ENABLED: "true",
      PUBLICATION_CANARY_TENANT_IDS: "tenant-ops",
      PUBLICATION_CANARY_WORKSPACE_IDS: "workspace-ops",
      SECRET_MANAGER_PROVIDER: "production",
    }),
  });
  const ready = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().data.ready, false);
  const secrets = await app.inject({ method: "GET", url: "/v1/system/secrets/health" });
  assert.equal(secrets.statusCode, 200);
  assert.equal(secrets.json().data.ok, false);
  await app.close();

  const viewer = await buildApp({ config: testConfig({ DEV_PRINCIPAL_ROLE: "viewer" }) });
  const denied = await viewer.inject({ method: "GET", url: "/v1/system/health" });
  assert.equal(denied.statusCode, 403);
  await viewer.close();
});

test("API rate limit: health/livez ficam fora do limite e rotas de negocio recebem 429", async () => {
  const app = await buildApp({ config: testConfig({ OPERATIONAL_RATE_LIMIT_DEFAULT: "1", OPERATIONAL_RATE_LIMIT_WINDOW_MS: "60000" }) });
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/v1/workspaces" })).statusCode, 200);
  const limited = await app.inject({ method: "GET", url: "/v1/workspaces" });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, "RATE_LIMIT_EXCEEDED");
  await app.close();
});

test("API operacional: bastidor nao vaza fila, rate limits ou reset de outro tenant", async () => {
  const app = await buildApp({ config: testConfig() });
  try {
    await app.zunoContainer.publicationQueue.enqueue({
      id: "job-owned",
      publicationId: "publication-owned",
      tenantId: "tenant-ops",
      workspaceId: "workspace-ops",
      kind: "publish",
      enqueuedAt: "2026-07-30T10:00:00.000Z",
    });
    await app.zunoContainer.publicationQueue.enqueue({
      id: "job-other-tenant",
      publicationId: "publication-other-tenant",
      tenantId: "tenant-other",
      workspaceId: "workspace-ops",
      kind: "publish",
      enqueuedAt: "2026-07-30T10:00:00.000Z",
    });
    await app.zunoContainer.publicationQueue.enqueue({
      id: "job-other-workspace",
      publicationId: "publication-other-workspace",
      tenantId: "tenant-ops",
      workspaceId: "workspace-other",
      kind: "publish",
      enqueuedAt: "2026-07-30T10:00:00.000Z",
    });

    const queues = await app.inject({ method: "GET", url: "/v1/system/queues?workspaceId=workspace-ops" });
    assert.equal(queues.statusCode, 200);
    assert.deepEqual(queues.json().data.publication.localJobs.map((job) => job.id), ["job-owned"]);
    assert.equal(queues.json().data.publication.localQueueSize, 1);
    const [safeJob] = queues.json().data.publication.localJobs;
    assert.equal("tenantId" in safeJob, false);
    assert.equal("workspaceId" in safeJob, false);

    await app.zunoContainer.operationalRateLimiter.consume({ routeGroup: "publication_operate", tenantId: "tenant-ops", principalId: "owner-ops", ip: "127.0.0.1" });
    const rateLimits = await app.inject({ method: "GET", url: "/v1/system/rate-limits?workspaceId=workspace-ops" });
    assert.equal(rateLimits.statusCode, 200);
    const bucket = rateLimits.json().data.find((item) => item.routeGroup === "publication_operate");
    assert.ok(bucket);
    assert.equal(bucket.routeGroup, "publication_operate");
    assert.equal("principalId" in bucket, false);
    assert.equal("ip" in bucket, false);
    assert.equal("tenantId" in bucket, false);
    assert.equal(bucket.key.includes("owner-ops"), false);
    assert.equal(bucket.key.includes("127.0.0.1"), false);

    const key = { tenantId: "tenant-other", workspaceId: "workspace-other", scope: "publication_provider", target: "instagram" };
    await app.zunoContainer.operationalCircuitBreaker.recordFailure(key, { code: "PROVIDER_TIMEOUT", category: "provider_unavailable" });
    const opened = await app.zunoContainer.operationalCircuitBreaker.recordFailure(key, { code: "PROVIDER_TIMEOUT", category: "provider_unavailable" });
    assert.equal(opened.state, "open");
    const deniedReset = await app.inject({ method: "POST", url: `/v1/system/circuit-breakers/${encodeURIComponent(opened.id)}/reset?workspaceId=workspace-ops` });
    assert.equal(deniedReset.statusCode, 404);
    const [remaining] = await app.zunoContainer.operationalCircuitBreaker.list({ tenantId: "tenant-other", workspaceId: "workspace-other" });
    assert.equal(remaining.state, "open");
  } finally {
    await app.close();
  }
});

test("Backup/restore plan e redaction removem credenciais sensiveis", () => {
  const plan = new BackupRestorePlanner().describePlan();
  assert.ok(plan.restoreOrder.includes("derived_rebuild"));
  const redacted = redactOperationalValue({ authorization: "Bearer abc", nested: { accessToken: "secret", safe: "ok" } });
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.equal(redacted.nested.accessToken, "[REDACTED]");
  assert.equal(redacted.nested.safe, "ok");
});
