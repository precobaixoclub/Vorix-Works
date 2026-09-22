import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresBillingProviderSettingsRepository } from "../dist/infrastructure/storage/postgres/postgres-billing-provider-settings-repository.js";
import { getBillingProviderSettings, updateBillingProviderSettings } from "../dist/application/platform-admin/billing-provider-settings.usecases.js";
import { MercadoPagoBillingProvider } from "../dist/infrastructure/billing/mercadopago-billing-provider.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Tela de admin "Mercado Pago" — credenciais do billing provider editáveis em runtime (mesmo
 * molde de `platform_ai_settings`/Anthropic, Sprint 25/Fase 3). Cobre: singleton sempre existe;
 * update grava criptografado + last4; `""` remove; `undefined` mantém; validação de URL; e que
 * `MercadoPagoBillingProvider`, quando recebe uma closure (não uma string fixa), cacheia por TTL
 * em vez de reconsultar a cada chamada de API — a garantia de "runtime sem restart" só vale se a
 * consulta acontecer, mas não em toda requisição.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const SECRETS_MASTER_KEY = "test-secrets-master-key-billing-provider-settings";

let db;

before(async () => {
  db = await startTestPostgres({ port: 55998 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

test("get(): singleton sempre existe (migração 0134), sem nenhuma credencial configurada", async () => {
  const repo = new PostgresBillingProviderSettingsRepository(db.pool, SECRETS_MASTER_KEY);
  const settings = await repo.get();
  assert.equal(settings.resolvedMercadoPagoAccessToken, undefined);
  assert.equal(settings.resolvedMercadoPagoWebhookSecret, undefined);
  assert.equal(settings.mercadoPagoNotificationUrl, undefined);
});

test("update(): grava access token/webhook secret criptografados, expõe só last4; notification URL fica em claro (não é segredo)", async () => {
  const repo = new PostgresBillingProviderSettingsRepository(db.pool, SECRETS_MASTER_KEY);
  const updated = await repo.update({
    mercadoPagoAccessToken: "TEST-abcdefgh12345678",
    mercadoPagoWebhookSecret: "whsec_9988776655",
    mercadoPagoNotificationUrl: "https://api.vorixworks.com/webhooks/billing/mercadopago",
    now: new Date().toISOString(),
    actorUserId: "user-1",
  });

  assert.equal(updated.resolvedMercadoPagoAccessToken, "TEST-abcdefgh12345678");
  assert.equal(updated.mercadoPagoAccessTokenLast4, "5678");
  assert.equal(updated.resolvedMercadoPagoWebhookSecret, "whsec_9988776655");
  assert.equal(updated.mercadoPagoWebhookSecretLast4, "6655");
  assert.equal(updated.mercadoPagoNotificationUrl, "https://api.vorixworks.com/webhooks/billing/mercadopago");
  assert.equal(updated.updatedBy, "user-1");

  const reread = await repo.get();
  assert.equal(reread.resolvedMercadoPagoAccessToken, "TEST-abcdefgh12345678");
});

test("update(): undefined mantém o valor atual; string vazia remove", async () => {
  const repo = new PostgresBillingProviderSettingsRepository(db.pool, SECRETS_MASTER_KEY);
  await repo.update({ mercadoPagoAccessToken: "TEST-keepme0000", now: new Date().toISOString() });

  const kept = await repo.update({ mercadoPagoWebhookSecret: "whsec_new", now: new Date().toISOString() });
  assert.equal(kept.resolvedMercadoPagoAccessToken, "TEST-keepme0000", "access token não foi tocado, deve permanecer");
  assert.equal(kept.resolvedMercadoPagoWebhookSecret, "whsec_new");

  const removed = await repo.update({ mercadoPagoAccessToken: "", now: new Date().toISOString() });
  assert.equal(removed.resolvedMercadoPagoAccessToken, undefined);
  assert.equal(removed.mercadoPagoAccessTokenLast4, undefined);
  assert.equal(removed.resolvedMercadoPagoWebhookSecret, "whsec_new", "remover o access token não deve afetar o webhook secret");
});

test("updateBillingProviderSettings: rejeita Notification URL que não comece com https://", async () => {
  const repo = new PostgresBillingProviderSettingsRepository(db.pool, SECRETS_MASTER_KEY);
  await assert.rejects(
    () => updateBillingProviderSettings({ billingProviderSettingsRepository: repo, now: () => new Date() }, { mercadoPagoNotificationUrl: "http://inseguro.com", actor: { userId: "u1" } }),
    /BILLING_PROVIDER_SETTINGS_INVALID_URL/,
  );
});

test("getBillingProviderSettings: nunca devolve os segredos em claro, só has*/last4", async () => {
  const repo = new PostgresBillingProviderSettingsRepository(db.pool, SECRETS_MASTER_KEY);
  await repo.update({ mercadoPagoAccessToken: "TEST-visible0000", now: new Date().toISOString() });
  const publicSettings = await getBillingProviderSettings({ billingProviderSettingsRepository: repo, now: () => new Date() });
  assert.equal(publicSettings.hasMercadoPagoAccessToken, true);
  assert.equal(publicSettings.mercadoPagoAccessTokenLast4, "0000");
  assert.equal("resolvedMercadoPagoAccessToken" in publicSettings, false);
});

test("MercadoPagoBillingProvider: credencial vinda de closure é cacheada por TTL, nunca reconsultada a cada chamada de API", async () => {
  let getterCalls = 0;
  const getAccessToken = async () => {
    getterCalls += 1;
    return "TEST-from-admin-screen";
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ status: "authorized" }) });

  const provider = new MercadoPagoBillingProvider({ accessToken: getAccessToken, fetchImpl });

  await provider.resumeSubscription({ providerSubscriptionId: "preapproval-1" });
  await provider.resumeSubscription({ providerSubscriptionId: "preapproval-1" });
  await provider.resumeSubscription({ providerSubscriptionId: "preapproval-1" });

  assert.equal(getterCalls, 1, "dentro da janela de cache, o getter só deve ser chamado uma vez, não uma por request");
});

test("MercadoPagoBillingProvider: credencial vinda de string fixa (env, comportamento histórico) funciona sem nenhuma chamada assíncrona extra", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ status: "authorized" }) });
  const provider = new MercadoPagoBillingProvider({ accessToken: "TEST-static-token", fetchImpl });
  const result = await provider.resumeSubscription({ providerSubscriptionId: "preapproval-1" });
  assert.equal(result.ok, true);
});
