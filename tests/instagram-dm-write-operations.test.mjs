import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyMetaWebhookSignature } from "../dist/infrastructure/meta/meta-webhook-signature-verifier.js";
import { receiveInstagramDmWebhook } from "../dist/application/instagram-dm/receive-instagram-dm-webhook.js";
import { matchAndSendAutomationReply } from "../dist/application/instagram-dm/match-and-send-automation-reply.js";
import { sendInstagramDm } from "../dist/application/instagram-dm/send-instagram-dm.js";
import { generateAiDmReply } from "../dist/application/instagram-dm/generate-ai-dm-reply.js";
import { InMemoryInstagramDmAccountRouteRepository } from "../dist/infrastructure/storage/in-memory-instagram-dm-account-route-repository.js";
import { InMemoryInstagramDmConversationRepository } from "../dist/infrastructure/storage/in-memory-instagram-dm-conversation-repository.js";
import { InMemoryInstagramDmMessageRepository } from "../dist/infrastructure/storage/in-memory-instagram-dm-message-repository.js";
import { InMemoryInstagramDmAutomationRuleRepository } from "../dist/infrastructure/storage/in-memory-instagram-dm-automation-rule-repository.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";

/**
 * Módulo Instagram DM Automation (Fase 5). Foco central: (1) a assinatura HMAC da Meta é verificada
 * corretamente sobre os bytes crus; (2) `is_echo` nunca reprocessa a própria mensagem enviada;
 * (3) `automationMuted` nunca é resetado por uma mensagem nova chegando; (4) a automação nunca
 * responde duas vezes nem dispara quando muted.
 */

function jsonResponse(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
}

test("verifyMetaWebhookSignature: aceita HMAC-SHA256 válido sobre os bytes crus, rejeita corpo alterado ou segredo errado", () => {
  const appSecret = "app-secret-1";
  const rawBody = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));
  const validHeader = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: validHeader }), true);
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody: Buffer.from(rawBody.toString() + " "), signatureHeader: validHeader }), false, "corpo alterado deveria invalidar a assinatura");
  assert.equal(verifyMetaWebhookSignature({ appSecret: "outro-secret", rawBody, signatureHeader: validHeader }), false);
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: undefined }), false);
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: "sha1=deadbeef" }), false, "algoritmo errado deveria ser rejeitado");
});

async function setup() {
  const accountRouteRepository = new InMemoryInstagramDmAccountRouteRepository();
  const conversationRepository = new InMemoryInstagramDmConversationRepository();
  const messageRepository = new InMemoryInstagramDmMessageRepository();
  const automationRuleRepository = new InMemoryInstagramDmAutomationRuleRepository();
  const publicationRepository = new InMemoryPublicationRepository();
  const publicationSecretStore = new LocalPublicationSecretStore();

  await accountRouteRepository.upsertRoute({ instagramBusinessAccountId: "ig_1", tenantId: "t1", workspaceId: "w1" });
  await publicationRepository.createCredentialReference({
    credentialReferenceId: "instagram:t1:w1:ig_1", tenantId: "t1", workspaceId: "w1", providerId: "instagram", status: "active", providerSubjectId: "ig_1",
  });
  await publicationSecretStore.put({
    credentialReferenceId: "instagram:t1:w1:ig_1", tenantId: "t1", workspaceId: "w1", providerId: "instagram",
    value: { accessToken: "page-token", instagramBusinessAccountId: "ig_1", displayName: "@loja.vorix" },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  return { accountRouteRepository, conversationRepository, messageRepository, automationRuleRepository, publicationRepository, publicationSecretStore };
}

test("receiveInstagramDmWebhook: conta sem rota conhecida é ignorada silenciosamente, nunca lança erro", async () => {
  const deps = await setup();
  const fetchImpl = async () => { throw new Error("nunca deveria chamar a Graph API"); };
  const payload = { object: "instagram", entry: [{ id: "ig_desconhecida", messaging: [{ sender: { id: "psid_1" }, message: { text: "oi" } }] }] };

  const result = await receiveInstagramDmWebhook({ ...deps, fetchImpl }, payload);
  assert.deepEqual(result, { processed: 0, skipped: 1, automationReplies: 0 });
});

test("receiveInstagramDmWebhook: mensagem is_echo (própria mensagem ecoada) nunca é reprocessada nem dispara automação", async () => {
  const deps = await setup();
  const fetchImpl = async () => { throw new Error("nunca deveria chamar a Graph API"); };
  const payload = { object: "instagram", entry: [{ id: "ig_1", messaging: [{ sender: { id: "ig_1" }, recipient: { id: "psid_1" }, message: { mid: "mid_echo", text: "resposta que EU mandei", is_echo: true } }] }] };

  const result = await receiveInstagramDmWebhook({ ...deps, fetchImpl }, payload);
  assert.deepEqual(result, { processed: 0, skipped: 1, automationReplies: 0 });
  assert.deepEqual(await deps.conversationRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" }), []);
});

test("receiveInstagramDmWebhook: nova mensagem cria conversa (unread=true) e registra a mensagem inbound", async () => {
  const deps = await setup();
  const fetchImpl = async () => jsonResponse({ id: "ig_1" });
  const payload = { object: "instagram", entry: [{ id: "ig_1", messaging: [{ sender: { id: "psid_1" }, recipient: { id: "ig_1" }, timestamp: 1700000000000, message: { mid: "mid_1", text: "quanto custa?" } }] }] };

  const result = await receiveInstagramDmWebhook({ ...deps, fetchImpl }, payload);
  assert.equal(result.processed, 1);

  const [conversation] = await deps.conversationRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(conversation.participantId, "psid_1");
  assert.equal(conversation.unread, true);
  assert.equal(conversation.lastMessageFrom, "user");

  const messages = await deps.messageRepository.listByConversation({ tenantId: "t1", workspaceId: "w1", conversationId: conversation.id });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].messageText, "quanto custa?");
});

test("receiveInstagramDmWebhook: automationMuted de uma conversa existente NUNCA é resetado por uma mensagem nova chegando", async () => {
  const deps = await setup();
  await deps.conversationRepository.upsertConversation({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: false, automationMuted: true });

  const fetchImpl = async () => { throw new Error("nunca deveria chamar a Graph API — automação está muted"); };
  const payload = { object: "instagram", entry: [{ id: "ig_1", messaging: [{ sender: { id: "psid_1" }, message: { mid: "mid_2", text: "oi de novo" } }] }] };
  await receiveInstagramDmWebhook({ ...deps, fetchImpl }, payload);

  const [conversation] = await deps.conversationRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(conversation.automationMuted, true, "mensagem nova nunca deveria reativar a automação sozinha");
});

test("matchAndSendAutomationReply: regras avaliadas por priority, primeira que casar vence — nunca duas respostas", async () => {
  const deps = await setup();
  await deps.automationRuleRepository.upsertRule({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", name: "genérica", enabled: true, matchType: "contains", keywords: ["o"], replyMode: "fixed", replyText: "genérica", priority: 5 });
  await deps.automationRuleRepository.upsertRule({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", name: "saudação", enabled: true, matchType: "exact", keywords: ["oi"], replyMode: "fixed", replyText: "Olá! Como posso ajudar?", priority: 1 });

  let sendCount = 0;
  const fetchImpl = async () => { sendCount++; return jsonResponse({ message_id: "mid_out" }); };
  const conversation = await deps.conversationRepository.upsertConversation({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });

  const result = await matchAndSendAutomationReply({ ...deps, fetchImpl }, { tenantId: "t1", workspaceId: "w1", conversation, incomingText: "oi" });
  assert.equal(result.matched, true);
  assert.equal(result.rule.name, "saudação", "regra de menor priority deveria vencer, mesmo com a genérica também batendo");
  assert.equal(result.message.messageText, "Olá! Como posso ajudar?");
  assert.equal(sendCount, 1, "nunca deveria mandar duas respostas pra uma mensagem só");
});

test("matchAndSendAutomationReply: conversa muted nunca dispara automação, mesmo com regra batendo", async () => {
  const deps = await setup();
  await deps.automationRuleRepository.upsertRule({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", name: "saudação", enabled: true, matchType: "exact", keywords: ["oi"], replyMode: "fixed", replyText: "Olá!", priority: 1 });
  const conversation = await deps.conversationRepository.upsertConversation({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: true });

  const fetchImpl = async () => { throw new Error("nunca deveria chamar a Graph API"); };
  const result = await matchAndSendAutomationReply({ ...deps, fetchImpl }, { tenantId: "t1", workspaceId: "w1", conversation, incomingText: "oi" });
  assert.deepEqual(result, { matched: false, skippedReason: "AUTOMATION_MUTED" });
});

test("matchAndSendAutomationReply: replyMode 'ai' chama o provider e envia o texto gerado; sem provider configurado, pula sem erro", async () => {
  const deps = await setup();
  await deps.automationRuleRepository.upsertRule({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", name: "ia", enabled: true, matchType: "contains", keywords: ["horário"], replyMode: "ai", aiInstructions: "responda com o horário 9h-18h", priority: 1 });
  const conversation = await deps.conversationRepository.upsertConversation({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });
  const fetchImpl = async () => jsonResponse({ message_id: "mid_out" });

  const withoutProvider = await matchAndSendAutomationReply({ ...deps, fetchImpl }, { tenantId: "t1", workspaceId: "w1", conversation, incomingText: "qual o horário?" });
  assert.deepEqual(withoutProvider, { matched: true, rule: withoutProvider.rule, skippedReason: "AI_REPLY_NOT_CONFIGURED" });

  let capturedPrompt;
  const aiReplyProvider = { execute: async (request) => { capturedPrompt = request.prompt; return { content: "Funcionamos das 9h às 18h!", model: "fake" }; } };
  const withProvider = await matchAndSendAutomationReply({ ...deps, fetchImpl, aiReplyProvider }, { tenantId: "t1", workspaceId: "w1", conversation, incomingText: "qual o horário?" });
  assert.equal(withProvider.matched, true);
  assert.equal(withProvider.message.messageText, "Funcionamos das 9h às 18h!");
  assert.match(capturedPrompt, /responda com o horário 9h-18h/);
});

test("sendInstagramDm: resolve a credencial ativa da conta e chama a Marketing API com recipient/message corretos", async () => {
  const deps = await setup();
  let capturedUrl, capturedParams;
  const fetchImpl = async (url, init) => { capturedUrl = url; capturedParams = Object.fromEntries(new URLSearchParams(init.body)); return jsonResponse({ message_id: "mid_out" }); };
  const conversation = await deps.conversationRepository.upsertConversation({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });

  const message = await sendInstagramDm({ ...deps, fetchImpl }, { tenantId: "t1", workspaceId: "w1", conversation, text: "Olá, tudo bem?", sender: "page" });

  assert.match(capturedUrl, /\/ig_1\/messages$/);
  const recipient = JSON.parse(capturedParams.recipient);
  assert.equal(recipient.id, "psid_1");
  assert.equal(JSON.parse(capturedParams.message).text, "Olá, tudo bem?");
  assert.equal(message.direction, "outbound");
  assert.equal(message.sender, "page");

  const [updatedConversation] = await deps.conversationRepository.listByWorkspace({ tenantId: "t1", workspaceId: "w1" });
  assert.equal(updatedConversation.lastMessageFrom, "page");
  assert.equal(updatedConversation.unread, false);
});

test("sendInstagramDm: rejeita quando não há credencial ativa do Instagram para a conta", async () => {
  const conversationRepository = new InMemoryInstagramDmConversationRepository();
  const messageRepository = new InMemoryInstagramDmMessageRepository();
  const publicationRepository = new InMemoryPublicationRepository();
  const publicationSecretStore = new LocalPublicationSecretStore();
  const conversation = await conversationRepository.upsertConversation({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_sem_credencial", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });

  await assert.rejects(
    () => sendInstagramDm({ conversationRepository, messageRepository, publicationRepository, publicationSecretStore, fetchImpl: async () => jsonResponse({}) }, { tenantId: "t1", workspaceId: "w1", conversation, text: "oi", sender: "page" }),
    /INSTAGRAM_DM_CREDENTIAL_NOT_ACTIVE/,
  );
});

test("sendInstagramDm: rejeita texto vazio ou longo demais antes de qualquer chamada de rede", async () => {
  const deps = await setup();
  const conversation = await deps.conversationRepository.upsertConversation({ tenantId: "t1", workspaceId: "w1", instagramBusinessAccountId: "ig_1", participantId: "psid_1", lastMessageFrom: "user", unread: true, automationMuted: false });
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse({}); };

  await assert.rejects(() => sendInstagramDm({ ...deps, fetchImpl }, { tenantId: "t1", workspaceId: "w1", conversation, text: "   ", sender: "page" }), /INSTAGRAM_DM_TEXT_EMPTY/);
  await assert.rejects(() => sendInstagramDm({ ...deps, fetchImpl }, { tenantId: "t1", workspaceId: "w1", conversation, text: "x".repeat(1001), sender: "page" }), /INSTAGRAM_DM_TEXT_TOO_LONG/);
  assert.equal(called, false);
});

test("generateAiDmReply: retorna o texto gerado (trim) e lança quando o provider não devolve conteúdo", async () => {
  const provider = { execute: async () => ({ content: "  Claro, te ajudo!  ", model: "fake" }) };
  const reply = await generateAiDmReply(provider, { incomingMessage: "oi", accountName: "Loja" });
  assert.equal(reply, "Claro, te ajudo!");

  const emptyProvider = { execute: async () => ({ content: "", model: "fake" }) };
  await assert.rejects(() => generateAiDmReply(emptyProvider, { incomingMessage: "oi" }), /INSTAGRAM_DM_AI_REPLY_EMPTY/);
});
