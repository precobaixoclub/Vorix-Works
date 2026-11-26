import test from "node:test";
import assert from "node:assert/strict";
import { approvalCode, matchPendingRequest, parseApprovalReply } from "../dist/application/approvals/whatsapp-approval.js";
import { canonicalApprovalPhone, captureApprovalReply, deliverToApprover, isApprovalEcho, whatsappPhoneVariants, WhatsappApprovalService } from "../dist/application/approvals/whatsapp-approval-service.js";

// Aprovação de publicações pelo WhatsApp (25/11/2026): número da CONTA, regra por MARCA. Tudo simulado —
// nenhum WhatsApp real, nenhuma publicação real.

const APPROVER = "+55 (11) 98888-7777";
const PHONE = canonicalApprovalPhone(APPROVER);

function fakeRepository() {
  const state = { outbound: new Set(), outboundRequest: new Map(), settings: new Map(), rules: new Map(), requests: [], members: [{ userId: "u-owner", name: "Dono", role: "owner" }, { userId: "u-viewer", name: "Leitor", role: "viewer" }], toRequest: [] };
  const repo = {
    state,
    async getSettings(tenantId) { return state.settings.get(tenantId); },
    async saveSettings(input) { state.settings.set(input.tenantId, { tenantId: input.tenantId, enabled: input.enabled, connectionId: input.connectionId }); return state.settings.get(input.tenantId); },
    async listRules(tenantId) { return [...state.rules.values()].filter((rule) => rule.tenantId === tenantId); },
    async getRule(tenantId, workspaceId) { return state.rules.get(`${tenantId}:${workspaceId}`); },
    async saveRule(input) { const rule = { ...input, enabledAt: input.enabled ? "2026-11-25T10:00:00Z" : undefined }; state.rules.set(`${input.tenantId}:${input.workspaceId}`, rule); return rule; },
    async listMembers() { return state.members; },
    async listPublicationsToRequest() { return state.toRequest.filter((item) => !state.requests.some((request) => request.publicationId === item.publicationId)); },
    async createRequest(input) { if (state.requests.some((request) => request.publicationId === input.publicationId)) return undefined; const request = { ...input, status: input.status ?? "pending", createdAt: new Date().toISOString() }; state.requests.push(request); return request; },
    async updateRequest(id, patch) { Object.assign(state.requests.find((request) => request.id === id), Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))); },
    async decideRequest(id, decision, reason) { const request = state.requests.find((item) => item.id === id); if (request.status !== "sent") return false; Object.assign(request, { status: "decided", decision, reason }); return true; },
    async listOpenByPhone(connectionId, phone) { return state.requests.filter((request) => request.connectionId === connectionId && request.approverPhone === phone && request.status === "sent"); },
    async listByStatus(status) { return state.requests.filter((request) => request.status === status); },
    async listRecent() { return state.requests; },
    async recordOutbound(connectionId, ids, requestId) { for (const id of ids) { state.outbound.add(`${connectionId}:${id}`); if (requestId) state.outboundRequest.set(`${connectionId}:${id}`, requestId); } },
    async requestForOutbound(connectionId, id) { const requestId = state.outboundRequest.get(`${connectionId}:${id}`); return state.requests.find((request) => request.id === requestId); },
    async isApprovalOutbound(connectionId, id) { return state.outbound.has(`${connectionId}:${id}`); },
    async hasRecentApprovalActivity() { return state.recentActivity === true; },
    async isApproverPhone(connectionId, phone) { return [...state.rules.values()].some((rule) => rule.approverPhone === phone) && [...state.settings.values()].some((item) => item.connectionId === connectionId); },
  };
  return repo;
}

function setup({ scheduledAt = "2026-11-25T22:00:00Z", now = "2026-11-25T18:00:00Z" } = {}) {
  const repository = fakeRepository();
  const sent = [];
  const actions = [];
  const posts = new Map([["pub-1", { state: "AWAITING_APPROVAL", scheduledAt, timezone: "America/Sao_Paulo", caption: "Nova estampa", networks: ["instagram", "facebook"], media: [{ url: "https://api/x.jpg", kind: "image" }] }]]);
  let seq = 0;
  const service = new WhatsappApprovalService({
    repository,
    connections: {
      async getById(id) { return id === "conn-vorix" ? { id, tenantId: "t1", workspaceId: "ws-vorix", provider: "wuzapi", externalSessionId: "sess", displayName: "WhatsApp Vorix", status: "connected" } : undefined; },
      async listByWorkspace({ workspaceId }) { return workspaceId === "ws-vorix" ? [{ id: "conn-vorix", tenantId: "t1", workspaceId, provider: "wuzapi", externalSessionId: "sess", displayName: "WhatsApp Vorix", status: "connected" }] : []; },
    },
    workspaces: {
      async getById(id) { return { "ws-vorix": { id, tenantId: "t1", name: "Vorix Works", status: "active" }, "ws-cmkv": { id, tenantId: "t1", name: "CMKV Wears", status: "active" }, "ws-outro": { id, tenantId: "t2", name: "Outra conta", status: "active" } }[id]; },
      async listByTenant() { return [{ id: "ws-vorix", tenantId: "t1", name: "Vorix Works", status: "active" }, { id: "ws-cmkv", tenantId: "t1", name: "CMKV Wears", status: "active" }]; },
    },
    provider: {
      async sendText(input) { sent.push({ type: "text", ...input }); return { externalMessageId: `m${sent.length}` }; },
      async sendImage(input) { sent.push({ type: "image", to: input.to, mediaUrl: input.mediaUrl.slice(0, 30) }); return { externalMessageId: `m${sent.length}` }; },
    },
    posts: {
      async get({ postId }) { const post = posts.get(postId); if (!post) throw new Error("not found"); return post; },
      async approve(input) { actions.push({ action: "approve", ...input }); posts.get(input.postId).state = "SCHEDULED"; },
      async cancel(input) { actions.push({ action: "cancel", ...input }); posts.get(input.postId).state = "CANCELLED"; },
    },
    loadMedia: async () => ({ data: Buffer.from("jpeg"), mimeType: "image/jpeg" }),
    idGenerator: () => `req-${++seq}`,
    now: () => new Date(now),
  });
  return { service, repository, sent, actions, posts };
}

async function configure(service) {
  await service.saveSettings({ tenantId: "t1", enabled: true, connectionId: "conn-vorix", actorUserId: "u-owner" });
  await service.saveRule({ tenantId: "t1", workspaceId: "ws-cmkv", enabled: true, approverUserId: "u-owner", approverPhone: APPROVER, onTimeout: "skip", actorUserId: "u-owner" });
}

test("leitura da resposta: 1/sim aprova, 2/não reprova com motivo, código em qualquer posição; conversa comum não é resposta", () => {
  assert.deepEqual(parseApprovalReply("1"), { decision: "approve" });
  assert.deepEqual(parseApprovalReply("Sim!"), { decision: "approve" });
  assert.deepEqual(parseApprovalReply("pode publicar"), { decision: "approve" });
  assert.deepEqual(parseApprovalReply("2 cor errada na arte"), { decision: "reject", reason: "cor errada na arte" });
  assert.deepEqual(parseApprovalReply("K7QZ 2 - legenda com erro"), { decision: "reject", code: "K7QZ", reason: "legenda com erro" });
  assert.deepEqual(parseApprovalReply("1 k7qz"), { decision: "approve", code: "K7QZ" });
  assert.equal(parseApprovalReply("Oi, tudo bem? Quero um orçamento"), undefined);
  assert.equal(parseApprovalReply("12"), undefined);
  assert.equal(parseApprovalReply(""), undefined);
  for (let index = 0; index < 50; index += 1) { const code = approvalCode(); assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/); assert.match(code, /\d/); assert.match(code, /[A-Z]/); }
  assert.deepEqual(matchPendingRequest([{ code: "A1B2" }, { code: "C3D4" }], { decision: "approve" }), { ambiguous: ["A1B2", "C3D4"] });
});

test("configuração: número da conta (de outro espaço de trabalho) + regra por marca; validações de permissão e telefone", async () => {
  const { service } = setup();
  await assert.rejects(service.saveSettings({ tenantId: "t1", enabled: true, actorUserId: "u-owner" }), /WHATSAPP_APPROVAL_CONNECTION_REQUIRED/);
  await assert.rejects(service.saveSettings({ tenantId: "t2", enabled: true, connectionId: "conn-vorix", actorUserId: "u-owner" }), /CONNECTION_INVALID/);
  await configure(service);
  assert.equal(await service.requiresApproval({ tenantId: "t1", workspaceId: "ws-cmkv" }), true, "CMKV (sem Conversas) exige aprovação pelo número da Vorix");
  assert.equal(await service.requiresApproval({ tenantId: "t1", workspaceId: "ws-vorix" }), false);
  await assert.rejects(service.saveRule({ tenantId: "t1", workspaceId: "ws-vorix", enabled: true, approverUserId: "u-viewer", approverPhone: APPROVER, onTimeout: "skip", actorUserId: "u-owner" }), /APPROVER_INVALID/);
  await assert.rejects(service.saveRule({ tenantId: "t1", workspaceId: "ws-vorix", enabled: true, approverUserId: "u-owner", approverPhone: "abc", onTimeout: "skip", actorUserId: "u-owner" }), /PHONE_INVALID/);
  await assert.rejects(service.saveRule({ tenantId: "t1", workspaceId: "ws-outro", enabled: false, onTimeout: "skip", actorUserId: "u-owner" }), /WORKSPACE_INVALID/);
  const overview = await service.overview("t1");
  assert.equal(overview.connections[0].workspaceName, "Vorix Works");
  assert.deepEqual(overview.approvers.map((approver) => approver.userId), ["u-owner"]);
});

test("fluxo completo: pedido com imagem e código → resposta '1' capturada no worker → publicação aprovada e confirmação", async () => {
  const { service, repository, sent, actions } = setup();
  await configure(service);
  repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-1" });
  assert.equal(await service.dispatchPending(), 1);
  const request = repository.state.requests[0];
  assert.equal(request.status, "sent");
  assert.equal(sent[0].type, "image");
  assert.equal(sent[0].to, PHONE);
  assert.match(sent[1].body, /Aprovação de publicação — CMKV Wears/);
  assert.match(sent[1].body, /Instagram \+ Facebook · agendada para 25\/11 às 19:00/);
  assert.match(sent[1].body, new RegExp(`Código: \\*${request.code}\\*`));
  // Pedido não é reenviado.
  assert.equal(await service.dispatchPending(), 0);
  // Mensagem comum do aprovador segue para o atendimento.
  assert.deepEqual(await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "+5511988887777", text: "bom dia", isGroup: false, fromMe: false }), { handled: false });
  // Outro número respondendo "1" não aprova nada.
  assert.equal((await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "+5511977776666", text: "1", isGroup: false, fromMe: false })).handled, false);
  const capture = await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "5511988887777@s.whatsapp.net", text: "1", isGroup: false, fromMe: false });
  assert.deepEqual(capture, { handled: true, requestId: request.id });
  assert.equal(await service.applyDecisions(), 1);
  assert.equal(actions[0].action, "approve");
  assert.deepEqual(actions[0].actor, { userId: "u-owner", role: "owner" });
  assert.match(sent.at(-1).body, /✅ Aprovado — CMKV Wears\. Será publicado em 25\/11 às 19:00/);
  assert.equal(request.status, "applied");
  // Resposta repetida depois de encerrado: não muda nada.
  assert.equal((await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "+5511988887777", text: "2", isGroup: false, fromMe: false })).handled, false);
});

test("reprovação com motivo cancela; dois pedidos abertos exigem o código; prazo sem resposta segue a regra da marca", async () => {
  const { service, repository, sent, actions, posts } = setup();
  await configure(service);
  posts.set("pub-2", { ...posts.get("pub-1") });
  repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-1" }, { tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-2" });
  await service.dispatchPending();
  const [first, second] = repository.state.requests;
  const ambiguous = await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "+5511988887777", text: "2", isGroup: false, fromMe: false });
  assert.equal(ambiguous.handled, true);
  assert.match(ambiguous.reply, new RegExp(`${first.code}.*${second.code}`));
  await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "+5511988887777", text: `2 ${second.code} estampa cortada`, isGroup: false, fromMe: false });
  await service.applyDecisions();
  assert.deepEqual(actions.map((action) => [action.action, action.postId]), [["cancel", "pub-2"]]);
  assert.match(sent.at(-1).body, /Reprovado — CMKV Wears.*estampa cortada/);
  // Prazo: falta mais de 90 s → nada; perto do horário → "não publica" cancela e avisa.
  assert.equal(await service.expireDue(), 0);
  posts.get("pub-1").scheduledAt = "2026-11-25T18:01:00Z";
  assert.equal(await service.expireDue(), 1);
  assert.deepEqual(actions.at(-1).action, "cancel");
  assert.match(sent.at(-1).body, /Sem resposta — CMKV Wears: a publicação das 25\/11 às 15:01 não foi feita/);
  assert.equal(first.status, "expired");
});

test("prazo com regra 'publicar mesmo assim' aprova automaticamente; aprovador sem permissão nunca aprova", async () => {
  const { service, repository, actions, sent } = setup({ scheduledAt: "2026-11-25T18:01:00Z" });
  await service.saveSettings({ tenantId: "t1", enabled: true, connectionId: "conn-vorix", actorUserId: "u-owner" });
  await service.saveRule({ tenantId: "t1", workspaceId: "ws-cmkv", enabled: true, approverUserId: "u-owner", approverPhone: APPROVER, onTimeout: "publish", actorUserId: "u-owner" });
  repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-1" });
  await service.dispatchPending();
  assert.equal(await service.expireDue(), 1);
  assert.equal(actions[0].action, "approve");
  assert.match(sent.at(-1).body, /seguiu automaticamente/);
  // Permissão retirada depois do pedido: a decisão falha e o aprovador é avisado (nada é publicado).
  const other = setup();
  await configure(other.service);
  other.repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-1" });
  await other.service.dispatchPending();
  await captureApprovalReply(other.repository, { connectionId: "conn-vorix", fromPhone: "+5511988887777", text: "1", isGroup: false, fromMe: false });
  other.repository.state.members[0].role = "viewer";
  await other.service.applyDecisions();
  assert.equal(other.actions.length, 0);
  assert.equal(other.repository.state.requests[0].status, "failed");
  assert.match(other.sent.at(-1).body, /Não consegui aplicar/);
});

test("número registrado no WhatsApp sem o 9 extra: tenta a outra forma só quando o WhatsApp não conhece o número", async () => {
  assert.deepEqual(whatsappPhoneVariants("5546999990000"), ["5546999990000", "554699990000"]);
  assert.deepEqual(whatsappPhoneVariants("554699990000"), ["554699990000", "5546999990000"]);
  assert.deepEqual(whatsappPhoneVariants("554633334444"), ["554633334444"], "fixo não ganha 9");
  const tried = [];
  const send = async (to) => { tried.push(to); if (to.length === 13) throw new Error('WuzAPI indisponível (status 500): {"error":"error sending message: no LID found for 5546999990000@s.whatsapp.net from server"}'); };
  assert.equal(await deliverToApprover("5546999990000", send), "554699990000");
  assert.deepEqual(tried, ["5546999990000", "554699990000"]);
  tried.length = 0;
  assert.equal(await deliverToApprover("5546999990000", send, "554699990000"), "554699990000");
  assert.deepEqual(tried, ["554699990000"], "forma que já funcionou vai primeiro");
  // Outro erro (sessão caída) não vira tentativa às cegas em outro número.
  await assert.rejects(deliverToApprover("5546999990000", async () => { throw new Error("no session"); }), /no session/);

  const { service, repository, sent } = setup();
  const realSend = service.deps.provider.sendText;
  service.deps.provider.sendText = async (input) => { if (input.to === PHONE) throw new Error("no LID found for x"); return realSend(input); };
  await configure(service);
  await service.sendTest({ tenantId: "t1", workspaceId: "ws-cmkv" });
  assert.equal(sent.at(-1).to, "551188887777");
  assert.equal(repository.state.requests.length, 0);
});

test("eco das mensagens do sistema ao aprovador não entra nas Conversas; o que a equipe digita para ele entra", async () => {
  const { service, repository, sent } = setup();
  await configure(service);
  repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-1" });
  await service.dispatchPending();
  assert.equal(repository.state.outbound.size, sent.length, "imagem + pedido registrados");
  const base = { connectionId: "conn-vorix", chatPhone: "5511988887777@s.whatsapp.net", fromMe: true, isGroup: false, waitMs: 5 };
  assert.equal(await isApprovalEcho(repository, { ...base, externalMessageId: "m1" }), true);
  assert.equal(await isApprovalEcho(repository, { ...base, externalMessageId: "m2" }), true);
  assert.equal(await isApprovalEcho(repository, { ...base, externalMessageId: "digitado-no-celular" }), false);
  assert.equal(await isApprovalEcho(repository, { ...base, externalMessageId: "m1", fromMe: false }), false, "mensagem recebida nunca é eco");
  // Eco que chega antes de o id ser gravado: num chat de aprovador, confere de novo após a pausa.
  setTimeout(() => repository.state.outbound.add("conn-vorix:atrasado"), 1);
  assert.equal(await isApprovalEcho(repository, { ...base, externalMessageId: "atrasado", waitMs: 30 }), true);
  // Eco só com LID (sem telefone): com envio de aprovação no último minuto, também espera e confere.
  setTimeout(() => repository.state.outbound.add("conn-vorix:lid"), 1);
  assert.equal(await isApprovalEcho(repository, { ...base, chatPhone: "123456789012345@lid", externalMessageId: "lid", waitMs: 30 }), false, "sem atividade recente: segue normal");
  repository.state.recentActivity = true;
  setTimeout(() => repository.state.outbound.add("conn-vorix:lid2"), 1);
  assert.equal(await isApprovalEcho(repository, { ...base, chatPhone: "123456789012345@lid", externalMessageId: "lid2", waitMs: 30 }), true);
  repository.state.recentActivity = false;
  // Chat de outro contato: sem pausa, segue normal.
  const started = Date.now();
  assert.equal(await isApprovalEcho(repository, { ...base, chatPhone: "+5511977776666", externalMessageId: "x", waitMs: 2_000 }), false);
  assert.ok(Date.now() - started < 500);
});

test("ideia do Bolsão só fica 'feita' se aprovada: reprovada ou sem resposta, volta a ficar disponível", async () => {
  const { service, repository, posts } = setup();
  const returned = [];
  service.deps.onNotApproved = async (input) => { returned.push(input.publicationId); };
  await configure(service);
  posts.set("pub-2", { ...posts.get("pub-1") });
  posts.set("pub-3", { ...posts.get("pub-1"), scheduledAt: "2026-11-25T18:01:00Z" });
  repository.state.toRequest.push(...["pub-1", "pub-2", "pub-3"].map((publicationId) => ({ tenantId: "t1", workspaceId: "ws-cmkv", publicationId })));
  await service.dispatchPending();
  const [first, second] = repository.state.requests;
  await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "+5511988887777", text: `1 ${first.code}`, isGroup: false, fromMe: false });
  await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: "+5511988887777", text: `2 ${second.code} não gostei`, isGroup: false, fromMe: false });
  await service.applyDecisions();
  assert.deepEqual(returned, ["pub-2"], "aprovada não volta; reprovada volta");
  await service.expireDue();
  assert.deepEqual(returned, ["pub-2", "pub-3"], "sem resposta com 'não publica' também volta");
});

test("publicação aprovada que foi ao ar marca a ideia como feita a cada ciclo; falha nesse passo não derruba o ciclo", async () => {
  const { service } = setup();
  let calls = 0;
  service.deps.completePublishedIdeas = async () => { calls += 1; return 1; };
  assert.equal((await service.tick()).completed, 1);
  assert.equal(calls, 1);
  service.deps.completePublishedIdeas = async () => { throw new Error("banco indisponível"); };
  const result = await service.tick();
  assert.equal(result.completed, 0);
  assert.equal(result.sent, 0);
});

test("várias marcas ao mesmo tempo: responder citando a imagem ou o texto do pedido decide aquele pedido, sem código", async () => {
  const { service, repository, sent, actions, posts } = setup();
  await configure(service);
  await service.saveRule({ tenantId: "t1", workspaceId: "ws-vorix", enabled: true, approverUserId: "u-owner", approverPhone: APPROVER, onTimeout: "skip", actorUserId: "u-owner" });
  posts.set("pub-2", { ...posts.get("pub-1") });
  repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-cmkv", publicationId: "pub-1" }, { tenantId: "t1", workspaceId: "ws-vorix", publicationId: "pub-2" });
  await service.dispatchPending();
  const [cmkv, vorix] = repository.state.requests;
  // Mensagens: [imagem CMKV, texto CMKV, imagem Vorix, texto Vorix] — ids m1..m4.
  assert.doesNotMatch(sent[1].body, /Há mais de uma/, "primeiro pedido: basta 1 ou 2");
  assert.match(sent[1].body, /Responder/);
  assert.ok(sent[3].body.includes(`Há mais de uma publicação aguardando você. Responda *1 ${vorix.code}* para aprovar`), "segundo pedido já orienta com o código");
  // "1" sozinho ainda é ambíguo e a orientação ensina a citar a imagem.
  const ambiguous = await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: APPROVER, text: "1", isGroup: false, fromMe: false });
  assert.match(ambiguous.reply, /Responder\* na imagem/);
  // Citando a imagem da Vorix (m3): reprova a Vorix. Citando o texto da CMKV (m2): aprova a CMKV.
  assert.deepEqual(await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: APPROVER, text: "2 cor apagada", quotedExternalMessageId: "m3", isGroup: false, fromMe: false }), { handled: true, requestId: vorix.id });
  assert.deepEqual(await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: APPROVER, text: "1", quotedExternalMessageId: "m2", isGroup: false, fromMe: false }), { handled: true, requestId: cmkv.id });
  await service.applyDecisions();
  assert.deepEqual(actions.map((action) => [action.action, action.postId]).sort(), [["approve", "pub-1"], ["cancel", "pub-2"]]);
  assert.equal(vorix.reason, "cor apagada");
  // Citando um pedido já encerrado: avisa que nada mudou.
  const late = await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: APPROVER, text: "2", quotedExternalMessageId: "m1", isGroup: false, fromMe: false });
  assert.ok(late.reply.includes(`(${cmkv.code}) já foi encerrado`), late.reply);
  // Citar uma mensagem que não é de pedido não muda a regra normal.
  assert.deepEqual(await captureApprovalReply(repository, { connectionId: "conn-vorix", fromPhone: APPROVER, text: "1", quotedExternalMessageId: "conversa-qualquer", isGroup: false, fromMe: false }), { handled: false });
});
