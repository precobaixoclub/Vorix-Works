import { test } from "node:test";
import assert from "node:assert/strict";

import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";

/**
 * Bloco "3 pontinhos em cada mensagem" (pedido explícito do usuário em produção: excluir/responder/
 * reagir a uma mensagem específica) — confirmado lendo o código-fonte real do WuzAPI via `gh api`
 * (`handlers.go`, `SendMessage()`/`React()`/`DeleteMessage()`, e `validateMessageFields`): trava o
 * formato exato do payload que cada endpoint espera, contra um `fetch` fake (nunca um WuzAPI real).
 */

function clientWithFetch(fetchImpl) {
  return new WuzApiClient({ baseUrl: "http://wuzapi.internal", adminToken: "admin-token", fetchImpl });
}

function okEnvelope(data) {
  return new Response(JSON.stringify({ code: 200, success: true, data }), { status: 200 });
}

test("sendText sem replyTo: body só {Phone, Body}, sem ContextInfo/QuotedText", async () => {
  let capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Id: "wamid-1", Timestamp: "123" });
  });

  await client.sendText("sess-1", { phone: "5511999998888", body: "Oi" });

  assert.deepEqual(capturedBody, { Phone: "5511999998888", Body: "Oi" });
});

test("sendText com replyTo: inclui ContextInfo {StanzaId, Participant} e QuotedText quando fornecido", async () => {
  let capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Id: "wamid-2", Timestamp: "123" });
  });

  await client.sendText("sess-1", {
    phone: "5511999998888",
    body: "Abrimos às 9h!",
    replyTo: { stanzaId: "wamid-original-1", participant: "+5511988887777", quotedText: "Qual o horário de vocês?" },
  });

  assert.deepEqual(capturedBody, {
    Phone: "5511999998888",
    Body: "Abrimos às 9h!",
    ContextInfo: { StanzaId: "wamid-original-1", Participant: "+5511988887777" },
    QuotedText: "Qual o horário de vocês?",
  });
});

test("sendText com replyTo sem participant: ContextInfo.Participant vira string vazia (StanzaId nunca sozinho — validateMessageFields exige os dois)", async () => {
  let capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Id: "wamid-3", Timestamp: "123" });
  });

  await client.sendText("sess-1", { phone: "5511999998888", body: "Respondendo", replyTo: { stanzaId: "wamid-original-2" } });

  assert.deepEqual(capturedBody.ContextInfo, { StanzaId: "wamid-original-2", Participant: "" });
  assert.equal(capturedBody.QuotedText, undefined);
});

test("sendReaction: POST /chat/react com {Phone, Body: emoji, Id} — sem prefixo 'me:' quando fromMe é falso", async () => {
  let capturedUrl, capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Details: "Sent", Id: "wamid-alvo", Timestamp: "123" });
  });

  await client.sendReaction("sess-1", { phone: "5511999998888", externalMessageId: "wamid-alvo", emoji: "👍", fromMe: false });

  assert.equal(capturedUrl, "http://wuzapi.internal/chat/react");
  assert.deepEqual(capturedBody, { Phone: "5511999998888", Body: "👍", Id: "wamid-alvo" });
});

test("sendReaction: fromMe true prefixa o Id com 'me:' (achado real do handler React())", async () => {
  let capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Details: "Sent", Id: "wamid-alvo-2", Timestamp: "123" });
  });

  await client.sendReaction("sess-1", { phone: "5511999998888", externalMessageId: "wamid-alvo-2", emoji: "❤️", fromMe: true });

  assert.deepEqual(capturedBody, { Phone: "5511999998888", Body: "❤️", Id: "me:wamid-alvo-2" });
});

test("sendReaction: Participant só é enviado quando fromMe é falso E participantJid foi fornecido (grupo, mensagem de outro participante)", async () => {
  let capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Details: "Sent", Id: "wamid-alvo-3", Timestamp: "123" });
  });

  await client.sendReaction("sess-1", { phone: "120363999@g.us", externalMessageId: "wamid-alvo-3", emoji: "👍", fromMe: false, participantJid: "+5511988887777" });

  assert.deepEqual(capturedBody, { Phone: "120363999@g.us", Body: "👍", Id: "wamid-alvo-3", Participant: "+5511988887777" });
});

test("sendReaction: participantJid é ignorado quando fromMe é true (nunca reage 'de nós mesmos' com Participant)", async () => {
  let capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Details: "Sent", Id: "wamid-alvo-4", Timestamp: "123" });
  });

  await client.sendReaction("sess-1", { phone: "120363999@g.us", externalMessageId: "wamid-alvo-4", emoji: "👍", fromMe: true, participantJid: "+5511988887777" });

  assert.deepEqual(capturedBody, { Phone: "120363999@g.us", Body: "👍", Id: "me:wamid-alvo-4" });
});

test("sendReaction: emoji vazio vira o sentinela literal 'remove' (a API real rejeita Body:'' como campo obrigatório ausente)", async () => {
  let capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Details: "Sent", Id: "wamid-alvo-5", Timestamp: "123" });
  });

  await client.sendReaction("sess-1", { phone: "5511999998888", externalMessageId: "wamid-alvo-5", emoji: "", fromMe: false });

  assert.equal(capturedBody.Body, "remove");
});

test("deleteMessage: POST /chat/delete com {Phone, Id} — sem Participant/fromMe (a API real não suporta revogar mensagem de outra pessoa)", async () => {
  let capturedUrl, capturedBody;
  const client = clientWithFetch(async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return okEnvelope({ Details: "Deleted", Id: "wamid-del-1", Timestamp: "123" });
  });

  await client.deleteMessage("sess-1", { phone: "5511999998888", externalMessageId: "wamid-del-1" });

  assert.equal(capturedUrl, "http://wuzapi.internal/chat/delete");
  assert.deepEqual(capturedBody, { Phone: "5511999998888", Id: "wamid-del-1" });
});
