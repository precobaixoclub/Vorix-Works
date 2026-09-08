import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresBillingEventRepository, PostgresInvoiceRepository, PostgresPaymentWebhookEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { startCheckout } from "../dist/application/billing/checkout-use-cases.js";
import { processBillingWebhook } from "../dist/application/billing/webhook-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * SaaS Commercialization — Fase 2 (Checkout). Foco: (1) `startCheckout` nunca cria/ativa uma
 * Subscription — só devolve uma URL; (2) o webhook confirmado é o ÚNICO lugar onde uma Subscription
 * real nasce (`checkout.session.completed`); (3) reentrega do MESMO evento nunca reaplica o efeito
 * colateral (idempotência via `payment_webhook_events`); (4) `tenant_billing` é recalculado a
 * partir da Subscription, nunca o contrário; (5) `customer.subscription.deleted`/
 * `invoice.payment_failed` nunca apagam dado nenhum, só mudam status.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;

before(async () => {
  db = await startTestPostgres({ port: 55708 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

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

function fakeWebhookBody(body) {
  return { rawBody: Buffer.from(JSON.stringify(body)), signatureHeader: undefined };
}

test("startCheckout: devolve URL de checkout e NUNCA cria uma Subscription", async () => {
  const deps = checkoutDeps();
  const platformBillingRepository = new PostgresPlatformBillingRepository(db.pool);
  await platformBillingRepository.ensureTenantBilling({ tenantId: "tenant-checkout-1", now: new Date().toISOString() });

  const result = await startCheckout(deps, {
    tenantId: "tenant-checkout-1",
    customerEmail: "cliente@example.com",
    planCode: "PRO",
    billingInterval: "monthly",
    successUrl: "https://app.vorix.test/sucesso",
    cancelUrl: "https://app.vorix.test/cancelado",
  });

  assert.ok(result.checkoutUrl.startsWith("https://app.vorix.test/sucesso"));
  assert.ok(result.providerSessionId.startsWith("sandbox-session-"));

  const subscription = await deps.subscriptionRepository.getActiveByTenant("tenant-checkout-1");
  assert.equal(subscription, undefined, "checkout não deve criar Subscription — só o webhook confirmado faz isso");
});

test("startCheckout: plano ENTERPRISE não é self-service", async () => {
  await assert.rejects(
    () => startCheckout(checkoutDeps(), {
      tenantId: "tenant-checkout-2", customerEmail: "a@b.com", planCode: "ENTERPRISE", billingInterval: "monthly",
      successUrl: "https://app.vorix.test/s", cancelUrl: "https://app.vorix.test/c",
    }),
    /CHECKOUT_PLAN_NOT_SELF_SERVICE/,
  );
});

test("startCheckout: tenant já com assinatura ativa não pode iniciar novo checkout", async () => {
  const deps = checkoutDeps();
  const tenantId = "tenant-checkout-3";
  const startVersion = await deps.planVersionRepository.getActiveVersion("START");
  await deps.subscriptionRepository.create({ tenantId, planVersionId: startVersion.id, status: "active", billingProvider: "sandbox", billingInterval: "monthly" });

  await assert.rejects(
    () => startCheckout(deps, {
      tenantId, customerEmail: "a@b.com", planCode: "PRO", billingInterval: "monthly",
      successUrl: "https://app.vorix.test/s", cancelUrl: "https://app.vorix.test/c",
    }),
    /CHECKOUT_ALREADY_SUBSCRIBED/,
  );
});

test("startCheckout: add-on fora do plano é rejeitado", async () => {
  await assert.rejects(
    () => startCheckout(checkoutDeps(), {
      tenantId: "tenant-checkout-4", customerEmail: "a@b.com", planCode: "FREE", billingInterval: "monthly",
      addonCodes: ["extra_user"], successUrl: "https://app.vorix.test/s", cancelUrl: "https://app.vorix.test/c",
    }),
    /CHECKOUT_ADDON_NOT_ALLOWED/,
  );
});

test("webhook checkout.session.completed: cria a Subscription real e recalcula tenant_billing a partir dela", async () => {
  const deps = webhookDeps();
  const tenantId = "tenant-webhook-1";
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");

  const result = await processBillingWebhook(deps, fakeWebhookBody({
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: { id: "cs_test_1", customer: "cus_1", subscription: "sub_1", metadata: { tenantId, planVersionId: proVersion.id, billingInterval: "monthly" } },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "processed");

  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  assert.ok(subscription, "Subscription real deveria existir após o webhook");
  assert.equal(subscription.status, "active");
  assert.equal(subscription.planVersionId, proVersion.id);
  assert.equal(subscription.providerSubscriptionId, "sub_1");

  const billing = await deps.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.planCode, "PRO", "tenant_billing.plan_code deveria refletir a Subscription real");
  assert.equal(billing.subscriptionStatus, "active");

  const events = await deps.billingEventRepository.listByTenant(tenantId);
  assert.ok(events.some((e) => e.eventType === "subscription_created"));
});

test("webhook: reentrega do MESMO evento nunca reaplica o efeito colateral (idempotência)", async () => {
  const deps = webhookDeps();
  const tenantId = "tenant-webhook-2";
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const startVersion = await deps.planVersionRepository.getActiveVersion("START");
  const payload = fakeWebhookBody({
    id: "evt_checkout_dup",
    type: "checkout.session.completed",
    data: { id: "cs_dup", customer: "cus_dup", subscription: "sub_dup", metadata: { tenantId, planVersionId: startVersion.id, billingInterval: "monthly" } },
  });

  const first = await processBillingWebhook(deps, payload);
  assert.equal(first.outcome, "processed");
  const second = await processBillingWebhook(deps, payload);
  assert.equal(second.outcome, "duplicate_ignored");

  const events = await deps.billingEventRepository.listByTenant(tenantId);
  assert.equal(events.filter((e) => e.eventType === "subscription_created").length, 1, "reentrega não deveria duplicar o BillingEvent");
});

test("webhook: tipo de evento desconhecido é ignorado sem erro", async () => {
  const result = await processBillingWebhook(webhookDeps(), fakeWebhookBody({ id: "evt_unknown_1", type: "customer.updated", data: {} }));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "event_type_ignored");
});

test("webhook customer.subscription.deleted: cancela SEM apagar nada, e uma reentrega não regride o estado", async () => {
  const deps = webhookDeps();
  const tenantId = "tenant-webhook-3";
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");
  await processBillingWebhook(deps, fakeWebhookBody({
    id: "evt_checkout_3", type: "checkout.session.completed",
    data: { id: "cs_3", customer: "cus_3", subscription: "sub_3", metadata: { tenantId, planVersionId: proVersion.id, billingInterval: "monthly" } },
  }));

  const deleted = await processBillingWebhook(deps, fakeWebhookBody({
    id: "evt_deleted_1", type: "customer.subscription.deleted", data: { id: "sub_3", customer: "cus_3", status: "canceled" },
  }));
  assert.equal(deleted.outcome, "processed");

  const subscription = await deps.subscriptionRepository.getByProviderSubscriptionId("sub_3");
  assert.equal(subscription.status, "cancelled");
  assert.ok(subscription.canceledAt);

  const billing = await deps.platformBillingRepository.getTenantBilling(tenantId);
  // Cancelamento definitivo (customer.subscription.deleted) nunca apaga NENHUM dado do tenant
  // (contatos/negócios/etc. continuam intactos) — só reverte os entitlements pro FREE, senão o
  // tenant ficaria com acesso ao plano pago pra sempre depois de cancelar.
  assert.equal(billing.planCode, "FREE");
  assert.equal(billing.subscriptionStatus, "active");
});

test("webhook invoice.payment_failed: marca past_due e registra a fatura, sem apagar nada", async () => {
  const deps = webhookDeps();
  const tenantId = "tenant-webhook-4";
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const proVersion = await deps.planVersionRepository.getActiveVersion("PRO");
  await processBillingWebhook(deps, fakeWebhookBody({
    id: "evt_checkout_4", type: "checkout.session.completed",
    data: { id: "cs_4", customer: "cus_4", subscription: "sub_4", metadata: { tenantId, planVersionId: proVersion.id, billingInterval: "monthly" } },
  }));

  const failed = await processBillingWebhook(deps, fakeWebhookBody({
    id: "evt_invoice_failed_1", type: "invoice.payment_failed",
    data: { id: "in_1", customer: "cus_4", subscription: "sub_4", amount_due: 8900, currency: "usd" },
  }));
  assert.equal(failed.outcome, "processed");

  const subscription = await deps.subscriptionRepository.getByProviderSubscriptionId("sub_4");
  assert.equal(subscription.status, "past_due");

  const billing = await deps.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.subscriptionStatus, "past_due");
  assert.equal(billing.planCode, "PRO", "past_due nunca troca/remove o plano contratado");

  const invoices = await deps.invoiceRepository.listByTenant(tenantId);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].status, "open");
  assert.equal(invoices[0].amountCents, 8900);
});
