import {
  EMPTY_APPLIED_SIGNAL_POINTS,
  RADAR_DIRECT_CRITICAL_CATEGORIES,
  scoreToRiskLevel,
  type RadarAppliedSignalPoints,
  type RadarKeywordCategory,
  type RadarRiskLevel,
  type RadarSignals,
} from "./radar.model.js";
import { matchRadarKeywords, type RadarKeyword } from "./radar-keywords.js";
import { classifyRadarMessage } from "./sentiment-classifier.js";

/**
 * Motor de score do Radar (Camada 1, gratuita) — função pura, sem I/O.
 *
 * REGRA FUNDAMENTAL: sem keyword crítica na conversa (`hasKeywordTrigger = false`), o score fica
 * em 0 — espera, SLA e transferências sozinhos nunca viram alerta. Depois que uma keyword ativa a
 * conversa, tom negativo, urgência e os sinais operacionais passam a contribuir.
 *
 * O score é INCREMENTAL sobre o anterior: cada avaliação soma só o que há de novo (uma keyword
 * nesta mensagem, ou um sinal operacional que subiu de faixa). Avaliação sem nada novo aplica
 * decaimento.
 */

export const RADAR_SCORE_DECAY = 5;
const MAX_NEGATIVE_TONE_POINTS = 15;
const HIGH_URGENCY_POINTS = 10;
const MAX_TRACKED_KEYWORD_MATCHES = 20;

export type RadarEvaluationInput = {
  direction: "inbound" | "outbound";
  /** Texto da mensagem (corpo ou legenda). Ignorado em `outbound`. */
  text?: string;
  /** Transcrição do áudio, quando já disponível. */
  transcriptionText?: string;
  keywords: readonly RadarKeyword[];
  /** Minutos desde a mensagem do cliente mais antiga ainda sem resposta. */
  waitingMinutes: number;
  slaMinutes: number;
  transferCount: number;
  reopenCount: number;
  /** Mensagens do cliente desde a última resposta do atendimento (inclui a atual). */
  unansweredInboundCount: number;
};

export type RadarPreviousState = {
  score: number;
  hasKeywordTrigger: boolean;
  signals?: RadarSignals;
};

export type RadarEvaluationResult = {
  score: number;
  level: RadarRiskLevel;
  reasons: string[];
  signals: RadarSignals;
  /** Pontos somados nesta avaliação (0 = nada novo → decaimento). */
  delta: number;
  /** Esta mensagem trouxe ao menos uma keyword. */
  messageHadKeyword: boolean;
  /** Esta mensagem trouxe cancelamento, ameaça jurídica ou pedido de gerente/supervisor. */
  isDirectCritical: boolean;
};

function waitPoints(waitingMinutes: number): number {
  if (waitingMinutes >= 60) return 25;
  if (waitingMinutes >= 30) return 15;
  if (waitingMinutes >= 15) return 8;
  return 0;
}

function transferPoints(transferCount: number): number {
  if (transferCount >= 3) return 20;
  if (transferCount >= 2) return 10;
  return 0;
}

function reopenPoints(reopenCount: number): number {
  if (reopenCount >= 2) return 25;
  if (reopenCount === 1) return 15;
  return 0;
}

function noReplyPoints(unansweredInboundCount: number): number {
  if (unansweredInboundCount >= 3) return 20;
  if (unansweredInboundCount >= 2) return 10;
  return 0;
}

const CATEGORY_REASON_LABELS: Record<RadarKeywordCategory, string> = {
  cancellation: "Ameaça de cancelamento",
  legal: "Ameaça jurídica/Procon",
  manager: "Pedido de gerente/supervisor",
  complaint: "Reclamação grave",
};

/** Motivos do alerta, sempre reconstruídos a partir do estado atual dos sinais — nunca um
 * acúmulo de frases antigas que já deixaram de valer (ex.: espera que já foi respondida). */
function buildReasons(signals: RadarSignals, unansweredInboundCount: number): string[] {
  const reasons: string[] = [];
  for (const category of Object.keys(CATEGORY_REASON_LABELS) as RadarKeywordCategory[]) {
    const matched = signals.keywordMatches.filter((match) => match.category === category).map((match) => `"${match.keyword}"`);
    if (matched.length > 0) reasons.push(`${CATEGORY_REASON_LABELS[category]} (${matched.slice(0, 3).join(", ")})`);
  }
  if (signals.sentiment === "negative") reasons.push("Tom negativo na última mensagem do cliente");
  if (signals.urgency === "high") reasons.push("Urgência alta");
  if (signals.waitingMinutes >= 30) reasons.push(`Cliente aguardando há ${signals.waitingMinutes} min sem resposta`);
  if (signals.slaBreached) reasons.push("SLA de resposta vencido");
  if (signals.transferCount >= 2) reasons.push(`${signals.transferCount} transferências`);
  if (signals.reopenCount >= 1) reasons.push(signals.reopenCount === 1 ? "Conversa reaberta" : `Conversa reaberta ${signals.reopenCount}x`);
  if (signals.inboundBurst) reasons.push("Excesso de mensagens do cliente sem retorno");
  else if (signals.noAgentResponse && unansweredInboundCount >= 3) reasons.push(`${unansweredInboundCount} mensagens do cliente sem resposta`);
  return reasons;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluateRadarRisk(input: RadarEvaluationInput, previous: RadarPreviousState = { score: 0, hasKeywordTrigger: false }): RadarEvaluationResult {
  const isInbound = input.direction === "inbound";
  const text = isInbound ? [input.text, input.transcriptionText].filter((part) => part && part.trim()).join(" . ") : "";
  const matches = text ? matchRadarKeywords(text, input.keywords) : [];
  const classification = classifyRadarMessage(text);
  const messageHadKeyword = matches.length > 0;
  const hasKeywordTrigger = previous.hasKeywordTrigger || messageHadKeyword;

  const previousSignals = previous.hasKeywordTrigger ? previous.signals : undefined;
  const applied: RadarAppliedSignalPoints = { ...EMPTY_APPLIED_SIGNAL_POINTS, ...(previousSignals?.applied ?? {}) };
  const waitingMinutes = isInbound ? Math.max(0, Math.floor(input.waitingMinutes)) : 0;
  const unanswered = isInbound ? input.unansweredInboundCount : 0;

  const matchedCategories = new Set(matches.map((match) => match.category));
  const keywordMatches = [...(previousSignals?.keywordMatches ?? [])];
  for (const match of matches) {
    if (!keywordMatches.some((existing) => existing.keyword === match.keyword)) keywordMatches.push({ keyword: match.keyword, category: match.category });
  }

  const signals: RadarSignals = {
    // Mensagem do atendimento não muda a leitura de sentimento do cliente.
    sentiment: isInbound ? classification.sentiment : previousSignals?.sentiment ?? "neutral",
    sentimentScore: isInbound ? classification.score : previousSignals?.sentimentScore ?? 0,
    urgency: isInbound ? classification.urgency : previousSignals?.urgency ?? "low",
    hasKeywordTrigger,
    hasCancellation: Boolean(previousSignals?.hasCancellation) || matchedCategories.has("cancellation"),
    hasLegalThreat: Boolean(previousSignals?.hasLegalThreat) || matchedCategories.has("legal"),
    hasManagerRequest: Boolean(previousSignals?.hasManagerRequest) || matchedCategories.has("manager"),
    hasComplaint: Boolean(previousSignals?.hasComplaint) || matchedCategories.has("complaint"),
    hasUrgency: Boolean(previousSignals?.hasUrgency) || (isInbound && classification.urgency === "high"),
    keywordMatches: keywordMatches.slice(-MAX_TRACKED_KEYWORD_MATCHES),
    waitingMinutes,
    slaBreached: isInbound && waitingMinutes >= input.slaMinutes,
    transferCount: input.transferCount,
    reopenCount: input.reopenCount,
    noAgentResponse: unanswered >= 2,
    inboundBurst: unanswered >= 5,
    applied,
  };

  // Sem keyword crítica na conversa: nenhum sinal estrutural pontua.
  if (!hasKeywordTrigger) {
    return {
      score: 0,
      level: "low",
      reasons: [],
      signals: { ...signals, applied: { ...EMPTY_APPLIED_SIGNAL_POINTS } },
      delta: 0,
      messageHadKeyword: false,
      isDirectCritical: false,
    };
  }

  let delta = 0;

  // Keywords desta mensagem — cada categoria conta uma vez, pelo maior peso casado.
  for (const category of matchedCategories) {
    delta += Math.max(...matches.filter((match) => match.category === category).map((match) => match.weight));
  }

  if (isInbound && text) {
    if (classification.sentiment === "negative") delta += Math.min(MAX_NEGATIVE_TONE_POINTS, Math.round(Math.abs(classification.score) * MAX_NEGATIVE_TONE_POINTS));
    if (classification.urgency === "high") delta += HIGH_URGENCY_POINTS;
  }

  if (isInbound) {
    const current: RadarAppliedSignalPoints = {
      wait: waitPoints(waitingMinutes),
      sla: signals.slaBreached ? 20 : 0,
      transfer: transferPoints(input.transferCount),
      reopen: reopenPoints(input.reopenCount),
      noReply: noReplyPoints(unanswered),
      burst: signals.inboundBurst ? 15 : 0,
    };
    for (const family of Object.keys(current) as (keyof RadarAppliedSignalPoints)[]) {
      delta += Math.max(0, current[family] - applied[family]);
      applied[family] = Math.max(applied[family], current[family]);
    }
  } else {
    // O atendimento respondeu: os sinais de espera zeram e podem voltar a pontuar no futuro.
    // Transferências e reaberturas são históricas, nunca zeram.
    applied.wait = 0;
    applied.sla = 0;
    applied.noReply = 0;
    applied.burst = 0;
  }

  const score = delta > 0 ? clampScore(previous.score + delta) : clampScore(previous.score - RADAR_SCORE_DECAY);

  return {
    score,
    level: scoreToRiskLevel(score),
    reasons: buildReasons(signals, unanswered),
    signals,
    delta,
    messageHadKeyword,
    isDirectCritical: RADAR_DIRECT_CRITICAL_CATEGORIES.some((category) => matchedCategories.has(category)),
  };
}
