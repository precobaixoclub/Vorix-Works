import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresUsageCounterRepository } from "../dist/infrastructure/storage/postgres/postgres-usage-counter-repository.js";
import { PostgresBillingEventRepository, PostgresPaymentWebhookEventRepository, PostgresInvoiceRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { DefaultResourceCounterAdapter } from "../dist/infrastructure/billing/resource-counter-adapter.js";
import { startTrial, expireTrials } from "../dist/application/billing/trial-use-cases.js";
import { startCheckout } from "../dist/application/billing/checkout-use-cases.js";
import { processBillingWebhook } from "../dist/application/billing/webhook-use-cases.js";
import { resolveEffectiveEntitlements, assertCanUse, assertWithinLimit } from "../dist/application/billing/entitlement-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Trial + Product Analytics — Fatia A/B (Trial foundation + lifecycle). Foco: (1) trial cria uma
 * Subscription REAL, passa pelo mesmo Entitlement Service, respeita PlanVersion.trialDays (nunca
 * hardcoded); (2) idempotência (chamar start-trial duas vezes nunca duplica); (3) TRIAL_ENABLED
 * independente de trialDays; (4) expiração transiciona pra trial_expired sem apagar nada, e o
 * modo somente-leitura já existente passa a se aplicar automaticamente; (5) conversão trial→pago
 * reusa a MESMA Subscription e emite trial_converted (não subscription_created), idempotente sob
 * reentrega de webhook.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;

before(async () => {
  db = await startTestPostgres({ port: 55980 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function trialDeps({ trialEnabled = true } = {}) {
  return {
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    billingEventRepository: new PostgresBillingEventRepository(db.pool),
    trialEnabled,
  };
}

function entitlementDeps() {
  return {
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

function checkoutDeps() {
  return {
    billingProvider: new SandboxBillingProvider(),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    addonDefinitionRepository: new PostgresAddonDefinitionRepository(db.pool),
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
  };
}

function webhookDeps() {
  return {
    billingProvider: new SandboxBillingProvider(),
    paymentWebhookEventRepository: new PostgresPaymentWebhookEventRepository(db.pool),
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    billingEventRepository: new PostgresBillingEventRepository(db.pool),
    invoiceRepository: new PostgresInvoiceRepository(db.pool),
  };
}

async function ensureTenant(tenantId) {
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
}

test("startTrial: cria uma Subscription real em status trial, com trialStart/trialEnd calculados a partir de PlanVersion.trialDays (14 do PRO), nunca hardcoded", async () => {
  const deps = trialDeps();
  const tenantId = "tenant-trial-1";
  await ensureTenant(tenantId);

  const before = Date.now();
  const subscription = await startTrial(deps, { tenantId, planCode: "PRO" });
  assert.equal(subscription.status, "trial");
  assert.equal(subscription.billingProvider, "none");
  assert.ok(subscription.trialStart);
  assert.ok(subscription.trialEnd);

  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");
  const expectedTrialMs = proVersion.trialDays * 24 * 60 * 60 * 1000;
  const actualTrialMs = new Date(subscription.trialEnd).getTime() - new Date(subscription.trialStart).getTime();
  assert.ok(Math.abs(actualTrialMs - expectedTrialMs) < 5000, `duração do trial deveria ser ${proVersion.trialDays} dias (do PlanVersion), não um valor fixo`);
  assert.ok(new Date(subscription.trialStart).getTime() >= before);

  const billing = await deps.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.planCode, "PRO");
  assert.equal(billing.subscriptionStatus, "trial");

  const events = await deps.billingEventRepository.listByTenant(tenantId);
  assert.ok(events.some((e) => e.eventType === "trial_started"));
});

test("startTrial: idempotente — chamar duas vezes devolve a MESMA Subscription, nunca cria duas", async () => {
  const deps = trialDeps();
  const tenantId = "tenant-trial-2";
  await ensureTenant(tenantId);

  const first = await startTrial(deps, { tenantId, planCode: "START" });
  const second = await startTrial(deps, { tenantId, planCode: "START" });
  assert.equal(second.id, first.id);

  const count = await db.pool.query("select count(*)::int as c from subscriptions where tenant_id = $1", [tenantId]);
  assert.equal(count.rows[0].c, 1);
});

test("startTrial: rejeita quando já existe assinatura real ativa (paga)", async () => {
  const deps = trialDeps();
  const tenantId = "tenant-trial-3";
  await ensureTenant(tenantId);
  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");
  await deps.subscriptionRepository.create({ tenantId, planVersionId: proVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly" });

  await assert.rejects(() => startTrial(deps, { tenantId, planCode: "START" }), /TRIAL_ALREADY_HAS_SUBSCRIPTION/);
});

test("startTrial: FREE não oferece trial (trialDays null) — rejeita com mensagem clara, nunca hardcoded 'plano X'", async () => {
  const deps = trialDeps();
  const tenantId = "tenant-trial-4";
  await ensureTenant(tenantId);
  await assert.rejects(() => startTrial(deps, { tenantId, planCode: "FREE" }), /TRIAL_NOT_AVAILABLE_FOR_PLAN/);
});

test("startTrial: TRIAL_ENABLED é um kill switch independente de PlanVersion.trialDays", async () => {
  const deps = trialDeps({ trialEnabled: false });
  const tenantId = "tenant-trial-5";
  await ensureTenant(tenantId);
  // PRO TEM trialDays configurado — mesmo assim, a flag global bloqueia.
  await assert.rejects(() => startTrial(deps, { tenantId, planCode: "PRO" }), /TRIAL_DISABLED/);
});

test("Entitlements durante trial: usa os limites do PlanVersion normalmente, sem regra paralela — nunca readOnly enquanto o trial está ativo", async () => {
  const deps = trialDeps();
  const eDeps = entitlementDeps();
  const tenantId = "tenant-trial-6";
  await ensureTenant(tenantId);
  await startTrial(deps, { tenantId, planCode: "PRO" });

  const entitlements = await resolveEffectiveEntitlements(eDeps, tenantId);
  assert.equal(entitlements.virtual, false);
  assert.equal(entitlements.planCode, "PRO");
  assert.equal(entitlements.readOnly, false);
  assert.equal(entitlements.limits.users, 8, "mesmos limites do PlanVersion PRO — nada especial pra trial");

  await assertCanUse(eDeps, { tenantId, capability: "automation" });
  await assertWithinLimit(eDeps, { tenantId, resource: "contacts" });
});

test("expireTrials: transiciona trial vencido pra trial_expired sem apagar nada, e o modo somente-leitura JÁ EXISTENTE passa a se aplicar (nenhuma regra nova em entitlements)", async () => {
  const deps = trialDeps();
  const eDeps = entitlementDeps();
  const tenantId = "tenant-trial-7";
  await ensureTenant(tenantId);
  const subscription = await startTrial(deps, { tenantId, planCode: "PRO" });
  // Força o trial a já ter vencido (sem esperar 14 dias de verdade).
  await deps.subscriptionRepository.update(subscription.id, { trialEnd: new Date(Date.now() - 1000).toISOString() });

  const result = await expireTrials(deps);
  assert.equal(result.expiredCount, 1);
  assert.deepEqual(result.failedTenantIds, []);

  const updated = await deps.subscriptionRepository.getById(subscription.id);
  assert.equal(updated.status, "trial_expired");

  const billing = await deps.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.subscriptionStatus, "trial_expired");
  assert.equal(billing.planCode, "PRO", "plano continua visível — trial vencido nunca apaga o que o tenant estava usando");

  const entitlements = await resolveEffectiveEntitlements(eDeps, tenantId);
  assert.equal(entitlements.readOnly, true);
  assert.equal(entitlements.planCode, "PRO", "dados/plano continuam visíveis, só bloqueia ação nova");
  await assert.rejects(() => assertWithinLimit(eDeps, { tenantId, resource: "contacts" }), /ENTITLEMENT_ACCOUNT_READ_ONLY/);

  const events = await deps.billingEventRepository.listByTenant(tenantId);
  assert.ok(events.some((e) => e.eventType === "trial_expired"));

  // Idempotente/isolado: rodar de novo não re-expira o mesmo (já não está mais em status 'trial').
  const secondRun = await expireTrials(deps);
  assert.equal(secondRun.expiredCount, 0);
});

test("Conversão trial -> pago: startCheckout é permitido pra quem está em trial (não bloqueia como 'já assinado'), e o webhook confirmado reusa a MESMA Subscription emitindo trial_converted", async () => {
  const trialD = trialDeps();
  const tenantId = "tenant-trial-8";
  await ensureTenant(tenantId);
  const trialSubscription = await startTrial(trialD, { tenantId, planCode: "START" });

  const cDeps = checkoutDeps();
  const checkout = await startCheckout(cDeps, {
    tenantId, customerEmail: "a@b.com", planCode: "PRO", billingInterval: "monthly",
    successUrl: "https://app.vorix.test/s", cancelUrl: "https://app.vorix.test/c",
  });
  assert.ok(checkout.checkoutUrl);

  const wDeps = webhookDeps();
  const proVersion = await wDeps.planVersionRepository.getActiveVersion("PRO");
  const payload = {
    rawBody: Buffer.from(JSON.stringify({
      id: "evt_trial_conversion_1", type: "checkout.session.completed",
      data: { id: "cs_conv_1", customer: "cus_conv_1", subscription: "sub_conv_1", metadata: { tenantId, planVersionId: proVersion.id, billingInterval: "monthly" } },
    })),
    signatureHeader: undefined,
  };

  const first = await processBillingWebhook(wDeps, payload);
  assert.equal(first.outcome, "processed");

  const subscription = await wDeps.subscriptionRepository.getActiveByTenant(tenantId);
  assert.equal(subscription.id, trialSubscription.id, "conversão reusa a MESMA Subscription — nunca cria uma segunda linha");
  assert.equal(subscription.status, "active");
  assert.equal(subscription.planVersionId, proVersion.id);

  const events = await wDeps.billingEventRepository.listByTenant(tenantId);
  assert.equal(events.filter((e) => e.eventType === "trial_converted").length, 1);
  assert.equal(events.filter((e) => e.eventType === "subscription_created").length, 0, "conversão de trial nunca deveria contar como subscription_created");

  // Reentrega do MESMO evento (retry de webhook) nunca duplica o trial_converted.
  const second = await processBillingWebhook(wDeps, payload);
  assert.equal(second.outcome, "duplicate_ignored");
  const eventsAfterRetry = await wDeps.billingEventRepository.listByTenant(tenantId);
  assert.equal(eventsAfterRetry.filter((e) => e.eventType === "trial_converted").length, 1);
});

test("Conversão trial -> pago: um trial JÁ VENCIDO (trial_expired) também pode ir a checkout normalmente", async () => {
  const trialD = trialDeps();
  const tenantId = "tenant-trial-9";
  await ensureTenant(tenantId);
  const subscription = await startTrial(trialD, { tenantId, planCode: "START" });
  await trialD.subscriptionRepository.update(subscription.id, { status: "trial_expired" });

  const cDeps = checkoutDeps();
  const checkout = await startCheckout(cDeps, {
    tenantId, customerEmail: "a@b.com", planCode: "START", billingInterval: "monthly",
    successUrl: "https://app.vorix.test/s", cancelUrl: "https://app.vorix.test/c",
  });
  assert.ok(checkout.checkoutUrl);
});

test("startCheckout: tenant já PAGO (active) continua bloqueado de ir a um novo checkout (regressão)", async () => {
  const deps = checkoutDeps();
  const tenantId = "tenant-trial-10";
  const startVersion = await deps.planVersionRepository.getActiveVersion("START");
  await deps.subscriptionRepository.create({ tenantId, planVersionId: startVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly" });

  await assert.rejects(
    () => startCheckout(deps, { tenantId, customerEmail: "a@b.com", planCode: "PRO", billingInterval: "monthly", successUrl: "https://app.vorix.test/s", cancelUrl: "https://app.vorix.test/c" }),
    /CHECKOUT_ALREADY_SUBSCRIBED/,
  );
});
