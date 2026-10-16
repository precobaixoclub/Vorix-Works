import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository, PostgresAddonDefinitionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresBillingEventRepository, PostgresInvoiceRepository, PostgresPaymentWebhookEventRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-ops-repository.js";
import { PostgresCheckoutIntentRepository } from "../dist/infrastructure/storage/postgres/postgres-checkout-intent-repository.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresSubscriptionPendingChangeRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-pending-change-repository.js";
import { SandboxBillingProvider } from "../dist/infrastructure/billing/sandbox-billing-provider.js";
import { MercadoPagoBillingProvider } from "../dist/infrastructure/billing/mercadopago-billing-provider.js";
import { itemsForCapacity, startCheckout } from "../dist/application/billing/checkout-use-cases.js";
import { processBillingWebhook } from "../dist/application/billing/webhook-use-cases.js";
import { purchaseAddon } from "../dist/application/billing/lifecycle-use-cases.js";
import { startTrial } from "../dist/application/billing/trial-use-cases.js";
import { meetingsItemsFor, syncMeetingsEntitlementFromSubscription } from "../dist/application/billing/meetings-offer.js";
import { registerPlatformPlansRoutes } from "../dist/interfaces/api/routes/v1/platform-plans.route.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import Fastify from "fastify";

/**
 * Contratação automática: configurador → checkout com cartão (7 dias de teste) → webhook aplica
 * EXATAMENTE o pedido (adicionais com quantidade) → acesso liberado. Vorix Meetings: preço oficial
 * no catálogo, venda bloqueada pelo gate até gravar em produção, acesso derivado da assinatura.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextTenant = (label) => `tenant-auto-${label}-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

/** Sandbox que registra o que foi enviado ao gateway. */
class RecordingProvider extends SandboxBillingProvider {
  calls = [];
  async createCheckout(input) { this.calls.push(input); return super.createCheckout(input); }
}

const repos = () => ({
  planVersionRepository: new PostgresPlanVersionRepository(db.pool),
  addonDefinitionRepository: new PostgresAddonDefinitionRepository(db.pool),
  subscriptionRepository: new PostgresSubscriptionRepository(db.pool),
  subscriptionItemRepository: new PostgresSubscriptionItemRepository(db.pool),
  checkoutIntentRepository: new PostgresCheckoutIntentRepository(db.pool),
  solutionEntitlementRepository: new PostgresSolutionEntitlementRepository(db.pool),
  platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
  billingEventRepository: new PostgresBillingEventRepository(db.pool),
});

function webhookDeps(provider = new SandboxBillingProvider()) {
  const r = repos();
  return { ...r, billingProvider: provider, paymentWebhookEventRepository: new PostgresPaymentWebhookEventRepository(db.pool), invoiceRepository: new PostgresInvoiceRepository(db.pool) };
}

const webhook = (body) => ({ rawBody: Buffer.from(JSON.stringify(body)), signatureHeader: undefined });
const checkoutInput = (tenantId, extra) => ({ tenantId, customerEmail: "cliente@empresa.test", planCode: "START", billingInterval: "monthly", successUrl: "https://app.vorix.test/ok", cancelUrl: "https://app.vorix.test/cancel", ...extra });

test("CATÁLOGO: Meetings tem preço oficial (R$147 com 1 simultânea, +R$67 por adicional) e entra nos planos pagos", async () => {
  const addons = new PostgresAddonDefinitionRepository(db.pool);
  const base = await addons.getByCode("meetings_base");
  const extra = await addons.getByCode("meetings_extra_recording");
  assert.deepEqual([base.monthlyPriceUsd, base.currency, base.resource, base.increment], [147, "BRL", "meetings_concurrent_recordings", 1]);
  assert.deepEqual([extra.monthlyPriceUsd, extra.currency], [67, "BRL"]);
  const start = await new PostgresPlanVersionRepository(db.pool).getActiveVersion("START");
  assert.ok(start.allowedAddonCodes.includes("meetings_base") && start.allowedAddonCodes.includes("meetings_extra_recording"));
  assert.deepEqual(meetingsItemsFor(3), [{ addonCode: "meetings_base", quantity: 1 }, { addonCode: "meetings_extra_recording", quantity: 2 }]);

  const app = Fastify();
  await registerPlatformPlansRoutes(app, { planVersionRepository: new PostgresPlanVersionRepository(db.pool), addonDefinitionRepository: addons });
  const response = await app.inject({ method: "GET", url: "/platform/plans" });
  const data = response.json().data;
  assert.deepEqual(data.meetingsOffer, { currency: "BRL", baseMonthlyPrice: 147, baseYearlyPrice: 1470, includedConcurrentRecordings: 1, additionalRecordingMonthlyPrice: 67, additionalRecordingYearlyPrice: 670 });
  assert.equal(data.solutions.find((solution) => solution.key === "meetings").contractable, false);
  await app.close();
});

test("CHECKOUT: capacidade do configurador vira plano + adicionais com quantidade, 7 dias de teste e pedido gravado", async () => {
  const tenantId = nextTenant("cap");
  const provider = new RecordingProvider();
  const r = repos();
  await r.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const start = await r.planVersionRepository.getActiveVersion("START");
  assert.deepEqual(itemsForCapacity(start, await r.addonDefinitionRepository.listActive(), { users: 5, whatsappConnections: 2 }), [{ addonCode: "extra_user", quantity: 3 }, { addonCode: "extra_whatsapp_connection", quantity: 1 }]);

  const result = await startCheckout({ ...r, billingProvider: provider }, checkoutInput(tenantId, { capacity: { users: 5, whatsappConnections: 2 } }));
  const sent = provider.calls[0];
  assert.equal(sent.amount, 149 + 3 * 39 + 79, "total = plano + adicionais × quantidade");
  assert.equal(sent.trialDays, 7, "cartão agora, 1ª cobrança depois do teste");
  assert.deepEqual(sent.addonItems.map((item) => item.quantity), [3, 1]);
  const intent = await r.checkoutIntentRepository.findPendingForCompletion({ tenantId, planVersionId: start.id, providerSessionId: result.providerSessionId });
  assert.deepEqual(intent.items.map((item) => [item.addonCode, item.quantity, item.unitPrice]), [["extra_user", 3, 39], ["extra_whatsapp_connection", 1, 79]]);
  assert.equal(await r.subscriptionRepository.getActiveByTenant(tenantId), undefined, "checkout nunca cria assinatura sozinho");
});

test("CHECKOUT: quem acabou de criar a conta (trial) mantém os dias que restam; trial vencido paga na hora", async () => {
  const r = repos();
  const tenantId = nextTenant("trial");
  await r.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  await startTrial({ ...r, trialEnabled: true }, { tenantId, planCode: "START" });
  const provider = new RecordingProvider();
  await startCheckout({ ...r, billingProvider: provider }, checkoutInput(tenantId));
  assert.equal(provider.calls[0].trialDays, 7);

  const later = new RecordingProvider();
  await startCheckout({ ...r, billingProvider: later, now: () => new Date(Date.now() + 10 * 86_400_000) }, checkoutInput(tenantId));
  assert.equal(later.calls[0].trialDays, undefined, "nunca um segundo teste");
});

test("MEETINGS: checkout e compra de adicional bloqueados enquanto o gate comercial estiver fechado", async () => {
  const r = repos();
  const tenantId = nextTenant("gate");
  await r.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  await assert.rejects(startCheckout({ ...r, billingProvider: new RecordingProvider() }, checkoutInput(tenantId, { capacity: { users: 2, concurrentRecordings: 2 } })), /MEETINGS_NOT_CONTRACTABLE/);
  await assert.rejects(startCheckout({ ...r, billingProvider: new RecordingProvider() }, checkoutInput(tenantId, { items: [{ addonCode: "meetings_base", quantity: 1 }] })), /MEETINGS_NOT_CONTRACTABLE/);
  const subscription = await r.subscriptionRepository.create({ tenantId, planVersionId: (await r.planVersionRepository.getActiveVersion("START")).id, status: "active", billingProvider: "sandbox", providerSubscriptionId: "sub-gate", billingInterval: "monthly" });
  assert.ok(subscription);
  await assert.rejects(purchaseAddon({ ...r, billingProvider: new SandboxBillingProvider(), subscriptionPendingChangeRepository: new PostgresSubscriptionPendingChangeRepository(db.pool) }, { tenantId, addonCode: "meetings_extra_recording", quantity: 1, billingInterval: "monthly" }), /MEETINGS_NOT_CONTRACTABLE/);
});

test("WEBHOOK: aplica exatamente o pedido (quantidades), é idempotente sob reenvio e libera a capacidade", async () => {
  const r = repos();
  const tenantId = nextTenant("hook");
  await r.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const { providerSessionId } = await startCheckout({ ...r, billingProvider: new SandboxBillingProvider() }, checkoutInput(tenantId, { capacity: { users: 4, whatsappConnections: 3 } }));
  const start = await r.planVersionRepository.getActiveVersion("START");
  const event = (id) => webhook({ id, type: "checkout.session.completed", data: { id: providerSessionId, customer: "cus_auto", subscription: `sub_${tenantId}`, metadata: { tenantId, planVersionId: start.id, billingInterval: "monthly" } } });
  assert.equal((await processBillingWebhook(webhookDeps(), event("evt_a1"))).ok, true);
  // O Mercado Pago notifica a mesma assinatura várias vezes (ids de evento diferentes).
  assert.equal((await processBillingWebhook(webhookDeps(), event("evt_a2"))).ok, true);
  const subscription = await r.subscriptionRepository.getActiveByTenant(tenantId);
  const items = await r.subscriptionItemRepository.listBySubscription(subscription.id);
  assert.deepEqual(items.map((item) => [item.addonCode, item.quantity, item.unitPriceUsd]).sort(), [["extra_user", 2, 39], ["extra_whatsapp_connection", 2, 79]]);
  assert.equal(subscription.status, "active");
});

test("WEBHOOK + MEETINGS: assinatura com Meetings libera o acesso com as gravações simultâneas; cancelamento revoga; concessão interna intocada", async () => {
  const r = repos();
  const tenantId = nextTenant("meet");
  await r.platformBillingRepository.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const start = await r.planVersionRepository.getActiveVersion("START");
  // Simula o dia em que o gate abrir: pedido com Meetings (3 simultâneas) gravado como o checkout faria.
  await r.checkoutIntentRepository.createReplacingPending({ id: `chk-${tenantId}`, tenantId, planVersionId: start.id, billingInterval: "monthly", items: [{ addonCode: "meetings_base", quantity: 1, unitPrice: 147, currency: "BRL" }, { addonCode: "meetings_extra_recording", quantity: 2, unitPrice: 67, currency: "BRL" }], amount: 149 + 147 + 134, currency: "BRL", provider: "sandbox", providerSessionId: `cs_${tenantId}` });
  await processBillingWebhook(webhookDeps(), webhook({ id: `evt_m_${tenantId}`, type: "checkout.session.completed", data: { id: `cs_${tenantId}`, customer: "cus_m", subscription: `sub_m_${tenantId}`, metadata: { tenantId, planVersionId: start.id, billingInterval: "monthly" } } }));
  let meetings = (await r.solutionEntitlementRepository.listByTenant(tenantId)).find((entitlement) => entitlement.solutionKey === "meetings");
  assert.deepEqual([meetings.enabled, meetings.source, meetings.limits.maxConcurrentRecordings], [true, "subscription", 3]);

  await processBillingWebhook(webhookDeps(), webhook({ id: `evt_del_${tenantId}`, type: "customer.subscription.deleted", data: { id: `sub_m_${tenantId}`, status: "canceled" } }));
  meetings = (await r.solutionEntitlementRepository.listByTenant(tenantId)).find((entitlement) => entitlement.solutionKey === "meetings");
  assert.equal(meetings.enabled, false, "assinatura encerrada revoga o acesso pago");

  const internalTenant = nextTenant("internal");
  await r.solutionEntitlementRepository.set({ tenantId: internalTenant, solutionKey: "meetings", enabled: true, source: "internal", reason: "homologação" });
  await syncMeetingsEntitlementFromSubscription(r, internalTenant);
  const internal = (await r.solutionEntitlementRepository.listByTenant(internalTenant)).find((entitlement) => entitlement.solutionKey === "meetings");
  assert.deepEqual([internal.enabled, internal.source], [true, "internal"], "concessão interna nunca é revogada pela sincronização");
});

test("MERCADO PAGO: checkout com teste envia free_trial em dias; sem teste, não envia", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: "pre-1", init_point: "https://mp.test/pre-1" }) }; };
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token", fetchImpl });
  const base = { tenantId: "t", planVersionId: "pv", providerPlanPriceRef: "", billingInterval: "monthly", customerEmail: "a@b.test", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/no", amount: 345, currency: "BRL" };
  await provider.createCheckout({ ...base, trialDays: 7 });
  await provider.createCheckout(base);
  assert.deepEqual(calls[0].auto_recurring.free_trial, { frequency: 7, frequency_type: "days" });
  assert.equal(calls[0].auto_recurring.transaction_amount, 345);
  assert.equal(calls[1].auto_recurring.free_trial, undefined);
});
