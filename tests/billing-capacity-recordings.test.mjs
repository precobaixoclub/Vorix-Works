import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresBillingEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { PostgresSubscriptionPendingChangeRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-pending-change-repository.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { applyCapacityChange, cancelPendingCapacityChange, getCapacityState, previewCapacityChange } from "../dist/application/billing/capacity-use-cases.js";
import { computeCapacityCost } from "../dist/domain/platform-billing/capacity.model.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Estrutura: usuários, números e gravações simultâneas (Meetings) — preço do Meetings no preview,
 * próxima cobrança visível, teste sem cartão não aumenta na hora, gate comercial respeitado e
 * redução agendada com id cancelável. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextTenant = (label) => `tenant-cap-${label}-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

function deps() {
  return {
    billingProvider: new SandboxBillingProvider(),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    addonDefinitionRepository: new PostgresAddonDefinitionRepository(db.pool),
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    subscriptionItemRepository: new PostgresSubscriptionItemRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    billingEventRepository: new PostgresBillingEventRepository(db.pool),
    subscriptionPendingChangeRepository: new PostgresSubscriptionPendingChangeRepository(db.pool),
    solutionEntitlementRepository: new PostgresSolutionEntitlementRepository(db.pool),
    resourceCounter: { count: async () => 1 },
  };
}

async function tenantWith({ providerSubscriptionId, status = "active", label }) {
  const tenantId = nextTenant(label);
  const d = deps();
  await d.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const start = await d.planVersionRepository.getActiveVersion("START");
  const subscription = await d.subscriptionRepository.create({ tenantId, planVersionId: start.id, status, billingProvider: "sandbox", providerCustomerId: providerSubscriptionId ? "cus_1" : undefined, providerSubscriptionId, billingInterval: "monthly" });
  await d.subscriptionRepository.update(subscription.id, { currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000).toISOString() });
  return { tenantId, d, start };
}

test("PREÇO: gravações simultâneas entram no custo (base R$147 com 1 + R$67 por adicional)", async () => {
  const d = deps();
  const start = await d.planVersionRepository.getActiveVersion("START");
  const addons = await d.addonDefinitionRepository.listActive();
  const none = computeCapacityCost(start, addons, { users: 2, whatsappConnections: 1 });
  const three = computeCapacityCost(start, addons, { users: 2, whatsappConnections: 1, concurrentRecordings: 3 });
  assert.equal(none.meetingsMonthlyAmount, 0);
  assert.equal(three.meetingsMonthlyAmount, 147 + 2 * 67);
  assert.equal(three.totalMonthlyAmount, none.totalMonthlyAmount + 281);
  assert.equal(three.concurrentRecordings, 3);
});

test("ESTADO: assinatura paga mostra a próxima cobrança; teste sem cartão não aumenta na hora", async () => {
  const paid = await tenantWith({ providerSubscriptionId: "sub_paid_1", label: "paid" });
  const state = await getCapacityState(paid.d, paid.tenantId);
  assert.equal(state.canChangeNow, true);
  assert.ok(state.nextCharge?.at);
  assert.equal(state.nextCharge.amount, state.current.totalMonthlyAmount);
  assert.equal(state.current.concurrentRecordings, 0);

  const trial = await tenantWith({ providerSubscriptionId: undefined, status: "trial", label: "trial" });
  const trialState = await getCapacityState(trial.d, trial.tenantId);
  assert.equal(trialState.canChangeNow, false);
  assert.equal(trialState.nextCharge, undefined);
});

test("APLICAR: Meetings público permite ampliar gravações; usuários sobem e a redução agendada tem id cancelável", async () => {
  const { d, tenantId } = await tenantWith({ providerSubscriptionId: "sub_paid_2", label: "apply" });
  const preview = await previewCapacityChange(d, { tenantId, users: 3, whatsappConnections: 1, concurrentRecordings: 2 });
  assert.equal(preview.requestedOnCurrentPlan.meetingsMonthlyAmount, 147 + 67);
  await applyCapacityChange(d, { tenantId, concurrentRecordings: 2 });assert.equal((await getCapacityState(d,tenantId)).current.concurrentRecordings,2);

  const state = await getCapacityState(d, tenantId);
  const users = (state.current.totalUsers ?? 0) + 2;
  const result = await applyCapacityChange(d, { tenantId, users });
  assert.equal(result.outcomes[0].kind, "increased");
  const reduced = await applyCapacityChange(d, { tenantId, users: users - 1 });
  assert.equal(reduced.outcomes[0].kind, "decrease_scheduled");
  const pending = (await getCapacityState(d, tenantId)).pending;
  assert.equal(pending.length, 1);
  assert.ok(pending[0].id, "pendência expõe o id (o cancelamento usa o id, não o código do adicional)");
  await cancelPendingCapacityChange(d, { tenantId, pendingChangeId: pending[0].id });
  assert.equal((await getCapacityState(d, tenantId)).pending.length, 0);
});

test("PLANO PERSONALIZADO: estado traz o preço de cada usuário/número/gravação; contatos, armazenamento e automações ilimitados", async () => {
  const { d, tenantId } = await tenantWith({ providerSubscriptionId: "sub_paid_units", label: "units" });
  const state = await getCapacityState(d, tenantId);
  assert.equal(state.unitPrices.interval, "monthly");
  assert.ok(state.unitPrices.user.amount > 0 && state.unitPrices.user.increment >= 1);
  assert.ok(state.unitPrices.whatsappConnection.amount > 0);
  assert.equal(state.unitPrices.meetingsBase, 147);
  assert.equal(state.unitPrices.meetingsExtraRecording, 67);

  const plans = await d.planVersionRepository.listActivePlans();
  for (const plan of plans) {
    assert.equal(plan.limits.contacts, null, `${plan.planCode}: contatos ilimitados`);
    assert.equal(plan.limits.storage_mb, null, `${plan.planCode}: armazenamento ilimitado`);
    assert.equal(plan.limits.automations, null, `${plan.planCode}: automações ilimitadas`);
  }
  const active = await d.addonDefinitionRepository.listActive();
  assert.equal(active.some((addon) => ["contacts", "storage_mb", "automations"].includes(addon.resource) || addon.code === "extra_ai_credits_1000"), false);
});
