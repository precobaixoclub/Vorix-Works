import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashEmail, hashPhone, hashPiiFields } from "../dist/infrastructure/meta/hash-pii.js";
import { syncMetaCustomAudiencesForAccount } from "../dist/application/meta-ads/sync-meta-custom-audiences.js";
import { createMetaCustomAudience } from "../dist/application/meta-ads/create-meta-custom-audience.js";
import { createMetaLookalikeAudience } from "../dist/application/meta-ads/create-meta-lookalike-audience.js";
import { syncMetaPixelsForAccount } from "../dist/application/meta-ads/sync-meta-pixels.js";
import { createMetaPixel } from "../dist/application/meta-ads/create-meta-pixel.js";
import { sendMetaCapiEvent } from "../dist/application/meta-ads/send-meta-capi-event.js";
import { searchMetaAdInterests } from "../dist/application/meta-ads/search-meta-ad-interests.js";
import { InMemoryMetaAdAccountRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-account-repository.js";
import { InMemoryMetaCustomAudienceRepository } from "../dist/infrastructure/storage/in-memory-meta-custom-audience-repository.js";
import { InMemoryMetaPixelRepository } from "../dist/infrastructure/storage/in-memory-meta-pixel-repository.js";
import { InMemoryMetaCapiEventRepository } from "../dist/infrastructure/storage/in-memory-meta-capi-event-repository.js";
import { InMemoryMetaAdsCredentialRepository } from "../dist/infrastructure/storage/in-memory-meta-ads-credential-repository.js";

/** Fase 4 do módulo Meta Ads Manager: públicos customizados/semelhantes, pixels e Conversions
 * API. Foco central destes testes: PII nunca trafega crua (hash SHA-256 normalizado antes de
 * qualquer chamada de rede) e o log de auditoria de CAPI nunca guarda o hash em si. */

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
  const audienceRepository = new InMemoryMetaCustomAudienceRepository();
  const pixelRepository = new InMemoryMetaPixelRepository();
  const capiEventRepository = new InMemoryMetaCapiEventRepository();
  const credentialRepository = new InMemoryMetaAdsCredentialRepository();
  const secretStore = new Map();
  const secretManager = fakeSecretManager(secretStore);

  const credentialReferenceId = "meta_ads:t1:w1:meta-user-1";
  await credentialRepository.upsertCredentialReference({ credentialReferenceId, tenantId: "t1", workspaceId: "w1", providerId: "meta_ads", status: "active" });
  await secretManager.put(`meta-ads:t1:w1:${credentialReferenceId}`, { value: { accessToken: "valid-token" } });

  const adAccount = await adAccountRepository.upsertAccount({ id: "maa-1", tenantId: "t1", workspaceId: "w1", credentialReferenceId, accountId: "act_123", name: "Conta", currency: "BRL", isActive: true });

  return { adAccountRepository, audienceRepository, pixelRepository, capiEventRepository, credentialRepository, secretManager, adAccount, credentialReferenceId };
}

test("hashEmail: normaliza (trim + minúsculas) ANTES de hashear — mesmo hash pra 'A@B.com', ' a@b.com ' e 'a@b.com'", () => {
  const expected = createHash("sha256").update("a@b.com", "utf8").digest("hex");
  assert.equal(hashEmail("A@B.com"), expected);
  assert.equal(hashEmail(" a@b.com "), expected);
  assert.equal(hashEmail("a@b.com"), expected);
});

test("hashPhone: remove tudo que não é dígito e zeros à esquerda antes de hashear", () => {
  const expected = createHash("sha256").update("5511999998888", "utf8").digest("hex");
  assert.equal(hashPhone("+55 (11) 99999-8888"), expected);
  assert.equal(hashPhone("005511999998888"), expected);
});

test("hashPiiFields: só inclui chaves de campos presentes, nunca uma chave vazia", () => {
  const result = hashPiiFields({ email: "a@b.com" });
  assert.deepEqual(Object.keys(result), ["em"]);
  assert.equal(result.ph, undefined);
});

test("createMetaCustomAudience: lista homogênea (todos com e-mail+telefone) gera schema EMAIL+PHONE e hasheia cada linha", async () => {
  let usersPayload;
  const fetchImpl = async (url, init) => {
    if (url.includes("/users")) {
      usersPayload = JSON.parse(new URLSearchParams(init.body).get("payload"));
      return jsonResponse({});
    }
    return jsonResponse({ id: "aud_new" });
  };
  const { audienceRepository, credentialRepository, secretManager, adAccount } = await setup();

  const result = await createMetaCustomAudience(
    { audienceRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", adAccount, name: "Clientes VIP", customers: [{ email: "a@b.com", phone: "11999998888" }, { email: "c@d.com", phone: "11888887777" }] },
  );

  assert.equal(result.usersUploaded, 2);
  assert.equal(result.audience.subtype, "CUSTOM");
  assert.deepEqual(usersPayload.schema, ["EMAIL", "PHONE"]);
  assert.equal(usersPayload.data.length, 2);
  assert.equal(usersPayload.data[0][0], hashEmail("a@b.com"));
  assert.equal(usersPayload.data[0][1], hashPhone("11999998888"));
});

test("createMetaCustomAudience: lista com linhas inconsistentes (uma só com e-mail, outra só com telefone) é rejeitada antes de qualquer upload", async () => {
  let uploadCalled = false;
  const fetchImpl = async (url) => { if (url.includes("/users")) uploadCalled = true; return jsonResponse({ id: "aud_new" }); };
  const { audienceRepository, credentialRepository, secretManager, adAccount } = await setup();

  await assert.rejects(
    () => createMetaCustomAudience(
      { audienceRepository, credentialRepository, secretManager, fetchImpl },
      { tenantId: "t1", workspaceId: "w1", adAccount, name: "Lista Ruim", customers: [{ email: "a@b.com" }, { phone: "11999998888" }] },
    ),
    /META_ADS_AUDIENCE_UPLOAD_INCONSISTENT_SCHEMA/,
  );
  assert.equal(uploadCalled, false, "nunca deveria chegar a subir dado inconsistente pra Meta");
});

test("createMetaLookalikeAudience: usa SEMPRE a conta do público de origem, nunca um valor independente; rejeita ratio fora de 1%-20%", async () => {
  let capturedUrl;
  const fetchImpl = async (url) => { capturedUrl = url; return jsonResponse({ id: "aud_lookalike" }); };
  const { audienceRepository, adAccountRepository, credentialRepository, secretManager, adAccount } = await setup();

  const origin = await audienceRepository.upsertAudience({ tenantId: "t1", workspaceId: "w1", adAccountId: adAccount.id, audienceId: "aud_origin", name: "Origem", subtype: "CUSTOM" });

  const lookalike = await createMetaLookalikeAudience(
    { audienceRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", originAudience: origin, name: "Semelhante 5%", ratio: 0.05, country: "BR" },
  );

  assert.match(capturedUrl, /\/act_123\/customaudiences$/);
  assert.equal(lookalike.lookalikeOriginAudienceId, origin.id);
  assert.equal(lookalike.adAccountId, adAccount.id);

  await assert.rejects(
    () => createMetaLookalikeAudience(
      { audienceRepository, adAccountRepository, credentialRepository, secretManager, fetchImpl },
      { tenantId: "t1", workspaceId: "w1", originAudience: origin, name: "Semelhante inválido", ratio: 0.5, country: "BR" },
    ),
    /META_ADS_LOOKALIKE_RATIO_INVALID/,
  );
});

test("syncMetaCustomAudiencesForAccount: resolve lookalikeOriginAudienceId (FK interno) a partir do origin_audience_id externo, quando a origem já foi sincronizada", async () => {
  const { audienceRepository, credentialRepository, secretManager, adAccount } = await setup();
  await audienceRepository.upsertAudience({ tenantId: "t1", workspaceId: "w1", adAccountId: adAccount.id, audienceId: "aud_origin", name: "Origem", subtype: "CUSTOM" });

  const fetchImpl = async () => jsonResponse({
    data: [
      { id: "aud_origin", name: "Origem", subtype: "CUSTOM" },
      { id: "aud_lookalike", name: "Semelhante", subtype: "LOOKALIKE", approximate_count_lower_bound: 50000, lookalike_spec: { ratio: 0.02, country: "BR", origin_audience_id: "aud_origin" } },
    ],
  });

  await syncMetaCustomAudiencesForAccount({ audienceRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", adAccount });

  const all = await audienceRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  const lookalike = all.find((audience) => audience.audienceId === "aud_lookalike");
  const origin = all.find((audience) => audience.audienceId === "aud_origin");
  assert.equal(lookalike.lookalikeOriginAudienceId, origin.id);
  assert.equal(lookalike.approximateCount, 50000);
});

test("syncMetaPixelsForAccount / createMetaPixel: upsert nunca duplica, e criação usa a conta correta", async () => {
  let capturedUrl;
  const fetchImpl = async (url) => { capturedUrl = url; return jsonResponse({ id: "px_new" }); };
  const { pixelRepository, credentialRepository, secretManager, adAccount } = await setup();

  await createMetaPixel({ pixelRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", adAccount, name: "Pixel Loja" });
  assert.match(capturedUrl, /\/act_123\/adspixels$/);

  const syncFetch = async () => jsonResponse({ data: [{ id: "px_new", name: "Pixel Loja Renomeado" }] });
  await syncMetaPixelsForAccount({ pixelRepository, credentialRepository, secretManager, fetchImpl: syncFetch }, { tenantId: "t1", workspaceId: "w1", adAccount });

  const pixels = await pixelRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(pixels.length, 1, "sync do mesmo pixel nunca deveria duplicar a linha criada antes");
  assert.equal(pixels[0].name, "Pixel Loja Renomeado");
});

test("sendMetaCapiEvent: envia só hashes no corpo da chamada, e o log de auditoria guarda só os NOMES dos campos, nunca o hash", async () => {
  let capturedParams;
  const fetchImpl = async (url, init) => { capturedParams = JSON.parse(new URLSearchParams(init.body).get("data")); return jsonResponse({ events_received: 1, fbtrace_id: "trace-1" }); };
  const { pixelRepository, adAccountRepository, capiEventRepository, credentialRepository, secretManager, adAccount } = await setup();
  const pixel = await pixelRepository.upsertPixel({ tenantId: "t1", workspaceId: "w1", adAccountId: adAccount.id, pixelId: "px_1", name: "Pixel", isActive: true });

  const result = await sendMetaCapiEvent(
    { adAccountRepository, capiEventRepository, credentialRepository, secretManager, fetchImpl },
    { tenantId: "t1", workspaceId: "w1", pixel, eventName: "Purchase", userData: { email: "a@b.com", phone: "11999998888" }, customData: { value: 99.9, currency: "BRL" } },
  );

  assert.equal(result.eventsReceived, 1);
  assert.equal(capturedParams[0].user_data.em, hashEmail("a@b.com"));
  assert.equal(capturedParams[0].user_data.ph, hashPhone("11999998888"));
  assert.equal(capturedParams[0].custom_data.value, 99.9);

  const [logged] = await capiEventRepository.listByPixel({ tenantId: "t1", workspaceId: "w1", metaPixelId: pixel.id });
  assert.equal(logged.status, "sent");
  assert.deepEqual([...logged.userDataFields].sort(), ["em", "ph"]);
  assert.equal(JSON.stringify(logged).includes(hashEmail("a@b.com")), false, "o log de auditoria NUNCA deveria conter o hash em si, só os nomes dos campos");
});

test("sendMetaCapiEvent: falha na Graph API ainda registra o log de auditoria (status failed), e relança o erro", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }) });
  const { pixelRepository, adAccountRepository, capiEventRepository, credentialRepository, secretManager, adAccount } = await setup();
  const pixel = await pixelRepository.upsertPixel({ tenantId: "t1", workspaceId: "w1", adAccountId: adAccount.id, pixelId: "px_1", name: "Pixel", isActive: true });

  await assert.rejects(
    () => sendMetaCapiEvent({ adAccountRepository, capiEventRepository, credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", pixel, eventName: "Purchase", userData: { email: "a@b.com" } }),
    /Invalid OAuth access token/,
  );

  const [logged] = await capiEventRepository.listByPixel({ tenantId: "t1", workspaceId: "w1", metaPixelId: pixel.id });
  assert.equal(logged.status, "failed");
  assert.match(logged.errorMessage, /Invalid OAuth access token/);
});

test("searchMetaAdInterests: consulta com menos de 2 caracteres não chama a Graph API", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse({ data: [] }); };
  const { credentialRepository, secretManager, credentialReferenceId } = await setup();

  const results = await searchMetaAdInterests({ credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", credentialReferenceId, query: "a" });
  assert.deepEqual(results, []);
  assert.equal(called, false);
});

test("searchMetaAdInterests: devolve id/nome/tamanho de audiência a partir da busca", async () => {
  const fetchImpl = async () => jsonResponse({ data: [{ id: "int_1", name: "Fitness", audience_size_lower_bound: 1000000 }] });
  const { credentialRepository, secretManager, credentialReferenceId } = await setup();

  const results = await searchMetaAdInterests({ credentialRepository, secretManager, fetchImpl }, { tenantId: "t1", workspaceId: "w1", credentialReferenceId, query: "fitness" });
  assert.deepEqual(results, [{ id: "int_1", name: "Fitness", audienceSize: 1000000, path: undefined }]);
});
