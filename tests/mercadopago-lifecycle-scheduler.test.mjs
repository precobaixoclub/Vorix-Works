import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresSubscriptionPendingChangeRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-pending-change-repository.js";
import { PostgresUsageCounterRepository } from "../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js";
import { PostgresBillingEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { DefaultResourceCounterAdapter } from "../dist/infrastructure/billing/resource-counter-adapter.js";
import { cancelSubscriptionSelfService, reactivateSubscription, purchaseAddon } from "../dist/application/billing/lifecycle-use-cases.js";
import { applyCapacityChange, applyDuePendingCapacityChanges } from "../dist/application/billing/capacity-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Pricing/Capacity Etapa C (Mercado Pago) — comportamento de `supportsNativeScheduledCancellation:
 * false` nos casos de uso (nunca no provider real, pra não depender de credenciais de Mercado Pago
 * reais neste teste — ver `mercadopago-billing-provider.test.mjs` para o adapter isolado). Um fake
 * provider mínimo com a MESMA capability flag do `MercadoPagoBillingProvider` real é suficiente pra
 * provar que `cancelSubscriptionSelfService`/`reactivateSubscription`/o scheduler de capacidade
 * reaproveitam `subscription_pending_changes` corretamente (seção 16-19 do pedido), sem duplicar
 * cobertura de HTTP/HMAC que já está no outro arquivo.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55997 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function fakeNonNativeProvider() {
  const calls = [];
  return {
    providerId: "mercadopago",
    supportsNativeScheduledCancellation: false,
    calls,
    async createCheckout() { throw new Error("not used"); },
    async createSubscription() { throw new Error("not used"); },
    async changeSubscription(input) { calls.push({ method: "changeSubscription", input }); return { ok: true, status: "authorized" }; },
    async cancelSubscription(input) { calls.push({ method: "cancelSubscription", input }); return { ok: true }; },
    async resumeSubscription(input) { calls.push({ method: "resumeSubscription", input }); return { ok: true }; },
    async addSubscriptionItem(input) { calls.push({ method: "addSubscriptionItem", input }); return { ok: true, providerItemId: `item-${calls.length}` }; },
    async removeSubscriptionItem(input) { calls.push({ method: "removeSubscriptionItem", input }); return { ok: true }; },
    async updateSubscriptionItemQuantity(input) { calls.push({ method: "updateSubscriptionItemQuantity", input }); return { ok: true }; },
    async getPaymentMethod() { return { ok: true, paymentMethod: undefined }; },
    async createCustomerPortal() { return { ok: false, kind: "not_configured", message: "sem portal" }; },
    async handleWebhook() { throw new Error("not used"); },
  };
}

function deps(provider) {
  return {
    billingProvider: provider,
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

async function makeRealSubscriber(deps, tenantId, planCode, currentPeriodEnd) {
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const planVersion = await deps.planVersionRepository.getActiveVersion(planCode);
  return deps.subscriptionRepository.create({
    tenantId, planVersionId: planVersion.id, status: "active", billingProvider: "mercadopago",
    billingInterval: "monthly", providerCustomerId: `cus-${tenantId}`, providerSubscriptionId: `preapproval-${tenantId}`,
    currentPeriodEnd,
  });
}

test("cancelSubscriptionSelfService (provider sem cancelamento nativo): agenda via subscription_pending_changes, nunca chama cancelSubscription na hora", async () => {
  const provider = fakeNonNativeProvider();
  const d = deps(provider);
  const tenantId = nextId("tenant");
  const periodEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  await makeRealSubscriber(d, tenantId, "PRO", periodEnd);

  await cancelSubscriptionSelfService(d, { tenantId, reason: "teste" });

  assert.equal(provider.calls.filter((c) => c.method === "cancelSubscription").length, 0);
  const subscription = await d.subscriptionRepository.getActiveByTenant(tenantId);
  assert.equal(subscription.cancelAtPeriodEnd, true);
  assert.equal(subscription.status, "active");

  const pending = (await d.subscriptionPendingChangeRepository.listPendingByTenant(tenantId)).find((c) => c.changeType === "cancellation");
  assert.ok(pending, "deveria existir uma pendência de cancelamento");
  assert.equal(pending.effectiveAt, periodEnd);
});

test("reactivateSubscription ANTES do vencimento: cancela a pendência, nunca chama resumeSubscription no provider (nada foi cancelado lá ainda)", async () => {
  const provider = fakeNonNativeProvider();
  const d = deps(provider);
  const tenantId = nextId("tenant");
  const periodEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  await makeRealSubscriber(d, tenantId, "PRO", periodEnd);
  await cancelSubscriptionSelfService(d, { tenantId });

  await reactivateSubscription(d, { tenantId });

  assert.equal(provider.calls.filter((c) => c.method === "resumeSubscription").length, 0);
  const subscription = await d.subscriptionRepository.getActiveByTenant(tenantId);
  assert.equal(subscription.cancelAtPeriodEnd, false);
  const pending = (await d.subscriptionPendingChangeRepository.listPendingByTenant(tenantId)).find((c) => c.changeType === "cancellation");
  assert.equal(pending, undefined, "a pendência precisa ter sido cancelada, não deve mais aparecer como pendente");
});

test("scheduler (applyDuePendingCapacityChanges): cancelamento vencido chama cancelSubscription(atPeriodEnd:false) no provider, marca Subscription cancelled e reverte tenant_billing pro FREE", async () => {
  const provider = fakeNonNativeProvider();
  const d = deps(provider);
  const tenantId = nextId("tenant");
  const pastPeriodEnd = new Date(Date.now() - 1000).toISOString();
  const subscription = await makeRealSubscriber(d, tenantId, "PRO", pastPeriodEnd);
  await d.subscriptionPendingChangeRepository.create({ subscriptionId: subscription.id, tenantId, changeType: "cancellation", effectiveAt: pastPeriodEnd });

  const result = await applyDuePendingCapacityChanges(d);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.failedIds.length, 0);

  const cancelCalls = provider.calls.filter((c) => c.method === "cancelSubscription");
  assert.equal(cancelCalls.length, 1);
  assert.equal(cancelCalls[0].input.atPeriodEnd, false);
  assert.equal(cancelCalls[0].input.providerSubscriptionId, subscription.providerSubscriptionId);

  const updated = await d.subscriptionRepository.getById(subscription.id);
  assert.equal(updated.status, "cancelled");
  assert.equal(await d.subscriptionRepository.getActiveByTenant(tenantId), undefined);

  const billing = await d.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.planCode, "FREE");
});

test("reactivateSubscription DEPOIS do cancelamento efetivo: nunca finge reutilizar a subscription, exige checkout novo", async () => {
  const provider = fakeNonNativeProvider();
  const d = deps(provider);
  const tenantId = nextId("tenant");
  const pastPeriodEnd = new Date(Date.now() - 1000).toISOString();
  const subscription = await makeRealSubscriber(d, tenantId, "PRO", pastPeriodEnd);
  await d.subscriptionPendingChangeRepository.create({ subscriptionId: subscription.id, tenantId, changeType: "cancellation", effectiveAt: pastPeriodEnd });
  await applyDuePendingCapacityChanges(d);

  await assert.rejects(() => reactivateSubscription(d, { tenantId }), /SUBSCRIPTION_NOT_FOUND/);
});

test("purchaseAddon (provider sem catálogo nativo): amount/currency do total projetado são calculados via capacity.model.ts e passados ao provider", async () => {
  const provider = fakeNonNativeProvider();
  const d = deps(provider);
  const tenantId = nextId("tenant");
  await makeRealSubscriber(d, tenantId, "PRO", new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString());

  await purchaseAddon(d, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" });

  const added = provider.calls.find((c) => c.method === "addSubscriptionItem");
  assert.ok(added, "deveria ter chamado addSubscriptionItem (primeira compra deste addon)");
  assert.equal(added.input.amount, 338); // PRO (299) + 1 extra_user (39)
  assert.equal(added.input.currency, "BRL");

  await purchaseAddon(d, { tenantId, addonCode: "extra_user", quantity: 1, billingInterval: "monthly" });
  const updated = provider.calls.find((c) => c.method === "updateSubscriptionItemQuantity");
  assert.ok(updated, "segunda compra do MESMO addon deveria incrementar, não criar um segundo item");
  assert.equal(updated.input.amount, 377); // PRO (299) + 2 extra_user (78)
});

test("applyCapacityChange: redução agendada, ao ser aplicada pelo scheduler, também passa amount/currency recalculado ao provider", async () => {
  const provider = fakeNonNativeProvider();
  const d = deps(provider);
  const tenantId = nextId("tenant");
  await makeRealSubscriber(d, tenantId, "PRO", new Date(Date.now() - 1000).toISOString());
  await purchaseAddon(d, { tenantId, addonCode: "extra_user", quantity: 2, billingInterval: "monthly" });

  const changeResult = await applyCapacityChange(d, { tenantId, users: 6 }); // PRO inclui 5 + já tem 2 extras = 7 -> reduz pra 6 (1 extra)
  assert.equal(changeResult.outcomes[0].kind, "decrease_scheduled");

  const result = await applyDuePendingCapacityChanges(d);
  assert.equal(result.appliedCount, 1);

  const updateCall = provider.calls.filter((c) => c.method === "updateSubscriptionItemQuantity").at(-1);
  assert.ok(updateCall);
  assert.equal(updateCall.input.amount, 338); // PRO (299) + 1 extra_user (39) restante
  assert.equal(updateCall.input.currency, "BRL");
});
