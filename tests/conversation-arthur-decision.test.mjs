import test from "node:test";
import assert from "node:assert/strict";

import { decideConversationAction } from "../dist/application/conversation/arthur-conversation-decision.js";
import { classifyIntent, routeIntent } from "../dist/application/conversation/intent-router.js";

function makeContext(overrides = {}) {
  return { tenantId: "tenant-1", workspaceId: "workspace-1", turnCount: 3, referencedEntities: { campaign: "Verão" }, ...overrides };
}

test("Arthur: confirma a sugestão do Router quando a confiança é alta e há contexto suficiente", () => {
  const command = routeIntent(classifyIntent("quais assets temos disponíveis"));
  const decision = decideConversationAction(command, makeContext());
  assert.equal(decision.action, "call_assets");
  assert.equal(decision.executed, false);
});

test("Arthur: sempre pede mais contexto quando a confiança da intenção é baixa, mesmo que o Router sugira outra coisa", () => {
  const command = routeIntent(classifyIntent("boa tarde")); // free_chat, confiança baixa, ação sugerida = respond
  const decision = decideConversationAction(command, makeContext());
  // free_chat já sugere "respond", então este teste usa uma intenção fabricada com confiança baixa mas ação delegada.
  const lowConfidenceDelegation = {
    action: "call_caio",
    intent: { type: "create_campaign", confidence: 0.2, rawText: "campanha?" },
    reason: "teste",
  };
  const overridden = decideConversationAction(lowConfidenceDelegation, makeContext());
  assert.equal(overridden.action, "request_more_context");
  void command;
  void decision;
});

test("Arthur: primeira mensagem (turnCount <= 1, que já inclui a mensagem atual) sem entidade nenhuma pede mais informação antes de delegar", () => {
  const command = { action: "call_clara", intent: { type: "query_knowledge", confidence: 0.9, rawText: "marca" }, reason: "teste" };
  const decision = decideConversationAction(command, makeContext({ turnCount: 1, referencedEntities: {} }));
  assert.equal(decision.action, "request_more_context");
});

test("Arthur: com contexto (segundo turno em diante, ou entidade já referenciada), delega normalmente", () => {
  const command = { action: "call_clara", intent: { type: "query_knowledge", confidence: 0.9, rawText: "marca" }, reason: "teste" };
  const withTurns = decideConversationAction(command, makeContext({ turnCount: 2, referencedEntities: {} }));
  assert.equal(withTurns.action, "call_clara");

  const withEntity = decideConversationAction(command, makeContext({ turnCount: 1, referencedEntities: { campaign: "X" } }));
  assert.equal(withEntity.action, "call_clara");
});

test("Arthur: 'respond' e 'request_more_context' nunca são bloqueados pela regra de contexto mínimo", () => {
  const respondCommand = { action: "respond", intent: { type: "free_chat", confidence: 0.9, rawText: "oi" }, reason: "teste" };
  const decision = decideConversationAction(respondCommand, makeContext({ turnCount: 0, referencedEntities: {} }));
  assert.equal(decision.action, "respond");
});

test("Arthur: nunca executa nada — executed é sempre false", () => {
  const command = routeIntent(classifyIntent("criar campanha nova"));
  const decision = decideConversationAction(command, makeContext());
  assert.equal(decision.executed, false);
});
