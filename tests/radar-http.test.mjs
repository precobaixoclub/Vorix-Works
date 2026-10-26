import { test } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";

/**
 * Radar de Sentimento — nível HTTP: kill switch, RBAC amarrado em cada rota (`requirePermission`
 * + escopo resolvido a partir do papel) e o contrato "falta de crédito nunca vira erro". A lógica
 * de score/crédito em si é coberta com banco real em `radar-credits.test.mjs`; aqui o repositório
 * é um dublê que só registra com que escopo cada rota o chamou.
 */

function principal({ role, userId = "user-a", tenantId = "tenant-radar-http" }) {
  return { userId, tenantId, role, sessionId: "session-1", isPlatformAdmin: false };
}

const ALERT = {
  id: "risk-1",
  tenantId: "tenant-radar-http",
  workspaceId: "ws-1",
  conversationId: "conv-1",
  score: 70,
  level: "high",
  reasons: ["Ameaça de cancelamento (\"cancelar\")"],
  signals: {},
  hasKeywordTrigger: true,
  hasCancellation: true,
  hasLegalThreat: false,
  hasManagerRequest: false,
  hasComplaint: false,
  hasUrgency: false,
  waitingMinutes: 12,
  messageCount: 4,
  inboundCount: 3,
  transferCount: 0,
  reopenCount: 0,
  scoreChangedAt: "2026-10-13T14:00:00.000Z",
  aiStatus: "NEVER_ANALYZED",
  isDismissed: false,
  createdAt: "2026-10-13T13:00:00.000Z",
  updatedAt: "2026-10-13T14:00:00.000Z",
  liveWaitingMinutes: 12,
};

function makeFakeRadar({ credits = { available: true, creditsCost: 1, remainingCredits: 5 } } = {}) {
  const calls = { scopes: [], claims: 0, analyses: 0, blocked: 0, creditChecks: 0 };
  let alert = { ...ALERT };
  const radarRepository = {
    async list(scope) { calls.scopes.push(scope); return [alert]; },
    async stats(scope) { calls.scopes.push(scope); return { totalActive: 1, critical: 0, high: 1, medium: 0, low: 0, slaBreached: 0, withCancellation: 1, withLegalThreat: 0, avgScore: 70, aiBlockedNoCredits: 0, backlogByTeam: [] }; },
    async getDetail(scope, conversationId) { calls.scopes.push(scope); return conversationId === alert.conversationId ? alert : undefined; },
    async listAiAnalysisLogs() { return []; },
    async listDismissalLog() { return []; },
    async getSettings() { return { radarEnabled: true, aiAnalysisEnabled: true, aiTriggerThreshold: 60, aiCooldownMinutes: 30, slaMinutes: 30 }; },
    async upsertSettings(input) { return { radarEnabled: true, aiAnalysisEnabled: true, aiTriggerThreshold: 60, aiCooldownMinutes: 30, slaMinutes: 30, ...input.patch }; },
    async listTeamFlags() { return []; },
    async listKeywordOverrides() { return []; },
    async dismiss() { alert = { ...alert, isDismissed: true }; return alert; },
    async reactivate() { alert = { ...alert, isDismissed: false }; return alert; },
    async tryClaimAiAnalysis() { calls.claims += 1; return alert; },
    async blockAiAnalysis(input) { calls.blocked += 1; alert = { ...alert, aiStatus: "BLOCKED_NO_CREDITS", aiBlockedReason: input.reason }; return alert; },
    async recordAiAnalysisLog() {},
    async listRecentMessages() { return []; },
    async completeAiAnalysis(input) { alert = { ...alert, aiStatus: "ANALYZED", aiAnalysis: input.analysis, aiAnalyzedAt: input.analyzedAt, aiAnalyzedScore: input.analyzedScore }; return alert; },
  };
  const deps = {
    radarRepository,
    creditGate: { async check() { calls.creditChecks += 1; return credits; } },
    aiAnalyst: {
      async analyze() {
        calls.analyses += 1;
        return { ok: true, analysis: { diagnostico: "d", causaRaiz: "c", riscoPrincipal: "churn", acaoImediata: "a", prioridade: "alta", resumoParaGestor: "r" }, provider: "anthropic", model: "m", usage: { inputTokens: 1, outputTokens: 1, estimatedCost: 0 }, traceId: "t" };
      },
    },
  };
  return { deps, calls };
}

async function buildTestApp({ role, userId, radar, radarEnv = "true" }) {
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true", RADAR_ENABLED: radarEnv });
  const authPort = { async verifyToken() { return { authenticated: true, principal: principal({ role, userId }) }; } };
  // O guarda de tenant global (`workspace-tenant-guard`) exige que o `workspaceId` exista no tenant.
  const workspaceRepository = { async getById(id) { return id === "ws-1" ? { id, tenantId: "tenant-radar-http" } : undefined; } };
  return buildApp({ config, container: { authPort, radar, workspaceRepository } });
}

test("KILL_SWITCH: sem o Radar no container, /v1/radar/* não existe", async () => {
  const app = await buildTestApp({ role: "owner", radar: undefined, radarEnv: "false" });
  const response = await app.inject({ method: "GET", url: "/v1/radar/alerts?workspaceId=ws-1" });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("CONFIG: RADAR_ENABLED e RADAR_AI_ENABLED são desligados por padrão", () => {
  const defaults = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop" });
  assert.deepEqual(defaults.radar, { enabled: false, aiEnabled: false });
  const enabled = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", RADAR_ENABLED: "true", RADAR_AI_ENABLED: "true" });
  assert.deepEqual(enabled.radar, { enabled: true, aiEnabled: true });
});

test("RBAC: viewer lê o Radar mas não arquiva, não reativa, não analisa e não configura", async () => {
  const { deps, calls } = makeFakeRadar();
  const app = await buildTestApp({ role: "viewer", radar: deps });

  for (const url of ["/v1/radar/alerts?workspaceId=ws-1", "/v1/radar/stats?workspaceId=ws-1", "/v1/radar/credits?workspaceId=ws-1", "/v1/radar/alerts/conv-1?workspaceId=ws-1", "/v1/radar/settings?workspaceId=ws-1", "/v1/radar/keywords?workspaceId=ws-1"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200, url);
  }

  const forbidden = [
    { method: "POST", url: "/v1/radar/alerts/conv-1/dismiss", payload: { workspaceId: "ws-1" } },
    { method: "POST", url: "/v1/radar/alerts/conv-1/reactivate", payload: { workspaceId: "ws-1" } },
    { method: "POST", url: "/v1/radar/alerts/conv-1/reanalyze", payload: { workspaceId: "ws-1" } },
    { method: "PUT", url: "/v1/radar/settings", payload: { workspaceId: "ws-1", radarEnabled: false } },
    { method: "PUT", url: "/v1/radar/teams/team-1", payload: { workspaceId: "ws-1", enabled: false } },
    { method: "PUT", url: "/v1/radar/keywords", payload: { workspaceId: "ws-1", keyword: "sair fora", category: "cancellation" } },
    { method: "DELETE", url: "/v1/radar/keywords/kw-1?workspaceId=ws-1" },
  ];
  for (const request of forbidden) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 403, `${request.method} ${request.url}`);
  }
  assert.equal(calls.analyses, 0);
  assert.equal(calls.claims, 0);
  await app.close();
});

test("RBAC: editor arquiva e analisa, mas não configura o Radar", async () => {
  const { deps } = makeFakeRadar();
  const app = await buildTestApp({ role: "editor", radar: deps });
  assert.equal((await app.inject({ method: "POST", url: "/v1/radar/alerts/conv-1/dismiss", payload: { workspaceId: "ws-1", note: "ok" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/v1/radar/alerts/conv-1/reactivate", payload: { workspaceId: "ws-1" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "PUT", url: "/v1/radar/settings", payload: { workspaceId: "ws-1", aiTriggerThreshold: 70 } })).statusCode, 403);
  assert.equal((await app.inject({ method: "PUT", url: "/v1/radar/keywords", payload: { workspaceId: "ws-1", keyword: "sair fora", category: "cancellation" } })).statusCode, 403);
  await app.close();
});

test("ESCOPO: toda rota passa tenant + workspace; o escopo segue o da Inbox (só Administrador vê tudo)", async () => {
  const restricted = makeFakeRadar();
  const editorApp = await buildTestApp({ role: "editor", userId: "agente-7", radar: restricted.deps });
  await editorApp.inject({ method: "GET", url: "/v1/radar/alerts?workspaceId=ws-1" });
  await editorApp.inject({ method: "GET", url: "/v1/radar/stats?workspaceId=ws-1" });
  await editorApp.inject({ method: "GET", url: "/v1/radar/alerts/conv-1?workspaceId=ws-1" });
  assert.equal(restricted.calls.scopes.length, 3);
  for (const scope of restricted.calls.scopes) {
    assert.deepEqual(scope, { tenantId: "tenant-radar-http", workspaceId: "ws-1", teamIds: [], agentId: "agente-7" });
  }
  await editorApp.close();

  const managerScoped = makeFakeRadar();
  const managerApp = await buildTestApp({ role: "admin", userId: "gerente-1", radar: managerScoped.deps });
  await managerApp.inject({ method: "GET", url: "/v1/radar/alerts?workspaceId=ws-1" });
  assert.deepEqual(managerScoped.calls.scopes[0], { tenantId: "tenant-radar-http", workspaceId: "ws-1", teamIds: [], agentId: "gerente-1" });
  await managerApp.close();

  const full = makeFakeRadar();
  const ownerApp = await buildTestApp({ role: "owner", radar: full.deps });
  await ownerApp.inject({ method: "GET", url: "/v1/radar/alerts?workspaceId=ws-1" });
  assert.deepEqual(full.calls.scopes[0], { tenantId: "tenant-radar-http", workspaceId: "ws-1" });
  await ownerApp.close();
});

test("VALIDACAO: workspaceId é obrigatório e alerta inexistente responde 404", async () => {
  const { deps } = makeFakeRadar();
  const app = await buildTestApp({ role: "owner", radar: deps });
  assert.equal((await app.inject({ method: "GET", url: "/v1/radar/alerts" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/v1/radar/alerts?workspaceId=ws-1&level=altissimo" })).statusCode, 400);
  const missing = await app.inject({ method: "GET", url: "/v1/radar/alerts/conv-inexistente?workspaceId=ws-1" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "RADAR_ALERT_NOT_FOUND");
  await app.close();
});

test("SEM_CREDITOS: a tela abre normalmente e 'Analisar agora' responde 200 com o desfecho — nunca erro técnico", async () => {
  const { deps, calls } = makeFakeRadar({ credits: { available: false, reason: "no_credits", creditsCost: 0, remainingCredits: 0 } });
  const app = await buildTestApp({ role: "editor", radar: deps });

  const list = await app.inject({ method: "GET", url: "/v1/radar/alerts?workspaceId=ws-1" });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().data.alerts[0].score, 70, "score heurístico segue disponível");
  assert.equal(list.json().data.alerts[0].aiDisplayStatus, "NEVER_ANALYZED");

  const credits = await app.inject({ method: "GET", url: "/v1/radar/credits?workspaceId=ws-1" });
  assert.equal(credits.statusCode, 200);
  assert.deepEqual(credits.json().data, { aiConfigured: true, available: false, remainingCredits: 0, creditsCost: 0, blockedReason: "no_credits" });

  const reanalyze = await app.inject({ method: "POST", url: "/v1/radar/alerts/conv-1/reanalyze", payload: { workspaceId: "ws-1" } });
  assert.equal(reanalyze.statusCode, 200);
  assert.equal(reanalyze.json().data.outcome, "blocked_no_credits");
  assert.equal(reanalyze.json().data.alert.aiDisplayStatus, "BLOCKED_NO_CREDITS");
  assert.equal(calls.analyses, 0, "provider não é chamado sem crédito");
  assert.equal(calls.blocked, 1);
  await app.close();
});

test("COM_CREDITOS: 'Analisar agora' executa o diagnóstico", async () => {
  const { deps, calls } = makeFakeRadar();
  const app = await buildTestApp({ role: "editor", radar: deps });
  const reanalyze = await app.inject({ method: "POST", url: "/v1/radar/alerts/conv-1/reanalyze", payload: { workspaceId: "ws-1" } });
  assert.equal(reanalyze.statusCode, 200);
  assert.equal(reanalyze.json().data.outcome, "completed");
  assert.equal(reanalyze.json().data.alert.aiAnalysis.riscoPrincipal, "churn");
  assert.equal(calls.analyses, 1);
  await app.close();
});
