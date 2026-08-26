import test from "node:test";
import assert from "node:assert/strict";
import { createMetaAdCampaign } from "../dist/application/meta-ads/create-meta-ad-campaign.js";
import { updateMetaAdCampaign } from "../dist/application/meta-ads/update-meta-ad-campaign.js";
import { createMetaAdSet } from "../dist/application/meta-ads/create-meta-ad-set.js";
import { updateMetaAdSet } from "../dist/application/meta-ads/update-meta-ad-set.js";
import { createMetaAd } from "../dist/application/meta-ads/create-meta-ad.js";
import { updateMetaAd } from "../dist/application/meta-ads/update-meta-ad.js";
import { InMemoryMetaAdAccountRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-account-repository.js";
import { InMemoryMetaAdCampaignRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-campaign-repository.js";
import { InMemoryMetaAdSetRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-set-repository.js";
import { InMemoryMetaAdRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-repository.js";
import { InMemoryMetaAdsCredentialRepository } from "../dist/infrastructure/storage/in-memory-meta-ads-credential-repository.js";

/**
 * Criação e edição de campanha/ad set/ad — Fase 3 do módulo Meta Ads Manager. Foco central destes
 * testes: a defesa estrutural contra a correção #7 do pacote de referência analisado
 * (bittencourtthulio/meta-graph-api-integration) — "o ad set de uma campanha aponta pra uma conta
 * de anúncio diferente da campanha". Aqui a conta usada na chamada à Marketing API e a usada pra
 * resolver o token vêm SEMPRE da mesma `MetaAdAccount`, resolvida internamente a partir do FK da
 * entidade pai — nunca de um parâmetro independente que o caller poderia errar.
 */

function fakeSecretManager(store) {
  return {
    async health() { return { ok: true }; },
    async put(reference, value) { store.set(reference, value); },
    async get(reference) { return store.get(reference); },
    async delete(reference) { store.delete(reference); },
  };
}

function jsonResponse(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
}

async function setup() {
  const adAccountRepository = new InMemoryMetaAdAccountRepository();
  const campaignRepository = new InMemoryMetaAdCampaignRepository();
  const adSetRepository = new InMemoryMetaAdSetRepository();
  const adRepository = new InMemoryMetaAdRepository();
  const credentialRepository = new InMemoryMetaAdsCredentialRepository();
  const secretStore = new Map();
  const secretManager = fakeSecretManager(secretStore);

  const credentialReferenceId = "meta_ads:t1:w1:meta-user-1";
  await credentialRepository.upsertCredentialReference({ credentialReferenceId, tenantId: "t1", workspaceId: "w1", providerId: "meta_ads", status: "active" });
  await secretManager.put(`meta-ads:t1:w1:${credentialReferenceId}`, { value: { accessToken: "valid-token" } });

  const adAccount = await adAccountRepository.upsertAccount({ id: "maa-1", tenantId: "t1", workspaceId: "w1", credentialReferenceId, accountId: "act_123", name: "Conta Principal", currency: "BRL", isActive: true });

  return { adAccountRepository, campaignRepository, adSetRepository, adRepository, credentialRepository, secretManager, adAccount, credentialReferenceId };
}

test("createMetaAdCampaign: cria sempre PAUSADA, mesmo sem status no input", async () => {
  let capturedParams;
  const fetchImpl = async (url, init) => {
    capturedParams = new URLSearchParams(init.body);
    return jsonResponse({ id: "cmp_new" });
  };
  const { campaignRepository, credentialRepository, secretManager, adAccount } = await setup();

  const campaign = await createMetaAdCampaign(
    { campaignRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", adAccount, name: "Campanha Nova", objective: "OUTCOME_TRAFFIC" },
  );

  assert.equal(campaign.status, "PAUSED");
  assert.equal(capturedParams.get("status"), "PAUSED");
  assert.equal(capturedParams.get("name"), "Campanha Nova");
});

test("updateMetaAdCampaign: sem campos alterados, não chama a Graph API", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse({}); };
  const { campaignRepository, adAccountRepository, credentialRepository, secretManager, adAccount } = await setup();
  const campaign = await createMetaAdCampaign(
    { campaignRepository, credentialRepository, secretManager, fetchImpl: async () => jsonResponse({ id: "cmp_1" }) },
    { tenantId: "t1", workspaceId: "w1", adAccount, name: "Campanha", objective: "OUTCOME_TRAFFIC" },
  );

  const result = await updateMetaAdCampaign(
    { campaignRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", id: campaign.id },
  );

  assert.equal(called, false);
  assert.deepEqual(result, campaign);
});

test("updateMetaAdCampaign: ativar é uma ação separada — status e nome/orçamento nunca se misturam automaticamente", async () => {
  const { campaignRepository, adAccountRepository, credentialRepository, secretManager, adAccount } = await setup();
  const campaign = await createMetaAdCampaign(
    { campaignRepository, credentialRepository, secretManager, fetchImpl: async () => jsonResponse({ id: "cmp_1" }) },
    { tenantId: "t1", workspaceId: "w1", adAccount, name: "Campanha", objective: "OUTCOME_TRAFFIC" },
  );
  assert.equal(campaign.status, "PAUSED");

  let capturedParams;
  const fetchImpl = async (url, init) => { capturedParams = new URLSearchParams(init.body); return jsonResponse({}); };
  const renamed = await updateMetaAdCampaign(
    { campaignRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", id: campaign.id, name: "Campanha Renomeada" },
  );

  assert.equal(renamed.name, "Campanha Renomeada");
  assert.equal(renamed.status, "PAUSED", "renomear não deveria ativar a campanha");
  assert.equal(capturedParams.has("status"), false);

  const activated = await updateMetaAdCampaign(
    { campaignRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", id: campaign.id, status: "ACTIVE" },
  );
  assert.equal(activated.status, "ACTIVE");
  assert.equal(capturedParams.get("status"), "ACTIVE");
});

test("createMetaAdSet: usa a conta REAL da campanha (act_id + credencial), nunca um valor independente", async () => {
  let capturedUrl;
  let capturedParams;
  const fetchImpl = async (url, init) => { capturedUrl = url; capturedParams = new URLSearchParams(init.body); return jsonResponse({ id: "adset_new" }); };
  const { campaignRepository, adSetRepository, adAccountRepository, credentialRepository, secretManager, adAccount } = await setup();

  const campaign = await createMetaAdCampaign(
    { campaignRepository, credentialRepository, secretManager, fetchImpl: async () => jsonResponse({ id: "cmp_1" }) },
    { tenantId: "t1", workspaceId: "w1", adAccount, name: "Campanha", objective: "OUTCOME_TRAFFIC" },
  );

  const adSet = await createMetaAdSet(
    { adSetRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", campaign, name: "Ad Set", optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", targeting: { geoCountries: ["BR"], ageMin: 18 } },
  );

  assert.match(capturedUrl, /\/act_123\/adsets$/);
  assert.equal(adSet.status, "PAUSED");
  assert.equal(adSet.adAccountId, adAccount.id, "FK gravado deveria ser o id INTERNO da conta, igual ao da campanha");
  assert.equal(adSet.campaignId, campaign.id);
  const targeting = JSON.parse(capturedParams.get("targeting"));
  assert.deepEqual(targeting.geo_locations.countries, ["BR"]);
  assert.equal(targeting.age_min, 18);
});

test("createMetaAdSet: rejeita quando a conta da campanha não existe mais, nunca chama a Graph API com dados incompletos", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse({ id: "adset_x" }); };
  const { adSetRepository, adAccountRepository, credentialRepository, secretManager } = await setup();
  const orphanCampaign = { id: "cmp-orphan", tenantId: "t1", workspaceId: "w1", adAccountId: "maa-does-not-exist", campaignId: "cmp_ext", name: "X", status: "PAUSED", createdAt: "x", updatedAt: "x" };

  await assert.rejects(
    () => createMetaAdSet({ adSetRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", campaign: orphanCampaign, name: "Ad Set", optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", targeting: { geoCountries: ["BR"] } }),
    /META_ADS_ACCOUNT_NOT_FOUND/,
  );
  assert.equal(called, false);
});

test("createMetaAd: link ad creative referenciando imagem via URL, PAUSADO, conta derivada do ad set", async () => {
  let capturedUrl;
  let capturedParams;
  const fetchImpl = async (url, init) => { capturedUrl = url; capturedParams = new URLSearchParams(init.body); return jsonResponse({ id: "ad_new" }); };
  const { campaignRepository, adSetRepository, adRepository, adAccountRepository, credentialRepository, secretManager, adAccount } = await setup();

  const campaign = await createMetaAdCampaign(
    { campaignRepository, credentialRepository, secretManager, fetchImpl: async () => jsonResponse({ id: "cmp_1" }) },
    { tenantId: "t1", workspaceId: "w1", adAccount, name: "Campanha", objective: "OUTCOME_TRAFFIC" },
  );
  const adSet = await createMetaAdSet(
    { adSetRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl: async () => jsonResponse({ id: "adset_1" }) },
    { tenantId: "t1", workspaceId: "w1", campaign, name: "Ad Set", optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", targeting: { geoCountries: ["BR"] } },
  );

  const ad = await createMetaAd(
    { adRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", adSet, name: "Anúncio", pageId: "page_1", creative: { link: "https://example.com/promo", headline: "Título", imageUrl: "https://example.com/img.jpg", callToActionType: "SHOP_NOW" } },
  );

  assert.match(capturedUrl, /\/act_123\/ads$/);
  assert.equal(ad.status, "PAUSED");
  assert.equal(ad.adSetId, adSet.id);
  assert.equal(ad.campaignId, campaign.id);
  const creative = JSON.parse(capturedParams.get("creative"));
  assert.equal(creative.object_story_spec.page_id, "page_1");
  assert.equal(creative.object_story_spec.link_data.link, "https://example.com/promo");
  assert.equal(creative.object_story_spec.link_data.name, "Título");
  assert.equal(creative.object_story_spec.link_data.call_to_action.type, "SHOP_NOW");
});

test("updateMetaAd: só nome/status são editáveis, sem chamada de rede quando nada muda", async () => {
  let callCount = 0;
  const fetchImpl = async () => { callCount++; return jsonResponse({ id: "ad_1" }); };
  const { campaignRepository, adSetRepository, adRepository, adAccountRepository, credentialRepository, secretManager, adAccount } = await setup();

  const campaign = await createMetaAdCampaign({ campaignRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", adAccount, name: "C", objective: "OUTCOME_TRAFFIC" });
  const adSet = await createMetaAdSet({ adSetRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", campaign, name: "AS", optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", targeting: { geoCountries: ["BR"] } });
  const ad = await createMetaAd({ adRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", adSet, name: "Anúncio", pageId: "page_1", creative: { link: "https://example.com" } });

  const before = callCount;
  const unchanged = await updateMetaAd({ adRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", id: ad.id });
  assert.equal(callCount, before, "sem campos alterados não deveria chamar a Graph API");
  assert.deepEqual(unchanged, ad);

  const activated = await updateMetaAd({ adRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", id: ad.id, status: "ACTIVE" });
  assert.equal(activated.status, "ACTIVE");
  assert.equal(callCount, before + 1);
});

test("createMetaAdSet e createMetaAd: rejeitam quando a credencial da conta não está ativa", async () => {
  const { campaignRepository, adSetRepository, adRepository, adAccountRepository, credentialRepository, secretManager, adAccount, credentialReferenceId } = await setup();
  const fetchImpl = async () => jsonResponse({ id: "x" });
  const campaign = await createMetaAdCampaign({ campaignRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", adAccount, name: "C", objective: "OUTCOME_TRAFFIC" });

  await credentialRepository.updateStatus(credentialReferenceId, "revoked");

  await assert.rejects(
    () => createMetaAdSet({ adSetRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", campaign, name: "AS", optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", targeting: { geoCountries: ["BR"] } }),
    /META_ADS_CREDENTIAL_NOT_ACTIVE/,
  );
});
