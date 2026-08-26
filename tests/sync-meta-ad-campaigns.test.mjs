import test from "node:test";
import assert from "node:assert/strict";
import { syncMetaAdCampaignsForAccount, ATTRIBUTION_WINDOWS } from "../dist/application/meta-ads/sync-meta-ad-campaigns.js";
import { InMemoryMetaAdCampaignRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-campaign-repository.js";
import { InMemoryMetaAdSetRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-set-repository.js";
import { InMemoryMetaAdRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-repository.js";
import { InMemoryMetaAdsCredentialRepository } from "../dist/infrastructure/storage/in-memory-meta-ads-credential-repository.js";

/**
 * Sync de campanhas — Fase 2 do módulo Meta Ads Manager. Achado central do pacote de referência
 * analisado (bittencourtthulio/meta-graph-api-integration): números que não batem com o Ads
 * Manager quase nunca são bug de sync, é a janela de atribuição ausente. Estes testes travam que
 * TODA consulta de insights carrega `action_attribution_windows` com o valor padrão do Ads
 * Manager (7d_click,1d_view).
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

async function setup(fetchImpl) {
  const campaignRepository = new InMemoryMetaAdCampaignRepository();
  const adSetRepository = new InMemoryMetaAdSetRepository();
  const adRepository = new InMemoryMetaAdRepository();
  const credentialRepository = new InMemoryMetaAdsCredentialRepository();
  const secretStore = new Map();
  const secretManager = fakeSecretManager(secretStore);

  const credentialReferenceId = "meta_ads:t1:w1:meta-user-1";
  await credentialRepository.upsertCredentialReference({ credentialReferenceId, tenantId: "t1", workspaceId: "w1", providerId: "meta_ads", status: "active" });
  await secretManager.put(`meta-ads:t1:w1:${credentialReferenceId}`, { value: { accessToken: "valid-token" } });

  const adAccount = { id: "maa-1", tenantId: "t1", workspaceId: "w1", credentialReferenceId, accountId: "act_123", name: "Conta", currency: "BRL", isActive: true, createdAt: "x", updatedAt: "x" };

  const deps = { campaignRepository, adSetRepository, adRepository, credentialRepository, secretManager, fetchImpl };
  return { deps, adAccount, campaignRepository, adSetRepository, adRepository };
}

function graphResponseWithOneCampaign(overrides = {}) {
  return jsonResponse({
    data: [
      {
        id: "cmp_1", name: "Campanha de Teste", objective: "OUTCOME_TRAFFIC", status: "ACTIVE", effective_status: "ACTIVE",
        buying_type: "AUCTION", daily_budget: "5000", created_time: "2026-01-01T00:00:00+0000",
        insights: { data: [{ spend: "123.45", impressions: "1000", clicks: "50", reach: "800" }] },
        adsets: {
          data: [
            {
              id: "adset_1", name: "Adset de Teste", status: "ACTIVE", effective_status: "ACTIVE", optimization_goal: "LINK_CLICKS",
              billing_event: "IMPRESSIONS", daily_budget: "5000", targeting: { geo_locations: { countries: ["BR"] } },
              insights: { data: [{ spend: "123.45", impressions: "1000", clicks: "50", reach: "800" }] },
              ads: {
                data: [
                  { id: "ad_1", name: "Anúncio de Teste", status: "ACTIVE", effective_status: "ACTIVE", creative: { id: "creative_1" }, insights: { data: [{ spend: "123.45", impressions: "1000", clicks: "50", reach: "800" }] } },
                ],
              },
            },
          ],
        },
        ...overrides,
      },
    ],
  });
}

test("syncMetaAdCampaignsForAccount: toda consulta de insights inclui a janela de atribuição do Ads Manager (7d_click,1d_view)", async () => {
  let capturedUrl;
  const fetchImpl = async (url) => { capturedUrl = url; return graphResponseWithOneCampaign(); };
  const { deps, adAccount } = await setup(fetchImpl);

  await syncMetaAdCampaignsForAccount(deps, { tenantId: "t1", workspaceId: "w1", adAccount });

  assert.deepEqual(ATTRIBUTION_WINDOWS, ["7d_click", "1d_view"]);
  const decoded = decodeURIComponent(capturedUrl);
  assert.match(decoded, /action_attribution_windows\(\["7d_click","1d_view"\]\)/);
});

test("syncMetaAdCampaignsForAccount: persiste a hierarquia inteira (campanha → adset → ad) numa única chamada de rede", async () => {
  let callCount = 0;
  const fetchImpl = async () => { callCount++; return graphResponseWithOneCampaign(); };
  const { deps, adAccount, campaignRepository, adSetRepository, adRepository } = await setup(fetchImpl);

  const result = await syncMetaAdCampaignsForAccount(deps, { tenantId: "t1", workspaceId: "w1", adAccount });

  assert.equal(callCount, 1, "sync de uma conta inteira deveria ser UMA chamada de rede, nunca N+1 por campanha/adset");
  assert.deepEqual(result, { campaignsSynced: 1, adSetsSynced: 1, adsSynced: 1 });

  const [campaign] = await campaignRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(campaign.campaignId, "cmp_1");
  assert.equal(campaign.spend, 123.45);
  assert.equal(campaign.dailyBudget, 5000);

  const [adSet] = await adSetRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(adSet.adSetId, "adset_1");
  assert.equal(adSet.campaignId, campaign.id, "FK do adset deveria ser o id INTERNO da campanha, nunca o campaignId externo da Meta");

  const [ad] = await adRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(ad.adId, "ad_1");
  assert.equal(ad.adSetId, adSet.id);
  assert.equal(ad.campaignId, campaign.id, "campaignId no ad é desnormalizado — deveria bater com o da campanha real");
});

test("syncMetaAdCampaignsForAccount: campanha que sumiu da Meta é marcada deletedAt, nunca apagada — resync duas vezes com conjuntos diferentes", async () => {
  let response = graphResponseWithOneCampaign();
  const fetchImpl = async () => response;
  const { deps, adAccount, campaignRepository } = await setup(fetchImpl);

  await syncMetaAdCampaignsForAccount(deps, { tenantId: "t1", workspaceId: "w1", adAccount });
  response = jsonResponse({ data: [] }); // segunda sync: a campanha sumiu
  await syncMetaAdCampaignsForAccount(deps, { tenantId: "t1", workspaceId: "w1", adAccount });

  const active = await campaignRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  const all = await campaignRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1", includeDeleted: true });
  assert.equal(active.length, 0, "campanha sumida não deveria aparecer na listagem padrão");
  assert.equal(all.length, 1, "a linha nunca deveria ser deletada, só marcada");
  assert.ok(all[0].deletedAt);
});

test("syncMetaAdCampaignsForAccount: rejeita quando a credencial não está ativa, nunca chama a Graph API", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return graphResponseWithOneCampaign(); };
  const { deps, adAccount, campaignRepository } = await setup(fetchImpl);
  await deps.credentialRepository.updateStatus(adAccount.credentialReferenceId, "revoked");

  await assert.rejects(() => syncMetaAdCampaignsForAccount(deps, { tenantId: "t1", workspaceId: "w1", adAccount }), /META_ADS_CREDENTIAL_NOT_ACTIVE/);
  assert.equal(called, false);
  assert.deepEqual(await campaignRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" }), []);
});

test("syncMetaAdCampaignsForAccount: resincronizar (upsert) nunca duplica — mesma campanha sincronizada duas vezes gera uma linha só", async () => {
  const fetchImpl = async () => graphResponseWithOneCampaign();
  const { deps, adAccount, campaignRepository, adSetRepository, adRepository } = await setup(fetchImpl);

  await syncMetaAdCampaignsForAccount(deps, { tenantId: "t1", workspaceId: "w1", adAccount });
  await syncMetaAdCampaignsForAccount(deps, { tenantId: "t1", workspaceId: "w1", adAccount });

  assert.equal((await campaignRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" })).length, 1);
  assert.equal((await adSetRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" })).length, 1);
  assert.equal((await adRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" })).length, 1);
});
