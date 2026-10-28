import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { verifyMercadoPagoWebhook } from "../dist/domain/commerce/payment-webhook.js";
import { registerCommerceRoutes } from "../dist/interfaces/api/routes/v1/commerce.route.js";
import { siteCheckoutStatus, commerceCredentialStatus } from "../dist/application/commerce/checkout-use-cases.js";
import { siteCommerceSettingsSchema } from "../dist/domain/sites/site-commerce.js";

const secret = "fixture-merchant-webhook-secret";
const signed = (ts = String(Math.floor(Date.now() / 1000)), dataId = "123", requestId = "qa-request") => ({ secret, dataId, requestId, signature: `ts=${ts},v1=${createHmac("sha256", secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex")}` });

test("payment webhook HMAC accepts seconds/milliseconds and rejects forged IDs, wrong merchants, missing signatures and stale replay", () => {
  for (const ts of [String(Date.now()), String(Math.floor(Date.now() / 1000))]) assert.equal(verifyMercadoPagoWebhook(signed(ts)), true);
  for (const patch of [{ secret: "different-merchant" }, { dataId: "124" }, { requestId: "different" }, { signature: undefined }, { dataId: undefined }, { signature: "ts=123,v1=invalid" }]) assert.equal(verifyMercadoPagoWebhook({ ...signed(), ...patch }), false);
  assert.equal(verifyMercadoPagoWebhook(signed(String(Math.floor(Date.now() / 1000) - 301))), false);
  assert.equal(verifyMercadoPagoWebhook(signed(String(Date.now() + 301000))), false);
  const valid = signed(); assert.equal(verifyMercadoPagoWebhook({ ...valid, signature: valid.signature + ",ts=1234567890" }), false);
});

test("payment webhook ingress authenticates before calling the provider; transient errors remain retryable", async () => {
  const app = Fastify(); let providerCalls = 0;
  await registerCommerceRoutes(app, {
    orders: { paymentByProviderId: async () => ({ id: "payment", orderId: "order" }), get: async () => ({ id: "order", tenantId: "tenant", workspaceId: "workspace", siteId: "site" }) },
    secrets: { get: async () => ({ value: { accessToken: "qa-token", webhookSecret: secret } }) },
    paymentProviders: { MERCADO_PAGO: { getPayment: async () => { providerCalls++; throw Error("provider temporarily unavailable"); } } },
  });
  try {
    const payload = { type: "payment", data: { id: "123" } }, url = "/webhooks/commerce/mercado-pago/site?data.id=123";
    assert.equal((await app.inject({ method: "POST", url, payload })).statusCode, 401);
    assert.equal(providerCalls, 0);
    const signature = signed();
    const headers = { "x-signature": signature.signature, "x-request-id": signature.requestId };
    assert.equal((await app.inject({ method: "POST", url, payload: { type: "payment", data: { id: "124" } }, headers })).statusCode, 401);
    assert.equal(providerCalls, 0);
    assert.equal((await app.inject({ method: "POST", url, payload, headers })).statusCode, 503);
    assert.equal(providerCalls, 1);
  } finally { await app.close(); }
});

test("checkout stays closed without the merchant webhook secret, and status never reveals that secret", async () => {
  const settings = siteCommerceSettingsSchema.parse({ mode: "ONLINE_CHECKOUT", checkout: { payment: { provider: "MERCADO_PAGO", pix: true }, shipping: { pickup: { enabled: true, address: "QA" } } } });
  let credentials = { accessToken: "qa-token" };
  const deps = { sandboxAllowed: false, secrets: { get: async () => ({ value: credentials }) } }, site = { id: "qa-site", tenantId: "qa-tenant" };
  assert.equal((await siteCheckoutStatus(deps, site, settings)).ready, false);
  credentials = { ...credentials, webhookSecret: secret };
  assert.equal((await siteCheckoutStatus(deps, site, settings)).ready, true);
  const status = JSON.stringify(await commerceCredentialStatus(deps, site));
  assert.ok(!status.includes(secret)); assert.ok(!status.includes("qa-token")); assert.ok(status.includes('"webhookConfigured":true'));
});
