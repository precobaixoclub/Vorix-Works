import test from "node:test";
import assert from "node:assert/strict";
import { MetaAdsOAuthService, META_ADS_REQUIRED_SCOPES } from "../dist/infrastructure/publication/meta-ads-oauth-service.js";
import { InMemoryMetaAdsCredentialRepository } from "../dist/infrastructure/storage/in-memory-meta-ads-credential-repository.js";
import { InMemoryMetaAdAccountRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-account-repository.js";

/**
 * OAuth do módulo Meta Ads Manager — Fase 1. Achado central da auditoria do pacote de referência
 * (bittencourtthulio/meta-graph-api-integration): o defeito #1 do top-5 do README daquele pacote
 * era a troca de token de longa duração NUNCA acontecer (`facebook-oauth/index.ts` shipado como o
 * código ORIGINAL com bug, não o corrigido). Estes testes travam que aqui a segunda troca
 * (`fb_exchange_token`) sempre acontece antes de qualquer descoberta de conta.
 */

function fakeSecretManager() {
  const store = new Map();
  return {
    async health() { return { ok: true }; },
    async put(reference, value) { store.set(reference, value); },
    async get(reference) { return store.get(reference); },
    async delete(reference) { store.delete(reference); },
    _store: store,
  };
}

function config(overrides = {}) {
  return { enabled: true, appId: "app-1", appSecret: "secret-1", redirectUri: "https://app.example.com/meta-ads/callback", scopes: META_ADS_REQUIRED_SCOPES, ...overrides };
}

/** Fake fetch dirigido por fila — cada chamada consome o próximo item, na ordem em que o service
 * realmente as faz: exchangeCode → exchangeLongLivedToken → /me → /me/adaccounts (paginado). */
function fakeFetchQueue(responses) {
  const calls = [];
  let index = 0;
  const impl = async (url) => {
    calls.push(url);
    const next = responses[index];
    index++;
    if (!next) throw new Error(`fakeFetchQueue: fila vazia na chamada #${calls.length} (${url})`);
    return typeof next === "function" ? next(url) : next;
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

function shortLivedTokenResponse() { return jsonResponse({ access_token: "short-lived-token", expires_in: 5400 }); }
function longLivedTokenResponse(expiresIn = 5183944) { return jsonResponse({ access_token: "long-lived-token", expires_in: expiresIn }); }
function meResponse(id = "meta-user-1") { return jsonResponse({ id }); }
function adAccountsPage(accounts, next) { return jsonResponse({ data: accounts, paging: next ? { cursors: { after: next } } : undefined }); }

function buildService(overrides = {}) {
  const credentialRepository = overrides.credentialRepository ?? new InMemoryMetaAdsCredentialRepository();
  const adAccountRepository = overrides.adAccountRepository ?? new InMemoryMetaAdAccountRepository();
  const secretManager = overrides.secretManager ?? fakeSecretManager();
  const service = new MetaAdsOAuthService({
    config: overrides.config ?? config(),
    credentialRepository,
    adAccountRepository,
    secretManager,
    httpClient: overrides.httpClient,
    now: overrides.now,
  });
  return { service, credentialRepository, adAccountRepository, secretManager };
}

test("MetaAdsOAuthService.isConfigured: false sem appId/appSecret/redirectUri", () => {
  const { service } = buildService({ config: config({ appId: undefined }) });
  assert.equal(service.isConfigured(), false);
});

test("begin(): gera uma URL de autorização com PKCE (code_challenge S256) e um state novo a cada chamada", () => {
  const { service } = buildService();
  const first = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const second = service.begin({ tenantId: "t1", workspaceId: "w1" });
  assert.notEqual(first.state, second.state);
  const url = new URL(first.authorizationUrl);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.equal(url.searchParams.get("scope"), META_ADS_REQUIRED_SCOPES.join(","));
});

test("complete(): SEMPRE faz a troca de longa duração (fb_exchange_token) antes de descobrir contas — nunca assume 60 dias sem a segunda troca", async () => {
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(), adAccountsPage([])]);
  const { service, credentialRepository } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });

  await service.complete({ state, code: "auth-code" });

  assert.equal(httpClient.calls.length, 4);
  assert.match(httpClient.calls[0], /oauth\/access_token/);
  assert.doesNotMatch(httpClient.calls[0], /grant_type=fb_exchange_token/, "primeira chamada é a troca do code, nunca já com fb_exchange_token");
  assert.match(httpClient.calls[1], /grant_type=fb_exchange_token/);
  assert.match(httpClient.calls[1], /fb_exchange_token=short-lived-token/, "a segunda troca usa o token CURTO da primeira, nunca o code original de novo");

  const references = await credentialRepository.listCredentialReferencesByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(references.length, 1);
  assert.equal(references[0].status, "active");
  assert.equal(references[0].providerId, "meta_ads");
});

test("complete(): o token de LONGA duração (nunca o curto) é o que fica salvo no secret manager", async () => {
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(), adAccountsPage([])]);
  const { service, secretManager } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const { credentialReferenceId } = await service.complete({ state, code: "auth-code" });

  const stored = [...secretManager._store.values()][0];
  assert.equal(stored.value.accessToken, "long-lived-token");
  assert.notEqual(stored.value.accessToken, "short-lived-token");
  assert.ok(credentialReferenceId.startsWith("meta_ads:t1:w1:"));
});

test("complete(): expiresAt reflete o expires_in REAL devolvido pela troca de longa duração, nunca um default fixo de 60 dias", async () => {
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(3600), meResponse(), adAccountsPage([])]);
  const { service, credentialRepository } = buildService({ httpClient, now: () => fixedNow });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  await service.complete({ state, code: "auth-code" });

  const [reference] = await credentialRepository.listCredentialReferencesByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(reference.expiresAt, new Date(fixedNow.getTime() + 3600 * 1000).toISOString());
});

test("complete(): state inválido/expirado nunca chega a chamar a Graph API", async () => {
  const httpClient = fakeFetchQueue([]);
  const { service } = buildService({ httpClient });
  await assert.rejects(() => service.complete({ state: "nao-existe", code: "x" }), /META_ADS_OAUTH_STATE_INVALID/);
  assert.equal(httpClient.calls.length, 0);
});

test("complete(): state só pode ser usado UMA vez — reuso é rejeitado (proteção contra replay)", async () => {
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(), adAccountsPage([])]);
  const { service } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  await service.complete({ state, code: "auth-code" });
  await assert.rejects(() => service.complete({ state, code: "auth-code" }), /META_ADS_OAUTH_STATE_INVALID/);
});

test("complete(): descobre e persiste TODAS as contas de anúncio, paginando até o fim (sem truncar silenciosamente)", async () => {
  const httpClient = fakeFetchQueue([
    shortLivedTokenResponse(),
    longLivedTokenResponse(),
    meResponse(),
    adAccountsPage([{ id: "111", name: "Conta A", currency: "BRL", account_status: 1 }], "cursor-1"),
    adAccountsPage([{ id: "222", name: "Conta B", currency: "USD", account_status: 1 }]),
  ]);
  const { service, adAccountRepository } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const { accounts } = await service.complete({ state, code: "auth-code" });

  assert.deepEqual(accounts.map((account) => account.accountId).sort(), ["act_111", "act_222"]);
  const persisted = await adAccountRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(persisted.length, 2);
  assert.ok(persisted.every((account) => account.accountId.startsWith("act_")), "toda conta persistida sempre normalizada pro formato act_XXXX");
});

test("syncAdAccounts() via resyncAccounts: contas que desapareceram do token são desativadas, nunca deletadas silenciosamente", async () => {
  const httpClient = fakeFetchQueue([
    shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(),
    adAccountsPage([{ id: "111", name: "Conta A", currency: "BRL" }, { id: "222", name: "Conta B", currency: "BRL" }]),
    adAccountsPage([{ id: "111", name: "Conta A", currency: "BRL" }]), // resync: 222 sumiu
  ]);
  const { service, adAccountRepository } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const { credentialReferenceId } = await service.complete({ state, code: "auth-code" });

  await service.resyncAccounts({ tenantId: "t1", workspaceId: "w1", credentialReferenceId });

  const persisted = await adAccountRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  const account222 = persisted.find((account) => account.accountId === "act_222");
  const account111 = persisted.find((account) => account.accountId === "act_111");
  assert.equal(account222.isActive, false, "conta que sumiu do token deveria ser desativada");
  assert.equal(account111.isActive, true, "conta que continua no token deveria continuar ativa");
  assert.equal(persisted.length, 2, "nunca deleta a linha, só desativa — histórico preservado");
});

test("resyncAccounts(): rejeita se a credencial não pertence ao tenant/workspace informado (isolamento entre tenants)", async () => {
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(), adAccountsPage([])]);
  const { service } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const { credentialReferenceId } = await service.complete({ state, code: "auth-code" });

  await assert.rejects(
    () => service.resyncAccounts({ tenantId: "t2", workspaceId: "w2", credentialReferenceId }),
    /META_ADS_CREDENTIAL_NOT_ACTIVE/,
  );
});

test("disconnect(): revoga a credencial e apaga o secret — mas nunca chama a API do Meta pra revogar a autorização global do app", async () => {
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(), adAccountsPage([])]);
  const { service, credentialRepository, secretManager } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const { credentialReferenceId } = await service.complete({ state, code: "auth-code" });

  const callsBeforeDisconnect = httpClient.calls.length;
  const disconnected = await service.disconnect({ tenantId: "t1", workspaceId: "w1", credentialReferenceId });

  assert.equal(disconnected, true);
  assert.equal(httpClient.calls.length, callsBeforeDisconnect, "disconnect nunca deveria chamar a Graph API");
  const reference = await credentialRepository.getCredentialReference(credentialReferenceId);
  assert.equal(reference.status, "revoked");
  assert.equal(secretManager._store.size, 0);
});

test("disconnect(): devolve false para uma credencial de outro tenant/workspace, nunca revoga silenciosamente algo de outro cliente", async () => {
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(), adAccountsPage([])]);
  const { service } = buildService({ httpClient });
  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const { credentialReferenceId } = await service.complete({ state, code: "auth-code" });

  const disconnected = await service.disconnect({ tenantId: "t2", workspaceId: "w2", credentialReferenceId });
  assert.equal(disconnected, false);
});

test("status(): connected=true só quando existe alguma referência 'active'; nunca conta uma revogada", async () => {
  const httpClient = fakeFetchQueue([shortLivedTokenResponse(), longLivedTokenResponse(), meResponse(), adAccountsPage([])]);
  const { service } = buildService({ httpClient });
  const before = await service.status({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(before.connected, false);

  const { state } = service.begin({ tenantId: "t1", workspaceId: "w1" });
  const { credentialReferenceId } = await service.complete({ state, code: "auth-code" });
  const afterConnect = await service.status({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(afterConnect.connected, true);

  await service.disconnect({ tenantId: "t1", workspaceId: "w1", credentialReferenceId });
  const afterDisconnect = await service.status({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(afterDisconnect.connected, false);
});
