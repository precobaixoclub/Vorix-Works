import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_RADAR_KEYWORDS, matchRadarKeywords, normalizeRadarText, resolveRadarKeywords } from "../dist/domain/radar/radar-keywords.js";
import { classifyRadarMessage } from "../dist/domain/radar/sentiment-classifier.js";
import { evaluateRadarRisk, RADAR_SCORE_DECAY } from "../dist/domain/radar/risk-score.js";
import { deriveRadarAiDisplayStatus, isRadarAiAnalysisStale, isRadarGroupChat, scoreToRiskLevel } from "../dist/domain/radar/radar.model.js";

/**
 * Radar de Sentimento — Camada 1 (gratuita). Tudo aqui é função pura: nenhum teste deste arquivo
 * toca banco, provider de IA ou crédito — é exatamente a garantia de que calcular score nunca
 * custa nada.
 */

const KEYWORDS = DEFAULT_RADAR_KEYWORDS;

function inbound(text, overrides = {}) {
  return { direction: "inbound", text, keywords: KEYWORDS, waitingMinutes: 0, slaMinutes: 30, transferCount: 0, reopenCount: 0, unansweredInboundCount: 1, ...overrides };
}

function asPrevious(result) {
  return { score: result.score, hasKeywordTrigger: result.signals.hasKeywordTrigger, signals: result.signals };
}

// --- Normalização e matching ------------------------------------------------------------------

test("NORMALIZACAO: minúsculas, sem acento, abreviações e letras repetidas", () => {
  assert.equal(normalizeRadarText("PÉSSIMO Serviço"), "pessimo servico");
  assert.equal(normalizeRadarText("vc n resolveu"), "voce nao resolveu");
  assert.equal(normalizeRadarText("urgenteeee"), "urgente");
  assert.equal(normalizeRadarText("não. quero"), "nao | quero");
});

test("KEYWORD_TRIGGER: keyword com acento e maiúsculas casa a lista padrão", () => {
  const matches = matchRadarKeywords("Vou registrar no PROCON e chamar meu advogado", KEYWORDS);
  assert.deepEqual(matches.map((match) => match.keyword).sort(), ["advogado", "procon"]);
  assert.ok(matches.every((match) => match.category === "legal"));
});

test("KEYWORD_TRIGGER: keyword só casa em início de palavra", () => {
  assert.equal(matchRadarKeywords("o proconsul chegou", KEYWORDS).filter((match) => match.keyword === "procon").length, 1, "prefixo de palavra casa (sufixo livre)");
  assert.equal(matchRadarKeywords("antiprocon", KEYWORDS).length, 0, "meio de palavra nunca casa");
});

test("NEGACAO: 'não quero cancelar' e 'não estou insatisfeito' não disparam", () => {
  assert.equal(matchRadarKeywords("não quero cancelar, só tirar uma dúvida", KEYWORDS).length, 0);
  assert.equal(matchRadarKeywords("não estou insatisfeito", KEYWORDS).length, 0);
  assert.equal(matchRadarKeywords("não é urgente", KEYWORDS).length, 0);
  assert.equal(matchRadarKeywords("sem urgência", KEYWORDS).length, 0);
});

test("NEGACAO: não vaza entre frases nem apaga uma intenção real", () => {
  assert.ok(matchRadarKeywords("Não. Quero cancelar.", KEYWORDS).some((match) => match.keyword === "cancelar"), "negação de outra frase não conta");
  assert.ok(matchRadarKeywords("não consigo cancelar pelo site", KEYWORDS).some((match) => match.keyword === "cancelar"), "'não consigo' não nega a intenção");
  assert.ok(matchRadarKeywords("não quero cancelar hoje mas vou cancelar amanhã", KEYWORDS).some((match) => match.keyword === "cancelar"), "basta uma ocorrência não negada");
  assert.ok(matchRadarKeywords("vocês não resolveram nada", KEYWORDS).some((match) => match.keyword === "nao resolveram"), "keyword que já começa com negação nunca é negada");
});

// --- Classificador léxico ---------------------------------------------------------------------

test("CLASSIFICADOR: sentimento positivo, neutro e negativo sem LLM", () => {
  assert.equal(classifyRadarMessage("Excelente atendimento, muito obrigado!").sentiment, "positive");
  assert.equal(classifyRadarMessage("Bom dia, qual o horário de funcionamento?").sentiment, "neutral");
  const negative = classifyRadarMessage("Péssimo atendimento, ninguém resolve e já falei várias vezes");
  assert.equal(negative.sentiment, "negative");
  assert.ok(negative.score < -0.5);
  assert.equal(negative.hasComplaint, true);
});

test("CLASSIFICADOR: negação inverte negativos e positivos", () => {
  assert.notEqual(classifyRadarMessage("não estou insatisfeito, pelo contrário").sentiment, "negative");
  assert.notEqual(classifyRadarMessage("não funcionou").sentiment, "positive");
  assert.equal(classifyRadarMessage("não gostei do atendimento").sentiment, "negative");
});

test("CLASSIFICADOR: palavra fraca isolada não vira sentimento negativo", () => {
  assert.equal(classifyRadarMessage("tive um problema ontem").sentiment, "neutral");
});

test("URGENCIA: alta, média e baixa", () => {
  assert.equal(classifyRadarMessage("preciso disso urgente, não posso esperar").urgency, "high");
  assert.equal(classifyRadarMessage("estou esperando faz dias").urgency, "medium");
  assert.equal(classifyRadarMessage("quando puder me avise").urgency, "low");
  assert.equal(classifyRadarMessage("não é urgente").urgency, "low");
});

// --- Regra fundamental ------------------------------------------------------------------------

test("REGRA_FUNDAMENTAL: sem keyword, espera/SLA/transferências/reabertura não geram risco", () => {
  const result = evaluateRadarRisk(inbound("oi, alguém pode me ajudar?", { waitingMinutes: 180, transferCount: 5, reopenCount: 3, unansweredInboundCount: 9 }));
  assert.equal(result.signals.hasKeywordTrigger, false);
  assert.equal(result.score, 0);
  assert.equal(result.level, "low");
  assert.deepEqual(result.reasons, []);
});

// --- Categorias -------------------------------------------------------------------------------

test("CANCELAMENTO: +35 e gatilho direto", () => {
  const result = evaluateRadarRisk(inbound("gostaria de rescindir"));
  assert.equal(result.score, 35);
  assert.equal(result.level, "medium");
  assert.equal(result.signals.hasCancellation, true);
  assert.equal(result.isDirectCritical, true);
});

test("AMEACA_JURIDICA: +35 da categoria, mais tom/urgência", () => {
  const result = evaluateRadarRisk(inbound("vou acionar o procon"));
  assert.equal(result.signals.hasLegalThreat, true);
  assert.equal(result.isDirectCritical, true);
  assert.ok(result.score >= 35);
  assert.ok(result.reasons.some((reason) => reason.includes("Ameaça jurídica")));
});

test("PEDIDO_DE_GERENTE: +25 e gatilho direto", () => {
  const result = evaluateRadarRisk(inbound("quero falar com o gerente"));
  assert.equal(result.score, 25);
  assert.equal(result.signals.hasManagerRequest, true);
  assert.equal(result.isDirectCritical, true);
});

test("RECLAMACAO_GRAVE: +20 da categoria, sem gatilho direto", () => {
  const result = evaluateRadarRisk(inbound("que descaso"));
  assert.equal(result.signals.hasComplaint, true);
  assert.equal(result.isDirectCritical, false);
  assert.ok(result.score >= 20 && result.score <= 35, `score ${result.score}`);
});

test("CATEGORIAS: cada categoria conta uma vez por mensagem, mesmo com várias keywords", () => {
  const one = evaluateRadarRisk(inbound("rescindir"));
  const many = evaluateRadarRisk(inbound("rescindir distrato"));
  assert.equal(many.score, one.score);
  assert.equal(many.signals.keywordMatches.length, 2);
});

// --- Sinais operacionais ----------------------------------------------------------------------

test("ESPERA_E_SLA: só pontuam depois da keyword, e por faixa", () => {
  const base = evaluateRadarRisk(inbound("rescindir")).score;
  assert.equal(evaluateRadarRisk(inbound("rescindir", { waitingMinutes: 20 })).score, base + 8);
  assert.equal(evaluateRadarRisk(inbound("rescindir", { waitingMinutes: 20, slaMinutes: 15 })).score, base + 8 + 20, "SLA vencido soma 20");
  const long = evaluateRadarRisk(inbound("rescindir", { waitingMinutes: 75 }));
  assert.equal(long.score, base + 25 + 20);
  assert.equal(long.signals.slaBreached, true);
  assert.ok(long.reasons.includes("SLA de resposta vencido"));
});

test("ESPERA: sinal operacional não soma de novo a cada mensagem", () => {
  const first = evaluateRadarRisk(inbound("rescindir", { waitingMinutes: 75 }));
  const second = evaluateRadarRisk(inbound("alô?", { waitingMinutes: 76, unansweredInboundCount: 2 }), asPrevious(first));
  assert.equal(second.score, first.score + 10, "só o novo sinal (2 mensagens sem resposta) soma");
  const third = evaluateRadarRisk(inbound("alô??", { waitingMinutes: 77, unansweredInboundCount: 2 }), asPrevious(second));
  assert.equal(third.score, second.score - RADAR_SCORE_DECAY, "nada novo → decaimento, nunca espera somada outra vez");
});

test("BURST: 5+ mensagens sem resposta", () => {
  const result = evaluateRadarRisk(inbound("rescindir", { unansweredInboundCount: 5 }));
  assert.equal(result.signals.inboundBurst, true);
  assert.equal(result.score, 35 + 20 + 15);
  assert.ok(result.reasons.includes("Excesso de mensagens do cliente sem retorno"));
});

test("REABERTURA_E_TRANSFERENCIA: pontuam por faixa", () => {
  assert.equal(evaluateRadarRisk(inbound("rescindir", { reopenCount: 1 })).score, 35 + 15);
  assert.equal(evaluateRadarRisk(inbound("rescindir", { reopenCount: 2 })).score, 35 + 25);
  assert.equal(evaluateRadarRisk(inbound("rescindir", { transferCount: 2 })).score, 35 + 10);
  assert.equal(evaluateRadarRisk(inbound("rescindir", { transferCount: 3 })).score, 35 + 20);
});

// --- Incremental, decaimento e limites --------------------------------------------------------

test("DECAIMENTO: mensagem sem sinal novo reduz o score, nunca abaixo de 0", () => {
  let result = evaluateRadarRisk(inbound("rescindir"));
  assert.equal(result.score, 35);
  for (let step = 1; step <= 10; step += 1) {
    result = evaluateRadarRisk(inbound("ok"), asPrevious(result));
    assert.equal(result.score, Math.max(0, 35 - step * RADAR_SCORE_DECAY));
    assert.equal(result.signals.hasKeywordTrigger, true, "a ativação por keyword persiste");
  }
  assert.equal(result.score, 0);
});

test("RESPOSTA_DO_ATENDIMENTO: zera sinais de espera, aplica decaimento e nunca cria alerta", () => {
  const waiting = evaluateRadarRisk(inbound("rescindir", { waitingMinutes: 20 }));
  assert.equal(waiting.score, 35 + 8);
  const reply = evaluateRadarRisk({ ...inbound(undefined), direction: "outbound" }, asPrevious(waiting));
  assert.equal(reply.score, waiting.score - RADAR_SCORE_DECAY);
  assert.equal(reply.signals.applied.wait, 0);
  assert.equal(reply.signals.applied.sla, 0);
  // Depois da resposta, uma nova espera pode pontuar outra vez.
  const again = evaluateRadarRisk(inbound("e aí?", { waitingMinutes: 20 }), asPrevious(reply));
  assert.equal(again.score, reply.score + 8);

  const noAlert = evaluateRadarRisk({ ...inbound("quero cancelar"), direction: "outbound" });
  assert.equal(noAlert.score, 0, "texto do atendente nunca é analisado");
  assert.equal(noAlert.signals.hasKeywordTrigger, false);
});

test("SCORE_0_100: nunca passa de 100 nem fica negativo", () => {
  let result = evaluateRadarRisk(inbound("quero cancelar, vou no procon, chama o gerente, péssimo", { waitingMinutes: 120, transferCount: 4, reopenCount: 3, unansweredInboundCount: 8 }));
  assert.equal(result.score, 100);
  result = evaluateRadarRisk(inbound("vou cancelar e processar vocês"), asPrevious(result));
  assert.equal(result.score, 100);
  assert.equal(result.level, "critical");
});

test("NIVEIS: 0-24 low, 25-49 medium, 50-74 high, 75-100 critical", () => {
  assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 100].map(scoreToRiskLevel), ["low", "low", "medium", "medium", "high", "high", "critical", "critical"]);
});

test("ESCALADA: uma conversa vai de LOW a CRITICAL só com heurística", () => {
  const levels = [];
  let result = evaluateRadarRisk(inbound("isso foi propaganda enganosa"));
  levels.push(result.level);
  for (const text of ["quero falar com o gerente", "vou rescindir o contrato", "e vou no procon"]) {
    result = evaluateRadarRisk(inbound(text), asPrevious(result));
    levels.push(result.level);
  }
  assert.equal(levels[0], "low");
  assert.equal(levels.at(-1), "critical");
  assert.ok(levels.includes("medium") || levels.includes("high"));
});

// --- Áudio ------------------------------------------------------------------------------------

test("AUDIO: sem texto na chegada não dispara; a transcrição dispara depois", () => {
  const arrival = evaluateRadarRisk(inbound(undefined));
  assert.equal(arrival.score, 0);
  assert.equal(arrival.signals.hasKeywordTrigger, false);
  const transcribed = evaluateRadarRisk({ ...inbound(undefined), transcriptionText: "olha, eu quero cancelar esse serviço" }, asPrevious(arrival));
  assert.equal(transcribed.signals.hasCancellation, true);
  assert.equal(transcribed.isDirectCritical, true);
  assert.ok(transcribed.score >= 35);
});

// --- Keywords configuráveis -------------------------------------------------------------------

function override(partial) {
  return { id: "kw", tenantId: "t", workspaceId: "w", enabled: true, createdAt: "", updatedAt: "", ...partial };
}

test("KEYWORDS_CONFIGURAVEIS: adicionar, desabilitar, trocar categoria e peso sem alterar código", () => {
  const added = resolveRadarKeywords([override({ keyword: "Vou pro Concorrente X", category: "cancellation" })]);
  assert.ok(matchRadarKeywords("acho que vou pro concorrente x", added).some((match) => match.category === "cancellation"));

  const disabled = resolveRadarKeywords([override({ keyword: "urgente", category: "complaint", enabled: false })]);
  assert.equal(matchRadarKeywords("é urgente", disabled).length, 0, "keyword padrão desabilitada some");
  assert.ok(matchRadarKeywords("é urgente", KEYWORDS).length > 0, "o default continua intacto");

  const recategorized = resolveRadarKeywords([override({ keyword: "prejuizo", category: "legal", weight: 50 })]);
  const result = evaluateRadarRisk({ ...inbound("prejuizo"), keywords: recategorized });
  assert.equal(result.signals.hasLegalThreat, true);
  assert.ok(result.score >= 50, "peso próprio da keyword vence o da categoria");
});

test("KEYWORDS_CONFIGURAVEIS: ajuste da equipe vence o do workspace e só vale para ela", () => {
  const overrides = [
    override({ id: "a", keyword: "urgente", category: "complaint", enabled: false }),
    override({ id: "b", keyword: "urgente", category: "complaint", enabled: true, weight: 40, teamId: "team-1" }),
  ];
  assert.equal(resolveRadarKeywords(overrides).some((keyword) => keyword.keyword === "urgente"), false);
  assert.equal(resolveRadarKeywords(overrides, "team-2").some((keyword) => keyword.keyword === "urgente"), false);
  assert.equal(resolveRadarKeywords(overrides, "team-1").find((keyword) => keyword.keyword === "urgente")?.weight, 40);
});

// --- Grupos e estado da IA --------------------------------------------------------------------

test("GRUPOS: conversa de grupo (@g.us) é identificada para ser ignorada", () => {
  assert.equal(isRadarGroupChat({ chatType: "group", externalChatId: "120363@g.us" }), true);
  assert.equal(isRadarGroupChat({ chatType: "direct", externalChatId: "120363@G.US" }), true);
  assert.equal(isRadarGroupChat({ chatType: "direct", externalChatId: "+5511999990000" }), false);
});

test("ESTADO_DA_IA: desatualizado só com sinal novo; COOLDOWN e PENDING abandonado são derivados", () => {
  const now = new Date("2026-10-13T15:00:00Z");
  const analyzed = { aiStatus: "ANALYZED", aiAnalyzedAt: "2026-10-13T14:30:00Z", aiAnalyzedScore: 60, score: 60, scoreChangedAt: "2026-10-13T14:29:00Z" };
  assert.equal(isRadarAiAnalysisStale(analyzed), false);
  assert.equal(isRadarAiAnalysisStale({ ...analyzed, score: 55 }), false, "decaimento não torna o diagnóstico desatualizado");
  assert.equal(isRadarAiAnalysisStale({ ...analyzed, score: 80, scoreChangedAt: "2026-10-13T14:40:00Z" }), true);

  assert.equal(deriveRadarAiDisplayStatus(analyzed, now), "ANALYZED");
  assert.equal(deriveRadarAiDisplayStatus({ ...analyzed, score: 80, scoreChangedAt: "2026-10-13T14:40:00Z", aiCooldownUntil: "2026-10-13T15:10:00Z" }, now), "COOLDOWN");
  assert.equal(deriveRadarAiDisplayStatus({ aiStatus: "NEVER_ANALYZED", score: 40, scoreChangedAt: "2026-10-13T14:00:00Z" }, now), "NEVER_ANALYZED");
  assert.equal(deriveRadarAiDisplayStatus({ ...analyzed, aiStatus: "BLOCKED_NO_CREDITS" }, now), "BLOCKED_NO_CREDITS");
  assert.equal(deriveRadarAiDisplayStatus({ ...analyzed, aiStatus: "PENDING", aiPendingSince: "2026-10-13T14:59:30Z" }, now), "PENDING");
  assert.equal(deriveRadarAiDisplayStatus({ ...analyzed, aiStatus: "PENDING", aiPendingSince: "2026-10-13T14:00:00Z" }, now), "ANALYZED", "PENDING abandonado nunca fica preso na tela");
});
