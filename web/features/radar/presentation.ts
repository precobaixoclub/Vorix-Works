import type { RadarAiOutcome, RadarAlert, RadarCredits, RadarKeywordCategory, RadarRiskLevel } from "./types";

/**
 * Textos e decisões de exibição do Radar — funções puras, testadas em
 * `tests/radar-presentation.test.ts`. Regra que atravessa tudo aqui: falta de crédito nunca
 * esconde o score, nunca esconde o último diagnóstico e nunca finge que ele está atualizado.
 */

export const RADAR_LEVEL_LABEL: Record<RadarRiskLevel, string> = { low: "Baixo", medium: "Médio", high: "Alto", critical: "Crítico" };

/** Vocabulário fechado de acentos do design system — nunca hex solto. */
export const RADAR_LEVEL_CLASS: Record<RadarRiskLevel, string> = {
  low: "border-border bg-muted text-muted-foreground",
  medium: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300",
  high: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
};

export const RADAR_CATEGORY_LABEL: Record<RadarKeywordCategory, string> = {
  cancellation: "Cancelamento",
  legal: "Jurídico",
  manager: "Gerente/supervisor",
  complaint: "Reclamação grave",
};

export const RADAR_MAIN_RISK_LABEL: Record<string, string> = { churn: "Churn", insatisfacao: "Insatisfação", escalamento: "Escalamento", financeiro: "Financeiro", outro: "Outro" };
export const RADAR_PRIORITY_LABEL: Record<string, string> = { critica: "Crítica", alta: "Alta", media: "Média" };

export function formatWaitingMinutes(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export type RadarAiIndicatorTone = "ok" | "warning" | "blocked" | "neutral";
export type RadarAiIndicator = { label: string; tone: RadarAiIndicatorTone };

/** Indicador da coluna "IA" da lista: atualizada, desatualizada ou bloqueada por créditos. */
export function radarAiIndicator(alert: Pick<RadarAlert, "aiDisplayStatus" | "aiStale" | "aiAnalyzedAt">): RadarAiIndicator {
  switch (alert.aiDisplayStatus) {
    case "BLOCKED_NO_CREDITS":
      return { label: "IA bloqueada por créditos", tone: "blocked" };
    case "PENDING":
      return { label: "IA analisando…", tone: "neutral" };
    case "FAILED_PROVIDER":
      return { label: alert.aiAnalyzedAt ? "IA desatualizada" : "IA indisponível", tone: "warning" };
    case "COOLDOWN":
      return { label: "IA desatualizada", tone: "warning" };
    case "ANALYZED":
      return alert.aiStale ? { label: "IA desatualizada", tone: "warning" } : { label: "IA atualizada", tone: "ok" };
    default:
      return { label: "Sem diagnóstico", tone: "neutral" };
  }
}

export const RADAR_AI_TONE_CLASS: Record<RadarAiIndicatorTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300",
  blocked: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** `true` quando os créditos de IA acabaram (ou a conta está bloqueada) — é o que liga o banner
 * comercial. Ambiente sem IA configurada NÃO é "sem créditos". */
export function isOutOfAiCredits(credits: RadarCredits | undefined): boolean {
  return Boolean(credits?.aiConfigured && !credits.available);
}

export type RadarCreditsBanner = { title: string; body: string; cta: string };

/** Banner comercial do topo da tela. `undefined` = não mostrar. */
export function radarCreditsBanner(credits: RadarCredits | undefined): RadarCreditsBanner | undefined {
  if (!isOutOfAiCredits(credits)) return undefined;
  if (credits?.blockedReason === "account_blocked") {
    return {
      title: "Diagnósticos de IA suspensos",
      body: "Os alertas e scores do Radar continuam funcionando. Para voltar a receber diagnósticos detalhados da IA, regularize sua assinatura. Você ainda pode consultar o último diagnóstico disponível.",
      cta: "Ver plano e cobrança",
    };
  }
  return {
    title: "Seus créditos de IA acabaram",
    body: "O Radar de Sentimento continua monitorando os sinais de risco das conversas, mas novos diagnósticos detalhados por IA estão temporariamente suspensos. Você ainda pode consultar o último diagnóstico disponível.",
    cta: "Adicionar créditos",
  };
}

export type RadarDiagnosisNotice = { badge?: string; message: string; showBuyCredits: boolean };

/**
 * Aviso exibido acima do diagnóstico no detalhe. `undefined` = diagnóstico em dia, sem aviso.
 * Nunca devolve algo que mande esconder um diagnóstico existente.
 */
export function radarDiagnosisNotice(alert: Pick<RadarAlert, "aiDisplayStatus" | "aiStale" | "aiAnalysis">, credits: RadarCredits | undefined): RadarDiagnosisNotice | undefined {
  const hasDiagnosis = Boolean(alert.aiAnalysis);
  const outOfCredits = isOutOfAiCredits(credits) || alert.aiDisplayStatus === "BLOCKED_NO_CREDITS";

  if (!hasDiagnosis) {
    if (outOfCredits) {
      return {
        message: "Esta conversa ainda não possui diagnóstico por IA. O Radar identificou sinais de risco, mas seus créditos acabaram antes da análise aprofundada. Adicione créditos para gerar uma análise aprofundada.",
        showBuyCredits: true,
      };
    }
    if (credits && !credits.aiConfigured) return { message: "O diagnóstico por IA não está habilitado neste ambiente. O score e os sinais do Radar seguem funcionando normalmente.", showBuyCredits: false };
    if (alert.aiDisplayStatus === "PENDING") return { message: "A IA está analisando esta conversa agora.", showBuyCredits: false };
    if (alert.aiDisplayStatus === "FAILED_PROVIDER") return { message: "A última tentativa de diagnóstico não foi concluída. Nenhum crédito foi consumido — tente novamente em alguns minutos.", showBuyCredits: false };
    return { message: "Esta conversa ainda não possui diagnóstico por IA.", showBuyCredits: false };
  }

  if (!alert.aiStale && alert.aiDisplayStatus === "ANALYZED") return undefined;

  if (outOfCredits) {
    return {
      badge: "Diagnóstico não atualizado",
      message: "Seus créditos de IA acabaram. O Radar continua monitorando esta conversa, mas novos diagnósticos por IA estão suspensos. Abaixo está o último diagnóstico disponível.",
      showBuyCredits: true,
    };
  }
  if (alert.aiDisplayStatus === "PENDING") return { badge: "Atualizando", message: "A IA está gerando um novo diagnóstico. Abaixo está o último disponível.", showBuyCredits: false };
  if (alert.aiDisplayStatus === "FAILED_PROVIDER") {
    return { badge: "Diagnóstico não atualizado", message: "A última tentativa de atualizar o diagnóstico não foi concluída e nenhum crédito foi consumido. Abaixo está o último diagnóstico disponível.", showBuyCredits: false };
  }
  return { badge: "Diagnóstico não atualizado", message: "A conversa mudou depois deste diagnóstico. Um novo será gerado no próximo gatilho, respeitando o intervalo mínimo entre análises.", showBuyCredits: false };
}

/** Mensagem de retorno do botão "Analisar agora". */
export function radarReanalyzeFeedback(outcome: RadarAiOutcome): { kind: "success" | "info" | "error"; message: string } {
  switch (outcome) {
    case "completed":
      return { kind: "success", message: "Diagnóstico atualizado." };
    case "blocked_no_credits":
      return { kind: "info", message: "Seus créditos de IA acabaram. Adicione créditos para gerar um novo diagnóstico." };
    case "cooldown":
      return { kind: "info", message: "Esta conversa foi analisada há pouco. Aguarde o intervalo mínimo entre análises." };
    case "disabled":
      return { kind: "info", message: "O diagnóstico por IA não está habilitado neste ambiente." };
    default:
      return { kind: "error", message: "Não foi possível concluir o diagnóstico agora. Nenhum crédito foi consumido." };
  }
}
