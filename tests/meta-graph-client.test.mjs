import test from "node:test";
import assert from "node:assert/strict";
import { metaGraphRequest, metaGraphPaginate, MetaGraphError, toActAccountId, toRawAccountId, META_GRAPH_API_VERSION } from "../dist/infrastructure/meta/meta-graph-client.js";

/**
 * Cliente compartilhado da Graph API do Meta — módulo Meta Ads Manager, Fase 1. Achado da análise
 * do pacote de referência (bittencourtthulio/meta-graph-api-integration): a ausência de um cliente
 * único era exatamente o defeito #1 documentado lá. Estes testes travam que este cliente cobre
 * retry/backoff, paginação e classificação de erro — o que faltava antes.
 */

function fakeFetchSequence(responses) {
  const calls = [];
  let index = 0;
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index++;
    if (typeof next === "function") return next(url, init);
    return next;
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

test("toActAccountId: sempre normaliza para o prefixo act_, nunca duplica", () => {
  assert.equal(toActAccountId("123456"), "act_123456");
  assert.equal(toActAccountId("act_123456"), "act_123456");
});

test("toRawAccountId: remove o prefixo act_ quando presente", () => {
  assert.equal(toRawAccountId("act_123456"), "123456");
  assert.equal(toRawAccountId("123456"), "123456");
});

test("metaGraphRequest: usa a versão única declarada (META_GRAPH_API_VERSION) — nunca outra hardcoded no meio do caminho", async () => {
  let capturedUrl;
  const fetchImpl = fakeFetchSequence([(url) => { capturedUrl = url; return jsonResponse({ data: [] }); }]);
  await metaGraphRequest("/me/adaccounts", { accessToken: "tok", fetchImpl });
  assert.match(capturedUrl, new RegExp(`graph\\.facebook\\.com/${META_GRAPH_API_VERSION}/me/adaccounts`));
});

test("metaGraphRequest: GET envia parâmetros e access_token como query string", async () => {
  let capturedUrl;
  const fetchImpl = fakeFetchSequence([(url) => { capturedUrl = url; return jsonResponse({ data: [] }); }]);
  await metaGraphRequest("/me/adaccounts", { accessToken: "secret-token", params: { fields: "id,name" }, fetchImpl });
  assert.match(capturedUrl, /fields=id%2Cname/);
  assert.match(capturedUrl, /access_token=secret-token/);
});

test("metaGraphRequest: POST form-urlencoded (padrão) envia o corpo como URLSearchParams, nunca JSON — contrato da Marketing API nas criações", async () => {
  const fetchImpl = fakeFetchSequence([(url, init) => { assert.ok(init.body instanceof URLSearchParams); return jsonResponse({ id: "123" }); }]);
  await metaGraphRequest("/act_1/campaigns", { method: "POST", accessToken: "tok", params: { name: "x" }, fetchImpl });
});

test("metaGraphRequest: POST bodyFormat=json envia JSON.stringify — usado pela Conversions API/updates simples", async () => {
  const fetchImpl = fakeFetchSequence([(url, init) => { assert.equal(init.headers["content-type"], "application/json"); assert.equal(typeof init.body, "string"); return jsonResponse({ success: true }); }]);
  await metaGraphRequest("/pixel_id/events", { method: "POST", accessToken: "tok", bodyFormat: "json", params: { data: [] }, fetchImpl });
});

test("metaGraphRequest: erro transitório (code=2) tenta de novo com backoff exponencial e eventualmente sucede", async () => {
  const fetchImpl = fakeFetchSequence([
    jsonResponse({ error: { message: "temporary", code: 2, is_transient: true } }, 500),
    jsonResponse({ data: [{ id: "1" }] }),
  ]);
  const result = await metaGraphRequest("/me/adaccounts", { accessToken: "tok", fetchImpl, timeoutMs: 5000 });
  assert.deepEqual(result, { data: [{ id: "1" }] });
  assert.equal(fetchImpl.calls.length, 2);
});

test("metaGraphRequest: erro NÃO transitório (ex. token inválido, code=190) nunca reten — lança na primeira tentativa", async () => {
  const fetchImpl = fakeFetchSequence([jsonResponse({ error: { message: "Invalid OAuth", code: 190, type: "OAuthException" } }, 401)]);
  await assert.rejects(
    () => metaGraphRequest("/me/adaccounts", { accessToken: "tok", fetchImpl }),
    (error) => {
      assert.ok(error instanceof MetaGraphError);
      assert.equal(error.isTokenError, true);
      assert.equal(error.isTransient, false);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test("MetaGraphError.isRateLimit: reconhece os códigos de rate limit conhecidos da Meta (4, 17, 32, 613)", () => {
  for (const code of [4, 17, 32, 613]) {
    const error = new MetaGraphError("x", { message: "x", code }, 400);
    assert.equal(error.isRateLimit, true, `código ${code} deveria ser rate limit`);
  }
  assert.equal(new MetaGraphError("x", { message: "x", code: 100 }, 400).isRateLimit, false);
});

test("metaGraphRequest: esgota as tentativas em erro transitório persistente e lança o último erro", async () => {
  const fetchImpl = fakeFetchSequence([jsonResponse({ error: { message: "still down", code: 2, is_transient: true } }, 500)]);
  await assert.rejects(
    () => metaGraphRequest("/me/adaccounts", { accessToken: "tok", fetchImpl, retries: 2, timeoutMs: 5000 }),
    /still down/,
  );
  assert.equal(fetchImpl.calls.length, 2);
});

test("metaGraphPaginate: percorre TODAS as páginas seguindo paging.next — sem isso, contas grandes ficam truncadas silenciosamente", async () => {
  const fetchImpl = fakeFetchSequence([
    jsonResponse({ data: [{ id: "1" }], paging: { next: "https://graph.facebook.com/v21.0/me/adaccounts?after=A" } }),
    jsonResponse({ data: [{ id: "2" }], paging: { next: "https://graph.facebook.com/v21.0/me/adaccounts?after=B" } }),
    jsonResponse({ data: [{ id: "3" }] }),
  ]);
  const results = await metaGraphPaginate("/me/adaccounts", { accessToken: "tok", fetchImpl });
  assert.deepEqual(results.map((item) => item.id), ["1", "2", "3"]);
});

test("metaGraphPaginate: respeita maxPages — nunca pagina indefinidamente mesmo se paging.next nunca acabar", async () => {
  const fetchImpl = fakeFetchSequence([(url) => jsonResponse({ data: [{ id: "x" }], paging: { next: url } })]);
  const results = await metaGraphPaginate("/me/adaccounts", { accessToken: "tok", fetchImpl, maxPages: 3 });
  assert.equal(results.length, 3);
});
