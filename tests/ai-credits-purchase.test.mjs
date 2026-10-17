import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresBillingEventRepository, PostgresInvoiceRepository, PostgresPaymentWebhookEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { PostgresAiCreditPurchaseRepository } from "../dist/infrastructure/storage/postgres/postgres-ai-credit-purchase-repository.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { getAiCreditsOverview, purchaseAiCredits } from "../dist/application/billing/ai-credits-use-cases.js";
import { processBillingWebhook, syncTenantBilling } from "../dist/application/billing/webhook-use-cases.js";
import { expireTrials, startTrial } from "../dist/application/billing/trial-use-cases.js";
import { CreditAccountingService } from "../dist/application/ai-providers/credit-accounting.service.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Créditos de IA: recarga com quantidade livre (cartão salvo ou checkout), crédito lançado uma
 * única vez, teste gratuito só com créditos de teste e conta com teste vencido sem IA. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextTenant = (label) => `tenant-credits-${label}-${++counter}`;
const pricing = { unitPriceCents: 10, currency: "BRL", minPurchase: 100, maxPurchase: 100_000 };

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

/** Gateway sem cobrança direta (como o Mercado Pago): sempre checkout. */
class CheckoutOnlyProvider extends SandboxBillingProvider {
  providerId = "checkout-only";
  supportsOffSessionCharge = false;
  checkouts = [];
  async createOneTimeCheckout(input) { this.checkouts.push(input); return { ok: true, checkoutUrl: "https://pay.test/c/1", providerSessionId: "pref_1" }; }
}

test("CHECKOUT: retorno permanece no produto, inclusive com barras, controles e URLs externas", async () => {
  const tenantId = await paidTenant("safe-return");
  const provider = new CheckoutOnlyProvider();
  for (const returnPath of ["//external.invalid/checkout", "/\\external.invalid/checkout", "/\n/external.invalid/checkout", "https://external.invalid/checkout", "/workspaces/fixture/settings/plano?tab=credits"]) {
    await purchaseAiCredits(deps(provider), { tenantId, userId: "fixture-admin", credits: 100, returnPath });
    const checkout = provider.checkouts.at(-1);
    for (const address of [checkout.successUrl, checkout.cancelUrl]) {
      const url = new URL(address);
      assert.equal(url.origin, "https://app.vorix.test");
      assert.equal(url.pathname, returnPath.startsWith("/workspaces/") ? "/workspaces/fixture/settings/plano" : "/");
    }
  }
});

/** Cartão salvo recusado pelo gateway: cai no checkout. */
class DecliningProvider extends SandboxBillingProvider {
  providerId = "declining";
  async chargeOneTime() { return { ok: false, kind: "invalid_request", message: "card_declined" }; }
  async createOneTimeCheckout() { return { ok: true, checkoutUrl: "https://pay.test/c/2", providerSessionId: "sess_2" }; }
}

function deps(provider = new SandboxBillingProvider()) {
  return {
    billingProvider: provider,
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    aiCreditPurchaseRepository: new PostgresAiCreditPurchaseRepository(db.pool),
    userRepository: { getById: async () => ({ email: "dono@empresa.test" }) },
    pricing,
    appBaseUrl: "https://app.vorix.test",
  };
}

async function paidTenant(label) {
  const tenantId = nextTenant(label);
  const platformBillingRepository = new PostgresPlatformBillingRepository(db.pool);
  await platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const start = await new PostgresPlanVersionRepository(db.pool).getActiveVersion("START");
  await new PostgresSubscriptionRepository(db.pool).create({ tenantId, planVersionId: start.id, status: "active", billingProvider: "sandbox", providerCustomerId: "cus_saved", providerSubscriptionId: `sub_${tenantId}`, billingInterval: "monthly" });
  await syncTenantBilling({ planVersionRepository: new PostgresPlanVersionRepository(db.pool), platformBillingRepository }, { tenantId, planVersionId: start.id, status: "active" });
  return tenantId;
}

test("COMPRA: cartão salvo é cobrado na hora, o saldo sobe exatamente a quantidade escolhida e fica no histórico", async () => {
  const tenantId = await paidTenant("saved");
  const before = await getAiCreditsOverview(deps(), tenantId);
  assert.equal(before.chargesSavedCard, true);
  const result = await purchaseAiCredits(deps(), { tenantId, userId: "owner-1", credits: 1_234 });
  assert.equal(result.status, "paid");
  assert.equal(result.purchase.amountCents, 12_340, "preço por crédito × quantidade livre");
  assert.equal(result.remainingCredits, before.remainingCredits + 1_234);
  const after = await getAiCreditsOverview(deps(), tenantId);
  assert.equal(after.extraCredits, before.extraCredits + 1_234);
  assert.equal(after.purchases[0].status, "paid");
  const ledger = await new PostgresPlatformBillingRepository(db.pool).listCreditLedger({ tenantId });
  assert.equal(ledger.filter((entry) => entry.reason === "extra_purchase").length, 1);
});

test("COMPRA: quantidade fora dos limites e conta com teste vencido são recusadas", async () => {
  const tenantId = await paidTenant("limits");
  await assert.rejects(purchaseAiCredits(deps(), { tenantId, userId: "u", credits: 99 }), /AI_CREDITS_INVALID_AMOUNT/);
  await assert.rejects(purchaseAiCredits(deps(), { tenantId, userId: "u", credits: 100_001 }), /AI_CREDITS_INVALID_AMOUNT/);
  await new PostgresPlatformBillingRepository(db.pool).updateTenantBilling({ tenantId, patch: { subscriptionStatus: "trial_expired" }, now: new Date().toISOString() });
  await assert.rejects(purchaseAiCredits(deps(), { tenantId, userId: "u", credits: 500 }), /AI_CREDITS_ACCOUNT_BLOCKED/);
});

test("CHECKOUT: sem cobrança direta abre o pagamento único; o webhook lança os créditos UMA vez", async () => {
  const tenantId = await paidTenant("checkout");
  const provider = new CheckoutOnlyProvider();
  const before = await getAiCreditsOverview(deps(provider), tenantId);
  const result = await purchaseAiCredits(deps(provider), { tenantId, userId: "owner-1", credits: 500, returnPath: "/workspaces/w/settings/plano" });
  assert.equal(result.status, "checkout");
  assert.equal(result.checkoutUrl, "https://pay.test/c/1");
  assert.equal(provider.checkouts[0].amountCents, 5_000);
  assert.match(provider.checkouts[0].successUrl, /creditos=ok/);
  assert.equal((await getAiCreditsOverview(deps(provider), tenantId)).extraCredits, before.extraCredits, "nada entra antes da confirmação");

  const webhookDeps = {
    billingProvider: new SandboxBillingProvider(),
    paymentWebhookEventRepository: new PostgresPaymentWebhookEventRepository(db.pool),
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    billingEventRepository: new PostgresBillingEventRepository(db.pool),
    invoiceRepository: new PostgresInvoiceRepository(db.pool),
    aiCreditPurchaseRepository: new PostgresAiCreditPurchaseRepository(db.pool),
  };
  const event = (id) => ({ rawBody: Buffer.from(JSON.stringify({ id, type: "one_time_payment.succeeded", data: { reference: result.purchase.id, providerPaymentId: "pay_1" } })), signatureHeader: undefined });
  assert.equal((await processBillingWebhook(webhookDeps, event(`evt-${tenantId}-1`))).ok, true);
  // Reentrega com outro id (gateway notifica de novo): nunca credita duas vezes.
  assert.equal((await processBillingWebhook(webhookDeps, event(`evt-${tenantId}-2`))).ok, true);
  const after = await getAiCreditsOverview(deps(provider), tenantId);
  assert.equal(after.extraCredits, before.extraCredits + 500);
  assert.equal(after.purchases[0].status, "paid");
});

test("CHECKOUT: cartão salvo recusado oferece o pagamento único e registra o motivo", async () => {
  const tenantId = await paidTenant("declined");
  const result = await purchaseAiCredits(deps(new DecliningProvider()), { tenantId, userId: "owner-1", credits: 300 });
  assert.equal(result.status, "checkout");
  const purchase = await new PostgresAiCreditPurchaseRepository(db.pool).getById(result.purchase.id);
  assert.equal(purchase.method, "checkout");
  assert.equal(purchase.status, "pending");
  assert.equal(purchase.failureReason, "card_declined");
});

test("TESTE GRÁTIS: só créditos de teste; vencido zera a cota e bloqueia a IA (créditos comprados continuam)", async () => {
  const tenantId = nextTenant("trial");
  const r = {
    subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
    planVersionRepository: new PostgresPlanVersionRepository(db.pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    billingEventRepository: new PostgresBillingEventRepository(db.pool),
  };
  await r.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  await startTrial({ ...r, trialEnabled: true, trialAiCredits: 80 }, { tenantId, planCode: "PRO" });
  let billing = await r.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.monthlyCreditsQuota, 80, "teste libera só os créditos de teste, não a cota do plano");

  await expireTrials({ ...r, trialEnabled: true, now: () => new Date(Date.now() + 30 * 86_400_000) });
  billing = await r.platformBillingRepository.getTenantBilling(tenantId);
  assert.equal(billing.subscriptionStatus, "trial_expired");
  assert.equal(billing.monthlyCreditsQuota, 0);

  const accounting = new CreditAccountingService({
    platformBillingRepository: r.platformBillingRepository,
    aiProvidersRepository: { getOperationType: async () => ({ code: "report_ai_analysis", active: true, creditsCost: 1 }) },
  });
  const availability = await accounting.checkAvailability(tenantId, "report_ai_analysis", new Date());
  assert.equal(availability.ok, false);
  assert.equal(availability.reason, "account_blocked");
  assert.match(availability.message, /teste gratuito terminou/);
});
