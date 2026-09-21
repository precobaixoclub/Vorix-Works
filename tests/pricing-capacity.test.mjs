import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresSubscriptionPendingChangeRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-pending-change-repository.js";
import { PostgresUsageCounterRepository } from "../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js";
import { PostgresBillingEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { DefaultResourceCounterAdapter } from "../dist/infrastructure/billing/resource-counter-adapter.js";
import { computeCapacityCost, recommendBestPlan, resolveCommercialCapacity, validateCatalogCoherence } from "../dist/domain/platform-billing/capacity.model.js";
import { purchaseAddon } from "../dist/application/billing/lifecycle-use-cases.js";
import { previewCapacityChange, applyCapacityChange, applyDuePendingCapacityChanges, cancelPendingCapacityChange, getCapacityState } from "../dist/application/billing/capacity-use-cases.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Pricing/Capacity Etapa B — pacote (START/PRO/BUSINESS, BRL) + capacidade incluída (usuários/
 * números WhatsApp) + adicionais self-service. Cobre: matemática de custo/crossover (seção 41-42 do
 * pedido, contra o catálogo REAL semeado pela migration, não fixtures sintéticas), coerência do
 * catálogo (seção 18), quantidade de addon soma corretamente + concorrência (seção 7-8), redução
 * agendada + aplicação pelo scheduler (seção 15/22), proteção contra reduzir abaixo do uso ativo
 * (seção 13/19-20), recomendação de plano (seção 16), isolamento multi-tenant, e o teste crítico de
 * preço público = preço de checkout (seção 44).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55996 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function capacityDeps() {
  return {
    billingProvider: new SandboxBillingProvider(),
    billingEventRepository: new PostgresBillingEventRepository(db.pool),
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    subscriptionItemRepository: new PostgresSubscriptionItemRepository(db.pool),
    subscriptionPendingChangeRepository: new PostgresSubscriptionPendingChangeRepository(db.pool),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    addonDefinitionRepository: new PostgresAddonDefinitionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    usageCounterRepository: new PostgresUsageCounterRepository(db.pool),
    resourceCounter: new DefaultResourceCounterAdapter({
      tenantMembershipRepository: new PostgresTenantMembershipRepository(db.pool),
      workspaceRepository: new PostgresWorkspaceRepository(db.pool),
      messagingConnectionRepository: { listByWorkspace: async () => [] },
      contactRepository: new PostgresContactRepository(db.pool),
      automationRuleRepository: { listByWorkspace: async () => [] },
    }),
  };
}

async function makeRealSubscriber(deps, tenantId, planCode) {
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const planVersion = await deps.planVersionRepository.getActiveVersion(planCode);
  return deps.subscriptionRepository.create({
    tenantId, planVersionId: planVersion.id, status: "active", billingProvider: "sandbox",
    billingInterval: "monthly", providerCustomerId: `cus-${tenantId}`, providerSubscriptionId: `sub-${tenantId}`,
  });
}

// ---------------------------------------------------------------------------------------------
// Matemática de custo (seção 41 do pedido) — contra o catálogo REAL semeado (migration 0132)

test("Pricing math: catálogo real tem os 3 planos aprovados em BRL com a capacidade aprovada", async () => {
  const deps = capacityDeps();
  const start = await deps.planVersionRepository.getActiveVersion("START");
  const pro = await deps.planVersionRepository.getActiveVersion("PRO");
  const business = await deps.planVersionRepository.getActiveVersion("BUSINESS");

  assert.equal(start.currency, "BRL");
  assert.equal(start.monthlyPriceUsd, 149);
  assert.equal(start.limits.users, 2);
  assert.equal(start.limits.messaging_connections, 1);

  assert.equal(pro.currency, "BRL");
  assert.equal(pro.monthlyPriceUsd, 299);
  assert.equal(pro.limits.users, 5);
  assert.equal(pro.limits.messaging_connections, 2);

  assert.equal(business.currency, "BRL");
  assert.equal(business.monthlyPriceUsd, 599);
  assert.equal(business.limits.users, 10);
  assert.equal(business.limits.messaging_connections, 5);

  const userAddon = await deps.addonDefinitionRepository.getByCode("extra_user");
  const numberAddon = await deps.addonDefinitionRepository.getByCode("extra_whatsapp_connection");
  assert.equal(userAddon.currency, "BRL");
  assert.equal(userAddon.monthlyPriceUsd, 39);
  assert.equal(numberAddon.currency, "BRL");
  assert.equal(numberAddon.monthlyPriceUsd, 79);
});

test("Pricing math: cenários da seção 41 do pedido, calculados contra o catálogo real", async () => {
  const deps = capacityDeps();
  const [start, pro, business, addons] = await Promise.all([
    deps.planVersionRepository.getActiveVersion("START"),
    deps.planVersionRepository.getActiveVersion("PRO"),
    deps.planVersionRepository.getActiveVersion("BUSINESS"),
    deps.addonDefinitionRepository.listActive(),
  ]);

  const scenarios = [
    { plan: start, users: 2, whatsappConnections: 1, expected: 149 },
    { plan: start, users: 3, whatsappConnections: 1, expected: 188 },
    { plan: start, users: 2, whatsappConnections: 2, expected: 228 },
    { plan: pro, users: 5, whatsappConnections: 2, expected: 299 },
    { plan: pro, users: 6, whatsappConnections: 2, expected: 338 },
    { plan: pro, users: 5, whatsappConnections: 3, expected: 378 },
    { plan: pro, users: 7, whatsappConnections: 3, expected: 456 },
    { plan: business, users: 10, whatsappConnections: 5, expected: 599 },
    { plan: business, users: 11, whatsappConnections: 5, expected: 638 },
    { plan: business, users: 10, whatsappConnections: 6, expected: 678 },
  ];

  for (const scenario of scenarios) {
    const cost = computeCapacityCost(scenario.plan, addons, { users: scenario.users, whatsappConnections: scenario.whatsappConnections });
    assert.equal(cost.totalMonthlyAmount, scenario.expected, `${scenario.plan.planCode} ${scenario.users}/${scenario.whatsappConnections} deveria custar R$${scenario.expected}`);
    assert.equal(cost.feasible, true);
  }
});

// ---------------------------------------------------------------------------------------------
// Crossover (seção 42) e coerência do catálogo (seção 17-18)

test("Pricing math: crossovers da seção 42 do pedido", async () => {
  const deps = capacityDeps();
  const [start, pro, business, addons] = await Promise.all([
    deps.planVersionRepository.getActiveVersion("START"),
    deps.planVersionRepository.getActiveVersion("PRO"),
    deps.planVersionRepository.getActiveVersion("BUSINESS"),
    deps.addonDefinitionRepository.listActive(),
  ]);

  const startToPro = computeCapacityCost(start, addons, { users: 5, whatsappConnections: 2 });
  assert.equal(startToPro.totalMonthlyAmount, 345);
  assert.ok(pro.monthlyPriceUsd < startToPro.totalMonthlyAmount, "PRO deveria ser mais barato que START+extras para a mesma capacidade");

  const proToBusiness = computeCapacityCost(pro, addons, { users: 10, whatsappConnections: 5 });
  assert.equal(proToBusiness.totalMonthlyAmount, 731);
  assert.ok(business.monthlyPriceUsd < proToBusiness.totalMonthlyAmount, "BUSINESS deveria ser mais barato que PRO+extras para a mesma capacidade");

  const recommendation5x2 = recommendBestPlan([start, pro, business], addons, { users: 5, whatsappConnections: 2 });
  assert.equal(recommendation5x2.recommended.planCode, "PRO");

  const recommendation10x5 = recommendBestPlan([start, pro, business], addons, { users: 10, whatsappConnections: 5 });
  assert.equal(recommendation10x5.recommended.planCode, "BUSINESS");
});

test("Catalog validation: START -> PRO -> BUSINESS passa a validação de coerência (nunca pacote mais caro que a alternativa avulsa)", async () => {
  const deps = capacityDeps();
  const [start, pro, business, addons] = await Promise.all([
    deps.planVersionRepository.getActiveVersion("START"),
    deps.planVersionRepository.getActiveVersion("PRO"),
    deps.planVersionRepository.getActiveVersion("BUSINESS"),
    deps.addonDefinitionRepository.listActive(),
  ]);
  const result = validateCatalogCoherence([start, pro, business], addons);
  assert.equal(result.pass, true, JSON.stringify(result.violations));
});

// ---------------------------------------------------------------------------------------------
// Quantidade de addon soma corretamente + concorrência (seção 7-8)

test("purchaseAddon: segunda compra do MESMO addon soma quantidade, nunca cria um segundo item", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-addon-sum";
  await makeRealSubscriber(deps, tenantId, "PRO");

  await purchaseAddon(deps, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" });
  await purchaseAddon(deps, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" });

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
  assert.equal(items.length, 1, "nunca duas linhas para o mesmo addonCode");
  assert.equal(items[0].quantity, 2);
});

test("purchaseAddon: duas compras concorrentes do mesmo addon nunca se perdem uma na outra (incremento atômico)", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-race";
  await makeRealSubscriber(deps, tenantId, "PRO");

  await Promise.all([
    purchaseAddon(deps, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" }),
    purchaseAddon(deps, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" }),
  ]);

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 2, "duas compras concorrentes de +1 deveriam somar 2, nunca 1 (lost update)");
});

// ---------------------------------------------------------------------------------------------
// Preview nunca muda nada (seção 10-11)

test("previewCapacityChange: nunca cria SubscriptionItem nem muda a assinatura", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-preview";
  await makeRealSubscriber(deps, tenantId, "PRO");

  const preview = await previewCapacityChange(deps, { tenantId, users: 6, whatsappConnections: 2 });
  assert.equal(preview.requestedOnCurrentPlan.totalMonthlyAmount, 338);
  assert.equal(preview.recommendation.recommended.planCode, "PRO");

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
  assert.equal(items.length, 0, "preview nunca deveria criar nenhum item real");
});

// ---------------------------------------------------------------------------------------------
// Aumento imediato / redução agendada (seção 15/21-23)

test("applyCapacityChange: aumento de usuários é imediato (compra o addon na hora)", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-increase";
  await makeRealSubscriber(deps, tenantId, "PRO");

  const result = await applyCapacityChange(deps, { tenantId, users: 7 });
  const outcome = result.outcomes.find((o) => o.resource === "users");
  assert.equal(outcome.kind, "increased");
  assert.equal(outcome.toQuantity, 7);

  const state = await getCapacityState(deps, tenantId);
  assert.equal(state.current.totalUsers, 7);
});

test("applyCapacityChange: redução NUNCA é imediata — agenda pro fim do ciclo, scheduler aplica depois", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-decrease";
  const subscription = await makeRealSubscriber(deps, tenantId, "PRO");
  await deps.subscriptionRepository.update(subscription.id, { currentPeriodEnd: new Date(Date.now() - 1000).toISOString() });
  await applyCapacityChange(deps, { tenantId, users: 7 });

  const result = await applyCapacityChange(deps, { tenantId, users: 6 });
  const outcome = result.outcomes.find((o) => o.resource === "users");
  assert.equal(outcome.kind, "decrease_scheduled");

  // Ainda não aplicado — capacidade continua em 7 até o scheduler rodar.
  let state = await getCapacityState(deps, tenantId);
  assert.equal(state.current.totalUsers, 7, "redução não pode ser imediata");
  assert.equal(state.pending.length, 1);

  const schedulerResult = await applyDuePendingCapacityChanges(deps);
  assert.equal(schedulerResult.appliedCount, 1);

  state = await getCapacityState(deps, tenantId);
  assert.equal(state.current.totalUsers, 6, "depois do scheduler, a redução já deveria ter sido aplicada");
  assert.equal(state.pending.length, 0);
});

test("applyCapacityChange: cancelar uma redução pendente preserva a capacidade atual", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-cancel-pending";
  await makeRealSubscriber(deps, tenantId, "PRO");
  await applyCapacityChange(deps, { tenantId, users: 7 });
  await applyCapacityChange(deps, { tenantId, users: 6 });

  let state = await getCapacityState(deps, tenantId);
  assert.equal(state.pending.length, 1);

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const pendingList = await deps.subscriptionPendingChangeRepository.listPendingByTenant(tenantId);
  await cancelPendingCapacityChange(deps, { tenantId, pendingChangeId: pendingList[0].id });
  void subscription;

  state = await getCapacityState(deps, tenantId);
  assert.equal(state.pending.length, 0);
  assert.equal(state.current.totalUsers, 7, "cancelar a redução mantém a capacidade atual");
});

test("applyCapacityChange: reduzir abaixo do uso ativo é rejeitado, nunca desativa usuário/conexão sozinho", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-below-usage";
  await makeRealSubscriber(deps, tenantId, "PRO");
  await applyCapacityChange(deps, { tenantId, users: 8 });

  const userRepo = new PostgresUserRepository(db.pool);
  const membershipRepo = new PostgresTenantMembershipRepository(db.pool);
  for (let i = 0; i < 7; i += 1) {
    const user = await userRepo.create({ email: `capacity-usage-${i}@example.com`, name: `U${i}`, passwordHash: "x" });
    await membershipRepo.create({ userId: user.id, tenantId, role: "editor" });
  }
  // 7 memberships reais + a conta que já existia de makeRealSubscriber (nenhuma) = 7 em uso.

  await assert.rejects(
    () => applyCapacityChange(deps, { tenantId, users: 6 }),
    /CAPACITY_REDUCTION_BELOW_USAGE/,
  );

  const state = await getCapacityState(deps, tenantId);
  assert.equal(state.current.totalUsers, 8, "capacidade nunca muda quando a redução é rejeitada");
});

test("applyCapacityChange: não permite reduzir abaixo da capacidade incluída no plano (isso é downgrade de plano, não de addon)", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-below-plan-min";
  await makeRealSubscriber(deps, tenantId, "PRO");

  await assert.rejects(
    () => applyCapacityChange(deps, { tenantId, users: 3 }),
    /CAPACITY_BELOW_PLAN_MINIMUM/,
  );
});

// ---------------------------------------------------------------------------------------------
// Isolamento multi-tenant

test("Capacidade: isolamento cross-tenant — mudanças de um tenant nunca aparecem em outro", async () => {
  const deps = capacityDeps();
  const tenantA = "tenant-capacity-iso-a";
  const tenantB = "tenant-capacity-iso-b";
  await makeRealSubscriber(deps, tenantA, "PRO");
  await makeRealSubscriber(deps, tenantB, "PRO");

  await applyCapacityChange(deps, { tenantId: tenantA, users: 9 });

  const stateA = await getCapacityState(deps, tenantA);
  const stateB = await getCapacityState(deps, tenantB);
  assert.equal(stateA.current.totalUsers, 9);
  assert.equal(stateB.current.totalUsers, 5, "tenant B nunca deveria ver o addon comprado pelo tenant A");
});

// ---------------------------------------------------------------------------------------------
// Teste crítico (seção 44): preço público = preço de checkout — impede regressão do bug da auditoria

test("CRÍTICO: GET /v1/platform/plans devolve exatamente o preço/moeda da MESMA plan_version usada no checkout", async () => {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-pricing-capacity",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
  });
  const app = await buildApp({ config });

  const response = await app.inject({ method: "GET", url: "/v1/platform/plans" });
  assert.equal(response.statusCode, 200);
  const publicPlans = response.json().data.plans;
  const publicPro = publicPlans.find((plan) => plan.code === "PRO");
  assert.ok(publicPro, "PRO deveria aparecer no catálogo público");

  const deps = capacityDeps();
  const checkoutPlanVersion = await deps.planVersionRepository.getActiveVersion("PRO");

  assert.equal(publicPro.monthlyPriceUsd, checkoutPlanVersion.monthlyPriceUsd, "preço público precisa ser IDÊNTICO ao preço que o checkout usaria");
  assert.equal(publicPro.currency, checkoutPlanVersion.currency);
  assert.equal(publicPro.includedUsers, checkoutPlanVersion.limits.users);
  assert.equal(publicPro.includedWhatsappConnections, checkoutPlanVersion.limits.messaging_connections);
  assert.equal(publicPro.highlighted, true, "PRO é o plano recomendado (seção 25/33 do pedido)");

  await app.close();
});

test("CRÍTICO: FREE e ENTERPRISE nunca aparecem no catálogo público, mesmo lendo do banco agora", async () => {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-pricing-capacity-2",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
  });
  const app = await buildApp({ config });
  const response = await app.inject({ method: "GET", url: "/v1/platform/plans" });
  const codes = response.json().data.plans.map((plan) => plan.code);
  assert.deepEqual(codes.slice().sort(), ["BUSINESS", "PRO", "START"]);
  await app.close();
});

test("POST /v1/platform/plans/simulate: simulador público (sem auth) recomenda o mesmo plano que o cálculo interno", async () => {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-pricing-capacity-3",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
  });
  const app = await buildApp({ config });
  const response = await app.inject({ method: "POST", url: "/v1/platform/plans/simulate", payload: { users: 7, whatsappConnections: 3 } });
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.recommended.planCode, "PRO");
  assert.equal(body.recommended.totalMonthlyAmount, 456);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// resolveCommercialCapacity — nomenclatura pedida na seção 9/25

test("resolveCommercialCapacity: expõe includedUsers/additionalUsers/totalUsers e o equivalente para números, sem duplicar o vocabulário de limits", async () => {
  const deps = capacityDeps();
  const tenantId = "tenant-capacity-resolver-shape";
  const subscription = await makeRealSubscriber(deps, tenantId, "START");
  const planVersion = await deps.planVersionRepository.getById(subscription.planVersionId);
  const addons = await deps.addonDefinitionRepository.listActive();

  await purchaseAddon(deps, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" });
  await purchaseAddon(deps, { tenantId, addonCode: "extra_whatsapp_connection", quantity: 1, billingInterval: "monthly" });

  const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
  const snapshot = resolveCommercialCapacity(planVersion, addons, items);

  assert.equal(snapshot.includedUsers, 2);
  assert.equal(snapshot.additionalUsers, 1);
  assert.equal(snapshot.totalUsers, 3);
  assert.equal(snapshot.includedWhatsappConnections, 1);
  assert.equal(snapshot.additionalWhatsappConnections, 1);
  assert.equal(snapshot.totalWhatsappConnections, 2);
  assert.equal(snapshot.baseMonthlyAmount, 149);
  assert.equal(snapshot.addonsMonthlyAmount, 39 + 79);
  assert.equal(snapshot.totalMonthlyAmount, 149 + 39 + 79);
  assert.equal(snapshot.currency, "BRL");
});
