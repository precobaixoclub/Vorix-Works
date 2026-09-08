import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresUsageCounterRepository } from "../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js";
import { PostgresBillingEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { DefaultResourceCounterAdapter } from "../dist/infrastructure/billing/resource-counter-adapter.js";
import {
  cancelSubscriptionSelfService,
  changePlan,
  detectDowngradeOverage,
  purchaseAddon,
  reactivateSubscription,
  removeAddon,
} from "../dist/application/billing/lifecycle-use-cases.js";
import { assertCanUse, assertWithinLimit, resolveEffectiveEntitlements } from "../dist/application/billing/entitlement-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * SaaS Commercialization — Fase 3 (Subscription Lifecycle). Foco: (1) upgrade/downgrade trocam o
 * `planVersionId` só depois da confirmação síncrona do gateway; (2) downgrade com uso acima do
 * novo teto é BLOQUEADO antes de qualquer chamada ao gateway (nunca perde dado sem aviso); (3)
 * add-ons somam/removem sobre os limites; (4) cancelamento é sempre `cancel_at_period_end`, nunca
 * imediato; (5) reativação só funciona antes do fim do período; (6) conta `past_due` fica em modo
 * somente-leitura (nunca apaga nada, só bloqueia ações novas).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;

before(async () => {
  db = await startTestPostgres({ port: 55710 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function lifecycleDeps() {
  return {
    billingProvider: new SandboxBillingProvider(),
    billingEventRepository: new PostgresBillingEventRepository(db.pool),
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    subscriptionItemRepository: new PostgresSubscriptionItemRepository(db.pool),
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
    billingInterval: "monthly", providerCustomerId: "cus_x", providerSubscriptionId: `sub-${tenantId}`,
  });
}

test("changePlan: upgrade START -> PRO troca o planVersionId e recalcula tenant_billing", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-1";
  await makeRealSubscriber(deps, tenantId, "START");

  await changePlan(deps, { tenantId, newPlanCode: "PRO", billingInterval: "monthly" });

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");
  assert.equal(subscription.planVersionId, proVersion.id);

  const billing = await deps.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.planCode, "PRO");

  const entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  assert.equal(entitlements.limits.users, 8, "deveria já enxergar os limites do PRO");
});

test("changePlan: downgrade bloqueado quando o uso atual excede o novo teto (nenhuma chamada ao gateway, nenhum dado apagado)", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-2";
  await makeRealSubscriber(deps, tenantId, "PRO");
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool);
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });

  // START permite só 3 usuários; PRO permite 8 — cria 5 memberships reais pra estourar o teto do START.
  const userRepo = new PostgresUserRepository(db.pool);
  const membershipRepo = new PostgresTenantMembershipRepository(db.pool);
  for (let i = 0; i < 5; i++) {
    const user = await userRepo.create({ email: `overage-${i}@example.com`, name: `U${i}`, passwordHash: "x" });
    await membershipRepo.create({ userId: user.id, tenantId, role: "editor" });
  }
  void workspace;

  const overages = await detectDowngradeOverage(deps, { tenantId, newPlanCode: "START" });
  assert.ok(overages.some((o) => o.resource === "users"));

  await assert.rejects(() => changePlan(deps, { tenantId, newPlanCode: "START", billingInterval: "monthly" }), /CHANGE_PLAN_DOWNGRADE_OVERAGE/);

  // Continua no PRO — o downgrade bloqueado nunca troca nada, nem parcialmente.
  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");
  assert.equal(subscription.planVersionId, proVersion.id);
});

test("addons: comprar soma sobre o limite base; remover volta ao limite original", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-3";
  await makeRealSubscriber(deps, tenantId, "START");

  await purchaseAddon(deps, { tenantId, addonCode: "extra_user", quantity: 2, billingInterval: "monthly" });
  let entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  assert.equal(entitlements.limits.users, 5, "3 do START + 2 do addon");

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  const items = await deps.subscriptionItemRepository.listBySubscription(subscription.id);
  assert.equal(items.length, 1);
  assert.ok(items[0].providerItemId?.startsWith("sandbox-item-"));

  await removeAddon(deps, { tenantId, subscriptionItemId: items[0].id });
  entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  assert.equal(entitlements.limits.users, 3, "removido o addon, volta ao limite base do plano");
});

test("addons: add-on fora da lista permitida do plano é rejeitado", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-4";
  await makeRealSubscriber(deps, tenantId, "FREE");
  await assert.rejects(() => purchaseAddon(deps, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" }), /ADDON_NOT_ALLOWED/);
});

test("cancelSubscriptionSelfService: sempre cancel_at_period_end, nunca cancelamento imediato", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-5";
  await makeRealSubscriber(deps, tenantId, "PRO");

  await cancelSubscriptionSelfService(deps, { tenantId, reason: "muito caro" });

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  assert.equal(subscription.cancelAtPeriodEnd, true);
  assert.equal(subscription.status, "active", "continua ativo até o fim do período já pago");
  assert.equal(subscription.cancellationReason, "muito caro");
});

test("reactivateSubscription: desfaz o cancel_at_period_end enquanto a assinatura ainda não terminou", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-6";
  await makeRealSubscriber(deps, tenantId, "PRO");
  await cancelSubscriptionSelfService(deps, { tenantId });

  await reactivateSubscription(deps, { tenantId });

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  assert.equal(subscription.cancelAtPeriodEnd, false);
  assert.equal(subscription.cancellationReason, undefined);
});

test("reactivateSubscription: rejeita quando a assinatura não está agendada para cancelamento", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-7";
  await makeRealSubscriber(deps, tenantId, "PRO");
  await assert.rejects(() => reactivateSubscription(deps, { tenantId }), /REACTIVATE_NOT_CANCELED/);
});

test("modo somente-leitura: assinatura past_due bloqueia assertCanUse/assertWithinLimit, mas nunca apaga nem esconde o estado real", async () => {
  const deps = lifecycleDeps();
  const tenantId = "tenant-lifecycle-8";
  const subscription = await makeRealSubscriber(deps, tenantId, "PRO");
  await deps.subscriptionRepository.update(subscription.id, { status: "past_due" });

  const entitlements = await resolveEffectiveEntitlements(deps, tenantId);
  assert.equal(entitlements.readOnly, true);
  assert.equal(entitlements.planCode, "PRO", "o plano continua visível — nada foi apagado/ocultado");

  await assert.rejects(() => assertCanUse(deps, { tenantId, capability: "crm" }), /ENTITLEMENT_ACCOUNT_READ_ONLY/);
  await assert.rejects(() => assertWithinLimit(deps, { tenantId, resource: "contacts" }), /ENTITLEMENT_ACCOUNT_READ_ONLY/);
});
