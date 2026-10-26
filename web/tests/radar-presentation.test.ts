import { describe, expect, it } from "vitest";
import { formatWaitingMinutes, isOutOfAiCredits, radarAiIndicator, radarCreditsBanner, radarDiagnosisNotice, radarReanalyzeFeedback } from "../features/radar/presentation";
import type { RadarAiAnalysis, RadarCredits } from "../features/radar/types";

const NO_CREDITS: RadarCredits = { aiConfigured: true, available: false, remainingCredits: 0, creditsCost: 0, blockedReason: "no_credits" };
const WITH_CREDITS: RadarCredits = { aiConfigured: true, available: true, remainingCredits: 127, creditsCost: 1 };
const NOT_CONFIGURED: RadarCredits = { aiConfigured: false, available: false };
const ANALYSIS: RadarAiAnalysis = { diagnostico: "d", causaRaiz: "c", riscoPrincipal: "churn", acaoImediata: "a", prioridade: "alta", resumoParaGestor: "r" };

describe("banner de créditos", () => {
  it("aparece quando os créditos acabaram, com CTA para adicionar créditos", () => {
    const banner = radarCreditsBanner(NO_CREDITS);
    expect(banner?.title).toBe("Seus créditos de IA acabaram");
    expect(banner?.cta).toBe("Adicionar créditos");
    expect(banner?.body).toContain("continua monitorando");
    expect(banner?.body).toContain("último diagnóstico disponível");
  });

  it("não aparece com saldo, sem dados ainda, ou quando a IA nem está habilitada", () => {
    expect(radarCreditsBanner(WITH_CREDITS)).toBeUndefined();
    expect(radarCreditsBanner(undefined)).toBeUndefined();
    expect(radarCreditsBanner(NOT_CONFIGURED)).toBeUndefined();
    expect(isOutOfAiCredits(NOT_CONFIGURED)).toBe(false);
  });

  it("conta bloqueada orienta a regularizar, não a comprar crédito", () => {
    expect(radarCreditsBanner({ ...NO_CREDITS, blockedReason: "account_blocked" })?.cta).toBe("Ver plano e cobrança");
  });
});

describe("aviso do diagnóstico", () => {
  it("sem créditos e nunca analisado: informa a indisponibilidade com CTA", () => {
    const notice = radarDiagnosisNotice({ aiDisplayStatus: "BLOCKED_NO_CREDITS", aiStale: false, aiAnalysis: undefined }, NO_CREDITS);
    expect(notice?.message).toContain("ainda não possui diagnóstico por IA");
    expect(notice?.message).toContain("Adicione créditos");
    expect(notice?.showBuyCredits).toBe(true);
  });

  it("sem créditos com diagnóstico anterior: marca como não atualizado e mantém o diagnóstico", () => {
    const notice = radarDiagnosisNotice({ aiDisplayStatus: "BLOCKED_NO_CREDITS", aiStale: true, aiAnalysis: ANALYSIS }, NO_CREDITS);
    expect(notice?.badge).toBe("Diagnóstico não atualizado");
    expect(notice?.message).toContain("último diagnóstico disponível");
    expect(notice?.showBuyCredits).toBe(true);
  });

  it("diagnóstico em dia não mostra aviso — mesmo que o saldo tenha acabado depois", () => {
    expect(radarDiagnosisNotice({ aiDisplayStatus: "ANALYZED", aiStale: false, aiAnalysis: ANALYSIS }, WITH_CREDITS)).toBeUndefined();
    expect(radarDiagnosisNotice({ aiDisplayStatus: "ANALYZED", aiStale: false, aiAnalysis: ANALYSIS }, NO_CREDITS)).toBeUndefined();
  });

  it("nunca finge que um diagnóstico desatualizado está em dia", () => {
    expect(radarDiagnosisNotice({ aiDisplayStatus: "COOLDOWN", aiStale: true, aiAnalysis: ANALYSIS }, WITH_CREDITS)?.badge).toBe("Diagnóstico não atualizado");
    expect(radarDiagnosisNotice({ aiDisplayStatus: "FAILED_PROVIDER", aiStale: true, aiAnalysis: ANALYSIS }, WITH_CREDITS)?.badge).toBe("Diagnóstico não atualizado");
  });

  it("falha de provider e IA desabilitada nunca pedem compra de crédito", () => {
    expect(radarDiagnosisNotice({ aiDisplayStatus: "FAILED_PROVIDER", aiStale: false, aiAnalysis: undefined }, WITH_CREDITS)?.showBuyCredits).toBe(false);
    expect(radarDiagnosisNotice({ aiDisplayStatus: "NEVER_ANALYZED", aiStale: false, aiAnalysis: undefined }, NOT_CONFIGURED)?.showBuyCredits).toBe(false);
  });
});

describe("indicador de IA da lista", () => {
  it("distingue atualizada, desatualizada e bloqueada por créditos", () => {
    expect(radarAiIndicator({ aiDisplayStatus: "ANALYZED", aiStale: false, aiAnalyzedAt: "x" })).toEqual({ label: "IA atualizada", tone: "ok" });
    expect(radarAiIndicator({ aiDisplayStatus: "ANALYZED", aiStale: true, aiAnalyzedAt: "x" }).label).toBe("IA desatualizada");
    expect(radarAiIndicator({ aiDisplayStatus: "COOLDOWN", aiStale: true, aiAnalyzedAt: "x" }).label).toBe("IA desatualizada");
    expect(radarAiIndicator({ aiDisplayStatus: "BLOCKED_NO_CREDITS", aiStale: true, aiAnalyzedAt: "x" })).toEqual({ label: "IA bloqueada por créditos", tone: "blocked" });
    expect(radarAiIndicator({ aiDisplayStatus: "NEVER_ANALYZED", aiStale: false }).label).toBe("Sem diagnóstico");
  });
});

describe("retorno do 'Analisar agora'", () => {
  it("falta de crédito e cooldown são avisos, nunca erro técnico", () => {
    expect(radarReanalyzeFeedback("blocked_no_credits").kind).toBe("info");
    expect(radarReanalyzeFeedback("cooldown").kind).toBe("info");
    expect(radarReanalyzeFeedback("completed").kind).toBe("success");
    expect(radarReanalyzeFeedback("failed_provider").message).toContain("Nenhum crédito foi consumido");
  });
});

describe("tempo sem resposta", () => {
  it("formata minutos e horas, e usa travessão para ausente", () => {
    expect(formatWaitingMinutes(0)).toBe("—");
    expect(formatWaitingMinutes(undefined)).toBe("—");
    expect(formatWaitingMinutes(45)).toBe("45 min");
    expect(formatWaitingMinutes(120)).toBe("2 h");
    expect(formatWaitingMinutes(135)).toBe("2 h 15 min");
  });
});
