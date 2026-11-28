// Campanha de vídeo com LOCUÇÃO e APROVAÇÃO SEGURA no WhatsApp (somente aprovação): regras puras da locução,
// contrato do rascunho, construtor (a fala manda na duração), diretor (escreve a fala) e o serviço de aprovação
// (aprovar não publica, reprovar não refaz sozinho, sem resposta nunca vira aprovação). Tudo simulado.
import test from "node:test";
import assert from "node:assert/strict";
import { captionsFromWords, narrationMinimums, narrationQuality, placeNarration, voiceoverLines } from "../dist/application/video-editing/narration-track.js";
import { validateVideoEditDraftStructure } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { canonicalApprovalPhone, captureApprovalReply, WhatsappApprovalService } from "../dist/application/approvals/whatsapp-approval-service.js";
import { VOICEOVER_RULES, directorPrompt, directorSchemaWith, toDraft } from "../scripts/editorial/video-director.mjs";

const scene = (materialId, purpose, extra = {}) => ({ materialId, purpose, durationSeconds: 2, motion: "static", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [], ...extra });
const draft = (scenes, extra = {}) => ({ schemaVersion: 1, strategy: "s", rationale: "", captions: false, music: "none", logo: "none", warnings: [], scenes, ...extra });
const brand = { name: "Preço Baixo Club", primaryHex: "#080E23", accentHex: "#A8E82B", lightHex: "#FFFFFF", darkHex: "#0C100C" };
const ctx = (extra = {}) => ({ planId: "p", workspaceId: "ws", aspect: "9:16", request: "pauta", style: { editing: "dinamico", transitions: "moderadas", captions: true, music: false }, materials: [], transcripts: {}, sentences: [], brand, ...extra });

test("locução: falas válidas, duração mínima por cena, encaixe no início da própria cena e legenda das palavras ouvidas", () => {
  const d = draft([scene("CARD", "hook"), scene("CARD", "benefit"), scene("CARD", "cta")], { voiceover: { lines: [{ scene: 2, text: " Compare antes de comprar. " }, { scene: 0, text: "Você ainda pesquisa loja por loja?" }, { scene: 0, text: "duplicada" }, { scene: 9, text: "fora" }, { scene: 1, text: "x" }] } });
  const lines = voiceoverLines(d);
  assert.deepEqual(lines.map((l) => [l.scene, l.text]), [[0, "Você ainda pesquisa loja por loja?"], [2, "Compare antes de comprar."]]);
  const minimums = narrationMinimums(lines, [2.1, 1.8], 3);
  assert.deepEqual(minimums, [2.55, undefined, 2.25]);
  const clips = [{ id: "c1", recordStartSeconds: 0, durationSeconds: 2.6 }, { id: "c2", recordStartSeconds: 2.6, durationSeconds: 2 }, { id: "c3", recordStartSeconds: 4.6, durationSeconds: 2.3 }];
  const placed = placeNarration(clips, lines, [2.1, 1.8]);
  assert.deepEqual(placed.placements.map((p) => [p.scene, p.at]), [[0, 0.15], [2, 4.75]]);
  assert.equal(placed.issues.length, 0);
  assert.match(placeNarration(clips, lines, [2.1, 4])[`issues`][0], /não cabe no clipe/, "fala maior que a cena é acusada, nunca invade a seguinte");
  const words = "Você ainda pesquisa loja por loja?".split(" ").map((word, i) => ({ word, start: 0.15 + i * 0.3, end: 0.4 + i * 0.3 }));
  const captions = captionsFromWords(words);
  assert.deepEqual(captions.map((c) => c.text), ["Você ainda pesquisa loja", "por loja?"]);
  assert.ok(captions.every((c) => c.words.length && c.endSeconds > c.startSeconds));
  assert.equal(narrationQuality({ placements: placed.placements, issues: [], coverage: 0.92, lines: 2 }).status, "ok");
  assert.match(narrationQuality({ placements: placed.placements, issues: [], coverage: 0.5, lines: 2 }).findings[0], /pouco inteligível/);
});

test("rascunho com locução: contrato aceita a fala e o construtor deixa a cena narrada do tamanho da fala (fora do ajuste automático)", () => {
  const d = draft([scene("CARD", "hook", { design: { template: "title_card", lines: ["Loja por loja?"] } }), scene("CARD", "benefit", { design: { template: "title_card", lines: ["Num lugar só"] } }), scene("CARD", "cta", { design: { template: "title_card", lines: ["Compare"] } })],
    { voiceover: { kind: "ofertas", lines: [{ scene: 0, text: "Você ainda pesquisa loja por loja?", intent: "curiosidade" }, { scene: 2, text: "Compare antes de comprar.", intent: "chamada" }] } });
  assert.equal(validateVideoEditDraftStructure(d).valid, true);
  assert.equal(validateVideoEditDraftStructure({ ...d, voiceover: { lines: [{ scene: 0, text: "oi", extra: 1 }] } }).valid, false, "campo estranho na fala é recusado");
  const built = buildPlanFromDraft(d, ctx({ targetDurationSeconds: 5, narrationMinimums: [3.4, undefined, 4.2] }));
  assert.equal(built.ok, true, built.issues?.join("; "));
  const [first, , last] = built.plan.clips;
  assert.ok(first.durationSeconds >= 3.4, `cena 1 com a fala inteira (${first.durationSeconds})`);
  assert.ok(last.durationSeconds >= 4.2, `cena 3 com a fala inteira mesmo com duração pedida de 5 s (${last.durationSeconds})`);
});

test("diretor: sem gravação com fala, ele escreve a locução (uma fala por cena) e o schema exige o campo", () => {
  const schema = directorSchemaWith(undefined, { voiceover: true });
  assert.ok(schema.required.includes("voiceover") && !schema.required.includes("direction"));
  const prompt = directorPrompt({ selection: { brand: "Preço Baixo Club", idea: { title: "Compare ofertas num lugar só" }, narration: true }, materials: [] });
  assert.ok(prompt.includes("VOCÊ escreve a locução") && prompt.includes(VOICEOVER_RULES[0]) && !prompt.includes("Você não escreve fala nem legenda"));
  assert.ok(directorPrompt({ selection: { brand: "B", idea: { title: "t" } }, materials: [] }).includes("Você não escreve fala nem legenda"), "sem locução, regra de antes");
  const out = { strategy: "s", scenes: [{ materialId: "CARD", purpose: "hook", durationSeconds: 2, motion: "static", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [] }, { materialId: "CARD", purpose: "cta", durationSeconds: 2, motion: "static", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [] }],
    captions: false, music: "subtle", logo: "end", warnings: [], voiceover: { kind: "ofertas", lines: [{ scene: 1, text: "Compare antes…  de comprar.", intent: "chamada" }, { scene: 0, text: "Você ainda pesquisa loja por loja?", intent: "nada" }, { scene: 5, text: "cena que não existe", intent: "chamada" }] } };
  const d = toDraft(out);
  assert.deepEqual(d.voiceover, { kind: "ofertas", lines: [{ scene: 0, text: "Você ainda pesquisa loja por loja?", intent: "explicacao" }, { scene: 1, text: "Compare antes. de comprar.", intent: "chamada" }] });
  assert.equal(validateVideoEditDraftStructure(d).valid, true);
});

// ---------------------------------------------------------------------------------------------- aprovação segura

const APPROVER = "+55 (46) 99108-1743";
function approvalFixture({ scheduledAt = "2026-11-28T20:00:30Z", now = "2026-11-28T20:00:00Z" } = {}) {
  const state = { requests: [], rules: new Map(), settings: new Map(), outbound: new Set(), outboundRequest: new Map(), toRequest: [] };
  const repository = {
    state,
    async getSettings(tenantId) { return state.settings.get(tenantId); },
    async saveSettings(input) { state.settings.set(input.tenantId, { tenantId: input.tenantId, enabled: input.enabled, connectionId: input.connectionId }); return state.settings.get(input.tenantId); },
    async listRules() { return [...state.rules.values()]; },
    async getRule(tenantId, workspaceId) { return state.rules.get(`${tenantId}:${workspaceId}`); },
    async saveRule(input) { state.rules.set(`${input.tenantId}:${input.workspaceId}`, { ...input, enabledAt: "2026-11-26T12:00:00Z" }); return state.rules.get(`${input.tenantId}:${input.workspaceId}`); },
    async listMembers() { return [{ userId: "u-owner", name: "Dono", role: "owner" }]; },
    async listPublicationsToRequest() { return state.toRequest.filter((item) => !state.requests.some((r) => r.publicationId === item.publicationId)); },
    async createRequest(input) { if (state.requests.some((r) => r.publicationId === input.publicationId)) return undefined; const r = { ...input, status: "pending", createdAt: now }; state.requests.push(r); return r; },
    async updateRequest(id, patch) { Object.assign(state.requests.find((r) => r.id === id), Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))); },
    async decideRequest(id, decision, reason) { const r = state.requests.find((x) => x.id === id); if (r.status !== "sent") return false; Object.assign(r, { status: "decided", decision, reason }); return true; },
    async listOpenByPhone(connectionId, phone) { return state.requests.filter((r) => r.connectionId === connectionId && r.approverPhone === phone && r.status === "sent"); },
    async listByStatus(status) { return state.requests.filter((r) => r.status === status); },
    async listRecent() { return state.requests; },
    async recordOutbound(connectionId, ids, requestId) { for (const id of ids) { state.outbound.add(`${connectionId}:${id}`); if (requestId) state.outboundRequest.set(`${connectionId}:${id}`, requestId); } },
    async requestForOutbound(connectionId, id) { return state.requests.find((r) => r.id === state.outboundRequest.get(`${connectionId}:${id}`)); },
    async isApprovalOutbound(connectionId, id) { return state.outbound.has(`${connectionId}:${id}`); },
    async hasRecentApprovalActivity() { return false; },
    async isApproverPhone() { return true; },
  };
  const sent = [];
  const actions = [];
  const decisions = [];
  const redos = [];
  const posts = new Map([["pub-v", { state: "AWAITING_APPROVAL", scheduledAt, timezone: "America/Sao_Paulo", caption: "Compare antes de comprar.", networks: ["instagram"], media: [{ url: "https://api/v.mp4", kind: "video" }],
    approvalOnly: { ideaTitle: "Você ainda pesquisa loja por loja?", production: "vver-123", durationSeconds: 22.4, concept: "Uma busca vira várias abas", sha256: "ab".repeat(32) } }]]);
  let seq = 0;
  const service = new WhatsappApprovalService({
    repository,
    connections: { async getById(id) { return { id, tenantId: "t1", workspaceId: "ws-vorix", provider: "wuzapi", externalSessionId: "sess", displayName: "Vorix", status: "connected" }; }, async listByWorkspace() { return []; } },
    workspaces: { async getById(id) { return { id, tenantId: "t1", name: "Preço Baixo Club", status: "active" }; }, async listByTenant() { return []; } },
    provider: {
      async sendText(input) { sent.push({ type: "text", ...input }); return { externalMessageId: `m${sent.length}` }; },
      async sendVideo(input) { sent.push({ type: "video", to: input.to, size: input.mediaUrl.length }); return { externalMessageId: `m${sent.length}` }; },
    },
    posts: {
      async get({ postId }) { return posts.get(postId); },
      async approve(input) { actions.push({ action: "approve", ...input }); posts.get(input.postId).state = "SCHEDULED"; },
      async cancel(input) { actions.push({ action: "cancel", ...input }); posts.get(input.postId).state = "CANCELLED"; },
    },
    onApprovalOnlyDecision: async (input) => { decisions.push(input); },
    onRejectedForRedo: async (input) => { redos.push(input); return { queued: true, attempt: 1 }; },
    loadMedia: async () => ({ data: Buffer.from("mp4-bytes"), mimeType: "video/mp4" }),
    idGenerator: () => `req-${++seq}`,
    now: () => new Date(now),
  });
  return { service, repository, sent, actions, decisions, redos, posts };
}

async function configureApproval(service, onTimeout) {
  await service.saveSettings({ tenantId: "t1", enabled: true, connectionId: "conn", actorUserId: "u-owner" });
  await service.saveRule({ tenantId: "t1", workspaceId: "ws-pbc", enabled: true, approverUserId: "u-owner", approverPhone: APPROVER, onTimeout, actorUserId: "u-owner" });
}

test("somente aprovação: vídeo + mensagem da produção; sem resposta nunca expira nem publica (mesmo com a regra 'publicar')", async () => {
  const fx = approvalFixture();
  await configureApproval(fx.service, "publish");
  fx.repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-pbc", publicationId: "pub-v" });
  assert.equal(await fx.service.dispatchPending(), 1);
  assert.equal(fx.sent[0].type, "video", "o MP4 vai anexado");
  const body = fx.sent[1].body;
  for (const needle of ["🎬 *Novo vídeo para aprovação — Preço Baixo Club*", "Ideia: Você ainda pesquisa loja por loja?", "Produção: vver-123 · 22 s", "Uma busca vira várias abas", "Somente aprovação: nada será agendado nem publicado automaticamente."]) assert.ok(body.includes(needle), needle);
  assert.equal(await fx.service.dispatchPending(), 0, "sem mensagem duplicada");
  // Prazo vencido (a 30 s do horário) com a regra "publicar mesmo assim": nada acontece.
  assert.equal(await fx.service.expireDue(), 0);
  assert.deepEqual(fx.actions, []);
  assert.equal(fx.repository.state.requests[0].status, "sent", "continua aguardando");
});

test("somente aprovação: '1' registra a aprovação e encerra o post SEM publicar; '2 motivo' guarda o motivo sem refazer sozinho", async () => {
  const approve = approvalFixture();
  await configureApproval(approve.service, "skip");
  approve.repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-pbc", publicationId: "pub-v" });
  await approve.service.dispatchPending();
  await captureApprovalReply(approve.repository, { connectionId: "conn", fromPhone: canonicalApprovalPhone(APPROVER), text: "1", isGroup: false, fromMe: false });
  assert.equal(await approve.service.applyDecisions(), 1);
  assert.deepEqual(approve.actions.map((a) => a.action), ["cancel"], "nunca chama approve (que agendaria/publicaria)");
  assert.deepEqual(approve.decisions.map((d) => [d.decision, d.publicationId, d.reviewerUserId]), [["approve", "pub-v", "u-owner"]]);
  assert.match(approve.sent.at(-1).body, /Registrei sua aprovação deste vídeo; nada foi agendado nem publicado/);
  assert.match(approve.repository.state.requests[0].detail, /somente aprovação: aprovado.*sha256 abababab/);

  const reject = approvalFixture();
  await configureApproval(reject.service, "skip");
  reject.repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-pbc", publicationId: "pub-v" });
  await reject.service.dispatchPending();
  await captureApprovalReply(reject.repository, { connectionId: "conn", fromPhone: canonicalApprovalPhone(APPROVER), text: "2 a abertura está lenta", isGroup: false, fromMe: false });
  await reject.service.applyDecisions();
  assert.deepEqual(reject.redos, [], "reprovação não dispara a refação automática (que publicaria)");
  assert.deepEqual(reject.decisions.map((d) => [d.decision, d.reason]), [["reject", "a abertura está lenta"]]);
  assert.deepEqual(reject.actions.map((a) => a.action), ["cancel"]);
  assert.match(reject.sent.at(-1).body, /Ajustes pedidos — Preço Baixo Club \(motivo: a abertura está lenta\)\. Registrei o motivo/);
});

test("post normal (sem a marcação) segue o fluxo de antes: aprovar agenda", async () => {
  const fx = approvalFixture();
  await configureApproval(fx.service, "skip");
  delete fx.posts.get("pub-v").approvalOnly;
  fx.repository.state.toRequest.push({ tenantId: "t1", workspaceId: "ws-pbc", publicationId: "pub-v" });
  await fx.service.dispatchPending();
  assert.match(fx.sent[1].body, /Aprovação de publicação — Preço Baixo Club/);
  await captureApprovalReply(fx.repository, { connectionId: "conn", fromPhone: canonicalApprovalPhone(APPROVER), text: "1", isGroup: false, fromMe: false });
  await fx.service.applyDecisions();
  assert.deepEqual(fx.actions.map((a) => a.action), ["approve"]);
  assert.deepEqual(fx.decisions, []);
});

test("legenda da locução: palavras sobrepostas, fora de ordem ou além do fim nunca invalidam o plano", () => {
  const messy = [{ word: "por", start: 1.2, end: 1.4 }, { word: "Você", start: 0.2, end: 0.5 }, { word: "ainda", start: 0.4, end: 0.7 }, { word: "loja", start: 0.4, end: 0.6 }, { word: "fim", start: 9.9, end: 10.4 }, { word: "", start: 1, end: 2 }];
  const captions = captionsFromWords(messy, { durationSeconds: 10 });
  let lastEnd = 0;
  for (const segment of captions) {
    assert.ok(segment.startSeconds >= lastEnd - 1e-9 && segment.endSeconds - segment.startSeconds >= 0.25 && segment.endSeconds <= 10);
    let lastWord = segment.startSeconds - 0.05;
    for (const word of segment.words) { assert.ok(word.startSeconds >= lastWord - 0.05 && word.endSeconds >= word.startSeconds && word.endSeconds <= segment.endSeconds + 0.3); lastWord = word.startSeconds; }
    lastEnd = segment.endSeconds;
  }
  assert.ok(!captions.some((segment) => segment.text.includes("fim")), "nada no último quarto de segundo");
});
