import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { MercadoPagoBillingProvider } from "../dist/infrastructure/billing/mercadopago-billing-provider.js";

/**
 * Pricing/Capacity Etapa C (Mercado Pago) — `MercadoPagoBillingProvider` isolado, sem credenciais
 * reais de Mercado Pago disponíveis neste ambiente (nunca fabricadas — ver
 * `docs/vorix-billing-mercadopago-implementation.md`, seção "Runtime QA"). `fetchImpl` é
 * injetado como um fake determinístico que grava a requisição feita e devolve uma resposta
 * controlada — mesma técnica de teste de qualquer outro provider HTTP no repositório.
 */

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (!next) throw new Error(`fakeFetch: nenhuma resposta programada para ${url}`);
    return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body ?? {} };
  };
  return { impl, calls };
}

function signManifest(secret, { dataId, requestId, ts }) {
  const parts = [];
  parts.push(`id:${dataId.toLowerCase()};`);
  if (requestId) parts.push(`request-id:${requestId};`);
  parts.push(`ts:${ts};`);
  const manifest = parts.join("");
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

test("MercadoPagoBillingProvider sem credenciais devolve not_configured em todo método, nunca lança", async () => {
  const provider = new MercadoPagoBillingProvider({});
  assert.equal(provider.providerId, "mercadopago");
  assert.equal(provider.supportsNativeScheduledCancellation, false);

  const checkout = await provider.createCheckout({
    tenantId: "t1", planVersionId: "pv1", providerPlanPriceRef: "", billingInterval: "monthly",
    customerEmail: "a@b.com", successUrl: "https://vorixworks.com/ok", cancelUrl: "https://vorixworks.com/cancel",
    amount: 14900, currency: "BRL",
  });
  assert.equal(checkout.ok, false);
  assert.equal(checkout.kind, "not_configured");
});

test("createCheckout: cria preapproval com auto_recurring.transaction_amount do chamador, nunca recalcula, e devolve init_point", async () => {
  const { impl, calls } = fakeFetch([{ body: { id: "preapproval-1", init_point: "https://mercadopago.com/checkout/preapproval-1" } }]);
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token", notificationUrl: "https://api.vorixworks.com/webhooks/billing/mercadopago", fetchImpl: impl });

  const result = await provider.createCheckout({
    tenantId: "tenant-1", planVersionId: "planv-pro", providerPlanPriceRef: "", billingInterval: "monthly",
    customerEmail: "cliente@empresa.com", successUrl: "https://vorixworks.com/ok", cancelUrl: "https://vorixworks.com/cancel",
    amount: 33800, currency: "BRL",
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkoutUrl, "https://mercadopago.com/checkout/preapproval-1");
  assert.equal(result.providerSessionId, "preapproval-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/preapproval$/);
  assert.equal(calls[0].body.auto_recurring.transaction_amount, 33800);
  assert.equal(calls[0].body.auto_recurring.currency_id, "BRL");
  assert.equal(calls[0].body.status, "pending");
  const metadata = JSON.parse(calls[0].body.external_reference);
  assert.equal(metadata.tenantId, "tenant-1");
  assert.equal(metadata.planVersionId, "planv-pro");
});

test("createCheckout: sem amount/currency do chamador falha explicitamente, nunca cobra um valor inventado", async () => {
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token" });
  const result = await provider.createCheckout({
    tenantId: "t1", planVersionId: "pv1", providerPlanPriceRef: "", billingInterval: "monthly",
    customerEmail: "a@b.com", successUrl: "https://vorixworks.com/ok", cancelUrl: "https://vorixworks.com/cancel",
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "invalid_request");
});

test("changeSubscription/addSubscriptionItem/removeSubscriptionItem/updateSubscriptionItemQuantity: todos convergem para PUT /preapproval/{id} com o total recalculado pelo chamador", async () => {
  const { impl, calls } = fakeFetch([{ body: { status: "authorized" } }, { body: { status: "authorized" } }, { body: { status: "authorized" } }, { body: { status: "authorized" } }]);
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token", fetchImpl: impl });

  const change = await provider.changeSubscription({ providerSubscriptionId: "preapproval-1", newProviderPlanPriceRef: "", billingInterval: "monthly", prorate: false, amount: 59900, currency: "BRL" });
  assert.equal(change.ok, true);

  const added = await provider.addSubscriptionItem({ providerSubscriptionId: "preapproval-1", providerPriceRef: "", quantity: 1, amount: 63800, currency: "BRL" });
  assert.equal(added.ok, true);
  assert.equal(added.providerItemId, "mercadopago-virtual-item-preapproval-1");

  const removed = await provider.removeSubscriptionItem({ providerItemId: "mercadopago-virtual-item-preapproval-1", providerSubscriptionId: "preapproval-1", amount: 59900, currency: "BRL" });
  assert.equal(removed.ok, true);

  const updated = await provider.updateSubscriptionItemQuantity({ providerItemId: "mercadopago-virtual-item-preapproval-1", quantity: 2, providerSubscriptionId: "preapproval-1", amount: 67700, currency: "BRL" });
  assert.equal(updated.ok, true);

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.method, "PUT");
    assert.match(call.url, /\/preapproval\/preapproval-1$/);
    assert.ok(typeof call.body.auto_recurring.transaction_amount === "number");
  }
});

test("cancelSubscription: atPeriodEnd:true é rejeitado (Mercado Pago não agenda nativamente — o chamador usa subscription_pending_changes); atPeriodEnd:false cancela de verdade", async () => {
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token" });
  const scheduled = await provider.cancelSubscription({ providerSubscriptionId: "preapproval-1", atPeriodEnd: true });
  assert.equal(scheduled.ok, false);
  assert.equal(scheduled.kind, "invalid_request");

  const { impl, calls } = fakeFetch([{ body: { status: "cancelled" } }]);
  const provider2 = new MercadoPagoBillingProvider({ accessToken: "TEST-token", fetchImpl: impl });
  const immediate = await provider2.cancelSubscription({ providerSubscriptionId: "preapproval-1", atPeriodEnd: false });
  assert.equal(immediate.ok, true);
  assert.equal(calls[0].body.status, "cancelled");
});

test("resumeSubscription: PUT status=authorized", async () => {
  const { impl, calls } = fakeFetch([{ body: { status: "authorized" } }]);
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token", fetchImpl: impl });
  const result = await provider.resumeSubscription({ providerSubscriptionId: "preapproval-1" });
  assert.equal(result.ok, true);
  assert.equal(calls[0].body.status, "authorized");
});

test("getPaymentMethod: nunca inventa um cartão — devolve undefined explicitamente", async () => {
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token" });
  const result = await provider.getPaymentMethod({ providerCustomerId: "payer-1" });
  assert.equal(result.ok, true);
  assert.equal(result.paymentMethod, undefined);
});

test("createCustomerPortal: falha explícita — Mercado Pago não tem portal hospedado equivalente ao Stripe", async () => {
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token" });
  const result = await provider.createCustomerPortal({ providerCustomerId: "payer-1", returnUrl: "https://vorixworks.com/billing" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "not_configured");
});

test("handleWebhook: assinatura x-signature válida (manifest id/ts + HMAC-SHA256) é aceita; inválida é rejeitada", async () => {
  const secret = "test-webhook-secret";
  const ts = "1700000000";
  const dataId = "PREAPPROVAL-123";

  const { impl, calls } = fakeFetch([{ body: { id: "preapproval-123", status: "authorized", external_reference: JSON.stringify({ tenantId: "tenant-1", planVersionId: "planv-1", billingInterval: "monthly" }) } }]);
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token", webhookSecret: secret, fetchImpl: impl });

  const rawBody = Buffer.from(JSON.stringify({ type: "subscription_preapproval", data: { id: dataId } }));
  const validSignature = signManifest(secret, { dataId, requestId: "req-1", ts });

  const result = await provider.handleWebhook({ rawBody, signatureHeader: validSignature, requestIdHeader: "req-1" });
  assert.equal(result.ok, true);
  assert.equal(result.event.eventType, "checkout.session.completed");
  assert.equal(result.event.providerSubscriptionId, "preapproval-123");
  assert.deepEqual(result.event.data.metadata, { tenantId: "tenant-1", planVersionId: "planv-1", billingInterval: "monthly" });
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/preapproval\/PREAPPROVAL-123$/);

  const invalidSignature = `ts=${ts},v1=deadbeef`;
  const rejected = await provider.handleWebhook({ rawBody, signatureHeader: invalidSignature, requestIdHeader: "req-1" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.kind, "signature_invalid");
});

test("handleWebhook: preapproval cancelled mapeia para customer.subscription.deleted (vocabulário canônico já usado pelo Stripe)", async () => {
  const secret = "test-webhook-secret";
  const ts = "1700000001";
  const dataId = "preapproval-999";
  const { impl } = fakeFetch([{ body: { id: dataId, status: "cancelled" } }]);
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token", webhookSecret: secret, fetchImpl: impl });

  const rawBody = Buffer.from(JSON.stringify({ type: "subscription_preapproval", data: { id: dataId } }));
  const signature = signManifest(secret, { dataId, ts });
  const result = await provider.handleWebhook({ rawBody, signatureHeader: signature });
  assert.equal(result.ok, true);
  assert.equal(result.event.eventType, "customer.subscription.deleted");
});

test("handleWebhook: pagamento aprovado/rejeitado mapeia para invoice.payment_succeeded/failed", async () => {
  const secret = "test-webhook-secret";
  const ts = "1700000002";
  const dataId = "payment-1";
  const { impl } = fakeFetch([{ body: { id: dataId, status: "approved", transaction_amount: 33800, currency_id: "BRL" } }]);
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-token", webhookSecret: secret, fetchImpl: impl });

  const rawBody = Buffer.from(JSON.stringify({ type: "payment", data: { id: dataId } }));
  const signature = signManifest(secret, { dataId, ts });
  const result = await provider.handleWebhook({ rawBody, signatureHeader: signature });
  assert.equal(result.ok, true);
  assert.equal(result.event.eventType, "invoice.payment_succeeded");
});
