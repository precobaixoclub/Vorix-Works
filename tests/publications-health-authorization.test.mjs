import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";
import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";
import { InMemoryPublicationQueue } from "../dist/application/publication/publication-queue.js";
import { collectPublicationMetrics, collectWorkspacePublicationHealth } from "../dist/application/publication/publication-observability.js";

/**
 * Segurança — `GET /v1/publications/health`. Antes bastava `publication:read` (todo papel de qualquer
 * empresa) e a resposta trazia a fila global, as travas com IDs de publicações de OUTRAS empresas e a
 * saúde do cofre de segredos. Agora: sem `workspaceId` → visão global só para o administrador da
 * plataforma; com `workspaceId` → só os dados daquele workspace, e workspace de outra empresa → 404.
 * Tudo em memória, com dados simulados (nenhuma publicação real, nenhum provedor externo chamado).
 */

const TENANT_A = "tenant-pub-a";
const TENANT_B = "tenant-pub-b";

function plan(id, tenantId, workspaceId) {
  return { plan: { id, tenantId, workspaceId, state: "approved", mode: "manual", idempotencyKey: `idem-${id}`, createdBy: "qa" }, candidates: [], targets: [] };
}

/** Repositórios compartilhados entre os "apps" de cada pessoa: duas empresas, um workspace cada. */
async function sharedWorld() {
  const workspaceRepository = new InMemoryWorkspaceRepository();
  const publicationRepository = new InMemoryPublicationRepository();
  const publicationQueue = new InMemoryPublicationQueue();
  const wsA = await workspaceRepository.create({ tenantId: TENANT_A, name: "Empresa A" });
  const wsARestricted = await workspaceRepository.create({ tenantId: TENANT_A, name: "Empresa A - outro espaço" });
  const wsB = await workspaceRepository.create({ tenantId: TENANT_B, name: "Empresa B" });
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 60_000).toISOString();
  for (const [id, tenantId, workspaceId] of [["pub-a-1", TENANT_A, wsA.id], ["pub-b-secreta", TENANT_B, wsB.id]]) {
    await publicationRepository.createPlan(plan(id, tenantId, workspaceId));
    await publicationRepository.acquireLock({ publicationId: id, ownerId: `worker-${id}`, acquiredAt: now, expiresAt: later });
    await publicationQueue.enqueue({ id: `job-${id}`, publicationId: id, tenantId, workspaceId, kind: "publish", enqueuedAt: now });
  }
  // Mais dois jobs da empresa B: a fila global (3 da B + 1 da A) não pode aparecer para a empresa A.
  for (const n of [2, 3]) await publicationQueue.enqueue({ id: `job-b-${n}`, publicationId: `pub-b-${n}`, tenantId: TENANT_B, workspaceId: wsB.id, kind: "publish", enqueuedAt: now });
  return { workspaceRepository, publicationRepository, publicationQueue, wsA, wsARestricted, wsB };
}

async function appFor(world, { tenantId = TENANT_A, role = "owner", platformAdmin = false, authenticated = true, workspaceIds } = {}) {
  const env = { AUTH_MODE: "noop", ZUNO_LOG_LEVEL: "silent" };
  if (authenticated) Object.assign(env, { DEV_PRINCIPAL_TENANT_ID: tenantId, DEV_PRINCIPAL_USER_ID: `user-${role}`, DEV_PRINCIPAL_ROLE: role, ...(platformAdmin ? { DEV_PRINCIPAL_PLATFORM_ADMIN: "true" } : {}) });
  return buildApp({ config: loadApiConfig(env), container: { workspaceRepository: world.workspaceRepository, publicationRepository: world.publicationRepository, publicationQueue: world.publicationQueue, ...(workspaceIds ? { authPort: {
    async verifyToken() { return { authenticated: true, principal: { tenantId, userId: `user-${role}`, sessionId: "test", role, isPlatformAdmin: platformAdmin, workspaceIds } }; },
  } } : {}) } });
}

const get = (app, query = "") => app.inject({ method: "GET", url: `/v1/publications/health${query}`, headers: { authorization: "Bearer test" } });

test("sem autenticação: 401 nas duas visões", async () => {
  const world = await sharedWorld();
  const app = await appFor(world, { authenticated: false });
  try {
    assert.equal((await get(app)).statusCode, 401);
    assert.equal((await get(app, `?workspaceId=${world.wsA.id}`)).statusCode, 401);
  } finally {
    await app.close();
  }
});

for (const role of ["viewer", "editor", "admin", "owner"]) {
  test(`papel "${role}" de empresa: visão global negada (403) sem vazar fila, travas nem cofre`, async () => {
    const world = await sharedWorld();
    const app = await appFor(world, { role });
    try {
      const response = await get(app);
      assert.equal(response.statusCode, 403, role);
      for (const leak of ["pub-b-secreta", "pub-a-1", "locks", "secretResolver", "queue", "outbox"]) assert.equal(response.body.includes(leak), false, `${role} vazou "${leak}"`);
    } finally {
      await app.close();
    }
  });

  test(`papel "${role}": no próprio workspace vê só os dados dele`, async () => {
    const world = await sharedWorld();
    const app = await appFor(world, { role });
    try {
      const response = await get(app, `?workspaceId=${encodeURIComponent(world.wsA.id)}`);
      assert.equal(response.statusCode, 200, role);
      const data = response.json().data;
      assert.deepEqual(data.scope, { tenantId: TENANT_A, workspaceId: world.wsA.id });
      assert.deepEqual(data.orchestrator.locks.map((lock) => lock.publicationId), ["pub-a-1"]);
      assert.equal(data.queue.size, 1, "só o job da própria empresa");
      assert.equal(response.body.includes("pub-b-secreta"), false);
      assert.equal("secretResolver" in data, false, "saúde do cofre é dado da plataforma");
      assert.equal("publicationProviders" in data, false, "saúde dos provedores é dado da plataforma");
      assert.equal("ownerId" in data.orchestrator.locks[0], false, "o processo que detém a trava é interno");
    } finally {
      await app.close();
    }
  });
}

test("acesso cruzado: empresa A pedindo o workspace da empresa B recebe 404, sem dados", async () => {
  const world = await sharedWorld();
  const app = await appFor(world, { tenantId: TENANT_A, role: "owner" });
  try {
    for (const workspaceId of [world.wsB.id, "workspace-inexistente"]) {
      const response = await get(app, `?workspaceId=${encodeURIComponent(workspaceId)}`);
      assert.equal(response.statusCode, 404, workspaceId);
      assert.equal(response.json().error.code, "NOT_FOUND");
      assert.equal(response.body.includes("pub-b-secreta"), false);
    }
  } finally {
    await app.close();
  }
});

test("restrição por pessoa bloqueia outro workspace da mesma empresa", async () => {
  const world = await sharedWorld();
  const app = await appFor(world, { role: "editor", workspaceIds: [world.wsA.id] });
  try {
    assert.equal((await get(app, `?workspaceId=${world.wsA.id}`)).statusCode, 200);
    assert.equal((await get(app, `?workspaceId=${world.wsARestricted.id}`)).statusCode, 404);
  } finally {
    await app.close();
  }
});

test("a empresa B, no próprio workspace, vê as suas travas e nunca as da empresa A", async () => {
  const world = await sharedWorld();
  const app = await appFor(world, { tenantId: TENANT_B, role: "admin" });
  try {
    const data = (await get(app, `?workspaceId=${encodeURIComponent(world.wsB.id)}`)).json().data;
    assert.deepEqual(data.orchestrator.locks.map((lock) => lock.publicationId), ["pub-b-secreta"]);
    assert.equal(data.queue.size, 3);
  } finally {
    await app.close();
  }
});

test("administrador global: visão global completa (monitoramento interno preservado)", async () => {
  const world = await sharedWorld();
  const app = await appFor(world, { tenantId: TENANT_A, role: "owner", platformAdmin: true });
  try {
    const response = await get(app);
    assert.equal(response.statusCode, 200);
    const data = response.json().data;
    assert.equal(data.queue.size, 4);
    assert.deepEqual(data.orchestrator.locks.map((lock) => lock.publicationId).sort(), ["pub-a-1", "pub-b-secreta"]);
    assert.equal(typeof data.secretResolver.ready, "boolean");
    for (const key of ["database", "outbox", "scheduler", "workers", "publicationProviders", "reconciliationService"]) assert.ok(key in data, key);
  } finally {
    await app.close();
  }
});

test("métricas por workspace contam só a fila daquele workspace (antes somavam a fila global)", async () => {
  const world = await sharedWorld();
  const metricsA = await collectPublicationMetrics({ repository: world.publicationRepository, queue: world.publicationQueue, tenantId: TENANT_A, workspaceId: world.wsA.id });
  const metricsB = await collectPublicationMetrics({ repository: world.publicationRepository, queue: world.publicationQueue, tenantId: TENANT_B, workspaceId: world.wsB.id });
  assert.equal(metricsA.queueSize, 1);
  assert.equal(metricsB.queueSize, 3);
  // Mesmo tenant, workspace errado: nada.
  const crossed = await collectWorkspacePublicationHealth({ repository: world.publicationRepository, queue: world.publicationQueue, tenantId: TENANT_A, workspaceId: world.wsB.id });
  assert.deepEqual(crossed.orchestrator.locks, []);
  assert.equal(crossed.queue.size, 0);
});

test("/publications/metrics com workspace alheio continua 404 e no próprio não mostra a fila dos outros", async () => {
  const world = await sharedWorld();
  const app = await appFor(world, { tenantId: TENANT_A, role: "viewer" });
  try {
    assert.equal((await app.inject({ method: "GET", url: `/v1/publications/metrics?workspaceId=${encodeURIComponent(world.wsB.id)}` })).statusCode, 404);
    const own = await app.inject({ method: "GET", url: `/v1/publications/metrics?workspaceId=${encodeURIComponent(world.wsA.id)}` });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().data.queueSize, 1);
  } finally {
    await app.close();
  }
});
