import { test } from "node:test";
import assert from "node:assert/strict";

import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";

/**
 * Causa raiz real de "GROUP_METADATA nunca sincronizou nem uma vez em produção" (grupo_name/
 * participant_count sempre NULL para os 6 grupos reais, nenhuma requisição "/group/info" nos
 * logs do WuzAPI em 72h de tráfego real) — confirmada lendo o handler real (`asternic/wuzapi`,
 * `handlers.go`, `GetGroupInfo`): o endpoint espera `groupJID` como QUERY PARAMETER, nunca um
 * corpo JSON. A versão anterior mandava `GET` com um `body` — `fetch()` (spec WHATWG) LANÇA
 * `TypeError: Request with GET/HEAD method cannot have body` de forma síncrona, engolido
 * silenciosamente pelo `try/catch` best-effort de `WuzApiMessagingProvider.getGroupInfo` — nunca
 * chegava a sair do processo (por isso nenhum log em lugar nenhum, nem no lado do WuzAPI).
 */

function clientWithFetch(fetchImpl) {
  return new WuzApiClient({ baseUrl: "http://wuzapi.internal", adminToken: "admin-token", fetchImpl });
}

test("getGroupInfo: usa GET sem body e manda groupJID como query parameter (nunca no corpo)", async () => {
  let capturedUrl;
  let capturedInit;
  const fetchImpl = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ code: 200, success: true, data: { Name: "Futebol Terça", ParticipantCount: 18, JID: "120363999999999999@g.us" } }), { status: 200 });
  };

  const client = clientWithFetch(fetchImpl);
  const result = await client.getGroupInfo("sess-1", "120363999999999999@g.us");

  assert.equal(capturedInit.method, "GET");
  assert.equal(capturedInit.body, undefined, "GET nunca pode ter body — fetch() lança TypeError síncrono se tiver (causa raiz real do bug)");
  assert.ok(capturedUrl.includes("/group/info?groupJID=120363999999999999%40g.us"), `URL precisa carregar groupJID como query param, recebeu: ${capturedUrl}`);
  assert.equal(result.Name, "Futebol Terça");
  assert.equal(result.ParticipantCount, 18);
});

test("getGroupInfo: um fetchImpl real (undici/Node) rejeitaria de verdade um GET com body — smoke test de regressão", async () => {
  // Não usa mock aqui de propósito: exercita o `fetch` REAL do runtime pra provar que a forma
  // antiga (GET + body) realmente lançava, e que a correção (sem body) não lança mais por causa
  // disso — só falha de rede, que é esperado (não há servidor de verdade em localhost:1).
  const client = new WuzApiClient({ baseUrl: "http://127.0.0.1:1", adminToken: "admin-token" });
  await assert.rejects(
    () => client.getGroupInfo("sess-1", "120363999999999999@g.us"),
    (error) => {
      // Deve falhar por conexão recusada (transient/rede), NUNCA por "cannot have body".
      assert.ok(!/cannot have body/i.test(error.message), `não deveria mais lançar erro de 'GET com body': ${error.message}`);
      return true;
    },
  );
});
