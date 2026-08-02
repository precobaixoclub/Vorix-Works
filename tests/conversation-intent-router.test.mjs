import test from "node:test";
import assert from "node:assert/strict";

import { classifyIntent, routeIntent } from "../dist/application/conversation/intent-router.js";

test("classifyIntent: reconhece as 8 intenções mínimas + fallback unknown", () => {
  assert.equal(classifyIntent("Quero criar uma campanha nova para o lançamento").type, "create_campaign");
  assert.equal(classifyIntent("Preciso editar a campanha de verão").type, "edit_campaign");
  assert.equal(classifyIntent("Vamos começar o briefing do cliente novo?").type, "start_briefing");
  assert.equal(classifyIntent("Quais assets eu tenho disponíveis?").type, "query_assets");
  assert.equal(classifyIntent("Qual é o nosso posicionamento de marca?").type, "query_knowledge");
  assert.equal(classifyIntent("Como está configurada a integração deste workspace?").type, "query_workspace");
  assert.equal(classifyIntent("Isso funciona nos fins de semana?").type, "answer_question");
  assert.equal(classifyIntent("Só passando para dizer oi").type, "free_chat");
  assert.equal(classifyIntent("").type, "unknown");
  assert.equal(classifyIntent("   ").type, "unknown");
});

test("classifyIntent: nunca lança para texto vazio/estranho, confiança baixa em unknown", () => {
  const result = classifyIntent("");
  assert.equal(result.type, "unknown");
  assert.ok(result.confidence < 0.5);
});

test("classifyIntent: confiança alta para regra de palavra-chave; question/free_chat são classificações completas (>= limiar do Arthur), só unknown fica abaixo", () => {
  assert.ok(classifyIntent("criar uma campanha nova").confidence >= 0.9);
  assert.ok(classifyIntent("isso é possível?").confidence >= 0.5 && classifyIntent("isso é possível?").confidence < 0.9);
  assert.ok(classifyIntent("boa tarde").confidence >= 0.5);
  assert.ok(classifyIntent("").confidence < 0.5);
});

test("classifyIntent: regra que bateu fica registrada em matchedRule (explicabilidade)", () => {
  const result = classifyIntent("preciso de um briefing");
  assert.equal(result.matchedRule, "keyword:briefing");
});

test("routeIntent: mapeia cada intenção para a ação correta, nunca aciona nada — só sugere", () => {
  assert.equal(routeIntent(classifyIntent("criar campanha nova")).action, "call_caio");
  assert.equal(routeIntent(classifyIntent("editar a campanha atual")).action, "call_caio");
  assert.equal(routeIntent(classifyIntent("iniciar um briefing")).action, "start_briefing");
  assert.equal(routeIntent(classifyIntent("mostrar os assets")).action, "call_assets");
  assert.equal(routeIntent(classifyIntent("qual o nosso público-alvo")).action, "call_clara");
  assert.equal(routeIntent(classifyIntent("ver integrações do workspace")).action, "respond");
  assert.equal(routeIntent(classifyIntent("isso funciona?")).action, "respond");
  assert.equal(routeIntent(classifyIntent("oi")).action, "respond");
  assert.equal(routeIntent(classifyIntent("")).action, "request_more_context");
});

test("routeIntent: sempre devolve um motivo (reason) legível", () => {
  const command = routeIntent(classifyIntent("quais assets temos"));
  assert.equal(typeof command.reason, "string");
  assert.ok(command.reason.length > 0);
});
