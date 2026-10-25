import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE, DEFAULT_PROPOSAL_REMINDER_TEMPLATE, renderProposalMessage } from "../dist/domain/sales/proposal-message.js";
import { previewProposalWhatsappMessage } from "../dist/application/commercial/proposal-delivery-use-cases.js";
import { registerProposalsRoutes } from "../dist/interfaces/api/routes/v1/proposals.route.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";
import { WuzApiMessagingProvider } from "../dist/infrastructure/messaging/wuzapi/wuzapi-messaging-provider.js";

const vars = { nome: "Ana Souza", valor: "R$ 99,00", validade: "31/10/2026", titulo: "Plano de atendimento", proposal_link: "https://app.example/p/token" };

test("envio destaca proposta, valor, validade e link com formatação do WhatsApp", () => {
  const text = renderProposalMessage(DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE, vars);
  assert.ok(text.startsWith("Olá, Ana!\n\n*PROPOSTA COMERCIAL*"));
  assert.match(text, /Plano de atendimento/);
  assert.match(text, /\*Valor total:\* R\$ 99,00/);
  assert.match(text, /\*Válida até:\* 31\/10\/2026/);
  assert.ok(text.includes(`*Ver proposta completa*\n${vars.proposal_link}`));
  assert.ok(!text.includes("{{"));
});

test("telefones e JIDs não viram nomes na saudação; sem validade não sobra rótulo vazio", () => {
  for (const nome of [undefined, "", "+118644193411194", "+55 (11) 99999-0000", "123456789@lid"]) {
    const text = renderProposalMessage(DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE, { ...vars, nome, validade: undefined });
    assert.ok(text.startsWith("Olá!\n\n"));
    assert.ok(!text.includes("Válida até"));
    assert.ok(!text.includes("{{"));
  }
});

test("modelos personalizados mantêm seu texto e sempre incluem o link", () => {
  assert.equal(renderProposalMessage("Olá, {{nome}}!\n\nValor: {{valor}}", vars), `Olá, Ana!\n\nValor: R$ 99,00\n\n${vars.proposal_link}`);
  const text = renderProposalMessage("Olá, {{nome}}!\n\nValidade: {{validade}}\n\n{{proposal_link}}", { ...vars, nome: "+118644193411194", validade: undefined });
  assert.equal(text, `Olá!\n\n${vars.proposal_link}`);
  assert.match(renderProposalMessage(DEFAULT_PROPOSAL_REMINDER_TEMPLATE, vars), /\*Vamos conversar sobre sua proposta\?\*/);
});

function previewDeps() {
  const proposal = { id: "proposal-1", tenantId: "tenant-1", workspaceId: "workspace-1", contactId: "contact-1", title: vars.titulo, totalCents: 9900, currency: "BRL", validUntil: "2026-10-31" };
  return {
    proposalRepository: { getById: async () => proposal },
    contactRepository: { getById: async () => ({ name: "+118644193411194" }) },
    inbox: {}, appBaseUrl: "https://app.example",
  };
}

test("prévia usa o modelo do workspace sem gerar token nem registrar visualização ou envio", async () => {
  const deps = previewDeps();
  const input = { proposalId: "proposal-1", tenantId: "tenant-1", workspaceId: "workspace-1", kind: "send" };
  const preview = await previewProposalWhatsappMessage(deps, input);
  assert.ok(preview.message.startsWith("Olá!"));
  assert.ok(preview.message.includes("{{proposal_link}}"));
  assert.match(preview.message, /31\/10\/2026/);
  const custom = await previewProposalWhatsappMessage({ ...deps, messageTemplates: async () => ({ send: "Personalizado: {{valor}}\n{{proposal_link}}", reminder: "Lembrete\n{{proposal_link}}" }) }, input);
  assert.equal(custom.message, "Personalizado: R$ 99,00\n{{proposal_link}}");
  await assert.rejects(() => previewProposalWhatsappMessage(deps, { ...input, tenantId: "other" }), /PROPOSAL_NOT_FOUND/);
});

test("API de prévia valida tenant e devolve texto sem mutações", async () => {
  const app = Fastify();
  registerErrorHandler(app);
  app.addHook("onRequest", async request => { request.zunoContext = { principal: { tenantId: "tenant-1", userId: "seller", role: "admin" } }; });
  const deps = previewDeps();
  await registerProposalsRoutes(app, { ...deps, delivery: deps });
  try {
    const response = await app.inject({ method: "GET", url: "/proposals/proposal-1/whatsapp-preview?workspaceId=workspace-1&kind=send" });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().data.message.includes("*PROPOSTA COMERCIAL*"));
    assert.equal((await app.inject({ method: "GET", url: "/proposals/proposal-1/whatsapp-preview?workspaceId=other" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/proposals/proposal-1/whatsapp-preview?workspaceId=workspace-1&kind=invalid" })).statusCode, 400);
  } finally { await app.close(); }
});

test("adapter WuzAPI solicita LinkPreview apenas quando configurado", async () => {
  const bodies = [];
  const client = new WuzApiClient({ baseUrl: "https://gateway.example", adminToken: "test", fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ success: true, data: { Id: "message-1", Timestamp: "2026-10-24T12:00:00Z" } }), { status: 200 });
  } });
  const provider = new WuzApiMessagingProvider(client);
  await provider.sendText({ externalSessionId: "session", to: "5511999999999", body: vars.proposal_link, linkPreview: true });
  await provider.sendText({ externalSessionId: "session", to: "5511999999999", body: "Mensagem comum" });
  assert.equal(bodies[0].LinkPreview, true);
  assert.ok(!("LinkPreview" in bodies[1]));
});
