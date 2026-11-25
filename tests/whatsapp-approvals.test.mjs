import test from "node:test";
import assert from "node:assert/strict";
import { approvalCode, matchPendingRequest, parseApprovalReply } from "../dist/application/approvals/whatsapp-approval.js";
import { canonicalApprovalPhone, captureApprovalReply, WhatsappApprovalService } from "../dist/application/approvals/whatsapp-approval-service.js";

// Aprovação de publicações pelo WhatsApp (25/11/2026): número da CONTA, regra por MARCA. Tudo simulado —
// nenhum WhatsApp real, nenhuma publicação real.

const APPROVER = "+55 (11) 98888-7777";
const PHONE = canonicalApprovalPhone(APPROVER);

function fakeRepository() {
  const state = { settings: new Map(), rules: new Map(), requests: [], members: [{ userId: "u-owner", name: "Dono", role: "owner" }, { userId: "u-viewer", name: "Leitor", role: "viewer" }], toRequest: [] };
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
