import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { SolutionAccessService } from "../dist/application/solutions/solution-access.service.js";
import {
  assertGrantSourceAllowed,
  listPublicSolutions,
  MARKETING_ROUTE_PREFIXES,
  resolveSolutionAccess,
  solutionForApiPath,
  SOLUTIONS,
} from "../dist/domain/solutions/solution.model.js";
import { nextOnboardingStep, ONBOARDING_WIZARD_STEPS } from "../dist/domain/onboarding/onboarding.model.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Separação de SOLUÇÕES (Vorix Conversas x Vorix Marketing). O ponto central destes testes:
 * esconder um item de menu não é isolamento — o bloqueio do Marketing é verificado na API, com
 * banco real (PGlite) para o entitlement.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55741 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => {
  await db.stop();
});

// --- Modelo -----------------------------------------------------------------------------------

test("DISPONIBILIDADE COMERCIAL: só o Vorix Conversas é público; Marketing é interno", () => {
  assert.deepEqual(listPublicSolutions().map((solution) => solution.key), ["conversations"]);
  assert.equal(SOLUTIONS.marketing.commercialAvailability, "internal");
  assert.equal(SOLUTIONS.marketing.defaultEntitlement, false, "Marketing é fail-closed");
  assert.equal(SOLUTIONS.conversations.defaultEntitlement, true, "nenhum cliente atual perde o Conversas por falta de linha");
});

test("ACESSO: kill switch, entitlement e default são conceitos separados", () => {
  const marketing = SOLUTIONS.marketing;
  assert.equal(resolveSolutionAccess({ solution: marketing, killSwitchOn: false }).enabled, false, "sem linha = default da solução");
  assert.equal(resolveSolutionAccess({ solution: marketing, entitlement: { enabled: true, source: "internal" }, killSwitchOn: false }).enabled, true);
  assert.equal(resolveSolutionAccess({ solution: marketing, entitlement: { enabled: true, source: "internal" }, killSwitchOn: true }).enabled, false, "kill switch vence a concessão");
  assert.equal(resolveSolutionAccess({ solution: SOLUTIONS.conversations, entitlement: { enabled: false, source: "manual" }, killSwitchOn: false }).enabled, false, "linha explícita vence o default");
  assert.equal(resolveSolutionAccess({ solution: marketing, killSwitchOn: false }).internal, true);
});

test("CONCESSÃO: solução não comercial só aceita origem interna", () => {
  assert.doesNotThrow(() => assertGrantSourceAllowed(SOLUTIONS.marketing, "internal"));
  assert.throws(() => assertGrantSourceAllowed(SOLUTIONS.marketing, "subscription"), /SOLUTION_NOT_CONTRACTABLE/);
  assert.throws(() => assertGrantSourceAllowed(SOLUTIONS.marketing, "manual"), /SOLUTION_NOT_CONTRACTABLE/);
  assert.doesNotThrow(() => assertGrantSourceAllowed(SOLUTIONS.conversations, "subscription"));
});

test("ROTAS: classificação por solução — Marketing barrado, Core e Conversas livres", () => {
  for (const path of ["/v1/assets", "/v1/assets/upload", "/v1/brand-profile", "/v1/brand-identity/suggest-from-logo", "/v1/production/ideas", "/v1/production/creative-engine/status", "/v1/publications", "/v1/publications/queue", "/v1/planning", "/v1/runtime", "/v1/execution-runs/abc", "/v1/schedules", "/v1/calendar", "/v1/analytics/overview?x=1", "/v1/meta-ads/campaigns", "/v1/tiktok/posts", "/v1/youtube/posts", "/v1/instagram/posts", "/v1/publication-providers/tiktok/oauth/status", "/v1/credentials", "/v1/conversations", "/v1/briefings", "/v1/production-settings", "/v1/providers"]) {
    assert.equal(solutionForApiPath(path), "marketing", path);
  }
  for (const path of ["/v1/inbox/conversations", "/v1/inbox/stream", "/v1/contacts", "/v1/deals", "/v1/pipelines", "/v1/tasks", "/v1/proposals", "/v1/proposal-templates", "/v1/products", "/v1/automation-rules", "/v1/teams", "/v1/tenant-members", "/v1/commercial-metrics", "/v1/workspaces", "/v1/auth/login", "/v1/billing/overview", "/v1/onboarding", "/v1/notifications", "/v1/solutions", "/v1/admin/tenants", "/v1/health", "/v1/platform/plans", "/v1/public/proposals/x"]) {
    assert.equal(solutionForApiPath(path), undefined, path);
  }
  // Integração COMPARTILHADA: o login Meta também conecta o canal Instagram Direct do Conversas.
  assert.equal(solutionForApiPath("/v1/publication-providers/meta/oauth/status"), undefined);
  assert.equal(solutionForApiPath("/v1/publication-providers/meta/oauth/connect"), undefined);
  // Casa por segmento inteiro, nunca por prefixo de texto.
  assert.equal(solutionForApiPath("/v1/productions"), undefined);
  assert.equal(solutionForApiPath("/v1/assetsx"), undefined);
  assert.ok(MARKETING_ROUTE_PREFIXES.length > 20);
});

test("ONBOARDING: o wizard é só do Conversas — a etapa de marca (Marketing) saiu da sequência", () => {
  assert.deepEqual([...ONBOARDING_WIZARD_STEPS], ["company", "channel", "team", "commercial", "done"]);
  assert.equal(nextOnboardingStep("commercial"), "done");
  assert.equal(nextOnboardingStep("brand"), "done", "linha antiga parada em 'brand' segue para o fim");
  assert.equal(nextOnboardingStep("done"), "done");
});

// --- Entitlement com banco real ----------------------------------------------------------------

function makeService(options = {}) {
  return new SolutionAccessService({ repository: new PostgresSolutionEntitlementRepository(db.pool), cacheTtlMs: 0, ...options });
}

test("ENTITLEMENT: tenant comum tem Conversas e NÃO tem Marketing; concessão interna libera e fica auditada", async () => {
  const service = makeService();
  const tenantId = "tenant-sol-1";
  assert.deepEqual((await service.listAccess(tenantId)).map((a) => [a.key, a.enabled]), [["conversations", true], ["marketing", false]]);
  assert.equal(await service.hasAccess(tenantId, "marketing"), false);

  await assert.rejects(() => service.setEntitlement({ tenantId, solutionKey: "marketing", enabled: true, source: "subscription" }), /SOLUTION_NOT_CONTRACTABLE/);
  assert.equal(await service.hasAccess(tenantId, "marketing"), false, "tentativa de 'venda' não concede nada");

  const granted = await service.setEntitlement({ tenantId, solutionKey: "marketing", enabled: true, source: "internal", reason: "homologação", actorUserId: "platform-admin-1" });
  assert.equal(granted.source, "internal");
  assert.equal(await service.hasAccess(tenantId, "marketing"), true);
  assert.equal(await service.hasAccess("tenant-sol-outro", "marketing"), false, "concessão é por tenant");

  await service.setEntitlement({ tenantId, solutionKey: "marketing", enabled: false, source: "internal", actorUserId: "platform-admin-1" });
  assert.equal(await service.hasAccess(tenantId, "marketing"), false);

  const audit = await db.pool.query(`select old_enabled, new_enabled, source, actor_user_id from solution_entitlement_audit_log where tenant_id = $1 order by occurred_at`, [tenantId]);
  assert.deepEqual(audit.rows.map((row) => [row.old_enabled, row.new_enabled]), [[null, true], [true, false]]);
  assert.equal(audit.rows[0].actor_user_id, "platform-admin-1");
});

test("KILL SWITCH: desliga a solução para todos, inclusive quem tem concessão interna", async () => {
  const tenantId = "tenant-sol-kill";
  await makeService().setEntitlement({ tenantId, solutionKey: "marketing", enabled: true, source: "internal" });
  assert.equal(await makeService().hasAccess(tenantId, "marketing"), true);
  const killed = makeService({ killSwitches: new Set(["marketing"]) });
  assert.equal(await killed.hasAccess(tenantId, "marketing"), false);
  assert.equal(await killed.hasAccess(tenantId, "conversations"), true, "o kill switch de uma solução não afeta a outra");
});

test("CACHE: uma concessão nova vale imediatamente no mesmo processo", async () => {
  const service = makeService({ cacheTtlMs: 60_000 });
  const tenantId = "tenant-sol-cache";
  assert.equal(await service.hasAccess(tenantId, "marketing"), false);
  await service.setEntitlement({ tenantId, solutionKey: "marketing", enabled: true, source: "internal" });
  assert.equal(await service.hasAccess(tenantId, "marketing"), true);
});

test("MIGRATION: quem já usa o Creative Engine mantém acesso interno ao Marketing; ninguém mais ganha", async () => {
  const tenantId = "tenant-sol-ce";
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `ws-sol-ce-${Date.now()}` }).create({ tenantId, name: "W" });
  await db.pool.query(`insert into creative_engine_workspace_entitlements (tenant_id, workspace_id, enabled) values ($1, $2, true)`, [tenantId, workspace.id]);
  // Mesmo statement da migration 0143 (idempotente) — reexecutado sobre o dado recém-criado.
  await db.pool.query(
    `insert into solution_entitlements (tenant_id, solution_key, enabled, source, reason, updated_by)
     select distinct cee.tenant_id, 'marketing', true, 'internal', 'seed', 'migration-0143'
     from creative_engine_workspace_entitlements cee where cee.enabled
     on conflict (tenant_id, solution_key) do nothing`,
  );
  const service = makeService();
  assert.equal(await service.hasAccess(tenantId, "marketing"), true);
  assert.equal(await service.hasAccess("tenant-sem-creative-engine", "marketing"), false);
  const tables = await db.pool.query(`select count(*)::int as n from information_schema.tables where table_name in ('assets', 'creative_engine_runs', 'publications', 'brand_visual_profiles', 'creative_engine_workspace_entitlements')`);
  assert.ok(tables.rows[0].n >= 3, "tabelas do Marketing continuam existindo");
});

// --- API: o bloqueio de verdade -----------------------------------------------------------------

function principal({ tenantId, role = "owner", isPlatformAdmin = false }) {
  return { userId: `user-${tenantId}`, tenantId, role, sessionId: "s1", isPlatformAdmin };
}

async function buildTestApp({ tenantId, role, isPlatformAdmin, service }) {
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" });
  const authPort = { async verifyToken() { return { authenticated: true, principal: principal({ tenantId, role, isPlatformAdmin }) }; } };
  return buildApp({ config, container: { authPort, solutionAccess: service } });
}

const MARKETING_REQUESTS = [
  ["GET", "/v1/assets?workspaceId=ws"],
  ["GET", "/v1/planning?workspaceId=ws"],
  ["GET", "/v1/runtime?workspaceId=ws"],
  ["GET", "/v1/execution-runs?workspaceId=ws"],
  ["GET", "/v1/publications?workspaceId=ws"],
  ["GET", "/v1/schedules?workspaceId=ws"],
  ["GET", "/v1/calendar?workspaceId=ws"],
  ["GET", "/v1/analytics/overview?workspaceId=ws"],
  ["GET", "/v1/brand-profile?workspaceId=ws"],
  ["GET", "/v1/production/creative-engine/status?workspaceId=ws"],
  ["GET", "/v1/credentials?workspaceId=ws"],
  ["GET", "/v1/publication-providers/tiktok/oauth/status?workspaceId=ws"],
  ["POST", "/v1/production/ideas"],
  ["POST", "/v1/assets/upload"],
  ["POST", "/v1/instagram/posts"],
];

test("API: usuário comum (até owner) recebe 403 em TODA rota de Marketing — não é só a sidebar", async () => {
  const app = await buildTestApp({ tenantId: "tenant-api-comum", role: "owner", service: makeService() });
  for (const [method, url] of MARKETING_REQUESTS) {
    const response = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
    assert.equal(response.statusCode, 403, `${method} ${url}`);
    assert.equal(response.json().error.code, "SOLUTION_ACCESS_DENIED", `${method} ${url}`);
  }
  await app.close();
});

test("API: Conversas e Core seguem funcionando para o mesmo usuário comum", async () => {
  const tenantId = "tenant-api-conversas";
  const app = await buildTestApp({ tenantId, role: "owner", service: makeService() });
  const workspace = await app.zunoContainer.workspaceRepository.create({ tenantId, name: "Operação" });
  for (const url of [`/v1/inbox/conversations?workspaceId=${workspace.id}`, `/v1/inbox/connections?workspaceId=${workspace.id}`, "/v1/workspaces", "/v1/health", "/v1/platform/plans", `/v1/notifications?workspaceId=${workspace.id}`, `/v1/publication-providers/meta/oauth/status?workspaceId=${workspace.id}`]) {
    const response = await app.inject({ method: "GET", url });
    assert.notEqual(response.statusCode, 403, url);
    assert.notEqual(response.json()?.error?.code, "SOLUTION_ACCESS_DENIED", url);
  }
  const solutions = await app.inject({ method: "GET", url: "/v1/solutions" });
  assert.equal(solutions.statusCode, 200);
  assert.deepEqual(solutions.json().data.solutions, [{ key: "conversations", name: "Vorix Conversas", internal: false }], "Marketing nem aparece na lista — sem 'em breve'");
  await app.close();
});

test("API: tenant com concessão INTERNA acessa o Marketing e vê as duas soluções", async () => {
  const tenantId = "tenant-api-interno";
  const service = makeService();
  await service.setEntitlement({ tenantId, solutionKey: "marketing", enabled: true, source: "internal", reason: "time interno" });
  const app = await buildTestApp({ tenantId, role: "owner", service });
  const workspace = await app.zunoContainer.workspaceRepository.create({ tenantId, name: "Interno" });
  for (const url of [`/v1/assets?workspaceId=${workspace.id}`, `/v1/planning?workspaceId=${workspace.id}`, `/v1/publications?workspaceId=${workspace.id}`]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200, url);
  }
  const solutions = await app.inject({ method: "GET", url: "/v1/solutions" });
  assert.deepEqual(solutions.json().data.solutions.map((s) => [s.key, s.internal]), [["conversations", false], ["marketing", true]]);
  await app.close();
});

test("API: o guarda de solução não substitui o RBAC — viewer interno continua barrado pelo papel", async () => {
  const tenantId = "tenant-api-rbac";
  const service = makeService();
  await service.setEntitlement({ tenantId, solutionKey: "marketing", enabled: true, source: "internal" });
  const app = await buildTestApp({ tenantId, role: "viewer", service });
  const upload = await app.inject({ method: "POST", url: "/v1/assets/upload", payload: {} });
  assert.notEqual(upload.json()?.error?.code, "SOLUTION_ACCESS_DENIED");
  assert.ok([400, 403, 415].includes(upload.statusCode), `status ${upload.statusCode}`);
  await app.close();
});

test("API: conceder solução é só de administrador da plataforma, e Marketing recusa origem comercial", async () => {
  const service = makeService();
  const ownerApp = await buildTestApp({ tenantId: "tenant-api-dono", role: "owner", service });
  const denied = await ownerApp.inject({ method: "PUT", url: "/v1/admin/tenants/tenant-api-dono/solutions/marketing", payload: { enabled: true, source: "internal" } });
  assert.equal(denied.statusCode, 403, "owner de tenant não se autoconcede Marketing");
  assert.equal(await service.hasAccess("tenant-api-dono", "marketing"), false);
  await ownerApp.close();

  const adminApp = await buildTestApp({ tenantId: "tenant-plataforma", role: "owner", isPlatformAdmin: true, service });
  const commercial = await adminApp.inject({ method: "PUT", url: "/v1/admin/tenants/tenant-api-dono/solutions/marketing", payload: { enabled: true, source: "subscription" } });
  assert.equal(commercial.statusCode, 409);
  assert.equal(commercial.json().error.code, "SOLUTION_NOT_CONTRACTABLE");
  const unknown = await adminApp.inject({ method: "PUT", url: "/v1/admin/tenants/tenant-api-dono/solutions/meetings", payload: { enabled: true, source: "internal" } });
  assert.equal(unknown.statusCode, 400);

  const granted = await adminApp.inject({ method: "PUT", url: "/v1/admin/tenants/tenant-api-dono/solutions/marketing", payload: { enabled: true, source: "internal", reason: "teste interno" } });
  assert.equal(granted.statusCode, 200);
  assert.equal(await service.hasAccess("tenant-api-dono", "marketing"), true);
  const listed = await adminApp.inject({ method: "GET", url: "/v1/admin/tenants/tenant-api-dono/solutions" });
  assert.deepEqual(listed.json().data.solutions.map((s) => [s.key, s.enabled, s.commercialAvailability]), [["conversations", true, "public"], ["marketing", true, "internal"]]);
  await adminApp.close();
});

test("API: requisição sem autenticação não é decidida pelo guarda (webhooks/callbacks seguem com a própria rota)", async () => {
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop" });
  const authPort = { async verifyToken() { return { authenticated: false, reason: "missing_token" }; } };
  const app = await buildApp({ config, container: { authPort, solutionAccess: makeService() } });
  const response = await app.inject({ method: "GET", url: "/v1/assets?workspaceId=ws" });
  assert.equal(response.statusCode, 401, "sem principal quem responde é a rota (401), não o guarda (403)");
  await app.close();
});
