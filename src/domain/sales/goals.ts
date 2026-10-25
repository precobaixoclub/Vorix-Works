import { localDate, localMidnightUtc } from "../shared/company-time.js";
/**
 * Sales Engine — metas comerciais e períodos. Puro e determinístico: o realizado vem SEMPRE de
 * oportunidades GANHAS (snapshot do fechamento), nunca de propostas enviadas/abertas ou commit.
 * Datas de período em UTC (`YYYY-MM-DD`); o crédito da venda usa `closedAt`.
 */

export const GOAL_SCOPES = ["user", "team", "company"] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];

export const GOAL_METRICS = ["sales_revenue", "gross_margin", "won_opportunities", "new_customers", "mrr", "arr", "activities", "meetings", "average_ticket"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
/** Liberadas nesta versão; as demais existem no modelo para evolução sem migração. */
export const ACTIVE_GOAL_METRICS: readonly GoalMetric[] = ["sales_revenue", "gross_margin", "won_opportunities", "mrr"];

export const GOAL_PERIODS = ["monthly", "quarterly", "annual"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export type SalesGoal = {
  id: string;
  tenantId: string;
  workspaceId: string;
  scopeType: GoalScope;
  scopeId?: string;
  metric: GoalMetric;
  periodType: GoalPeriod;
  periodStart: string;
  targetValue: number;
  currency: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

/** Normaliza o início do período (mês → dia 1; trimestre → 1º mês do trimestre; ano → 1º de jan). */
export function normalizePeriodStart(periodType: GoalPeriod, date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("SALES_GOAL_INVALID: informe uma data válida no formato AAAA-MM-DD.");
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) throw new Error("SALES_GOAL_INVALID: data inexistente.");
  if (periodType === "annual") return `${year}-01-01`;
  if (periodType === "quarterly") return `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Intervalo [início, fim) em ISO — fim exclusivo. */
export function periodRange(periodType: GoalPeriod, periodStart: string, timeZone = "UTC"): { from: string; to: string } {
  const [year, month] = normalizePeriodStart(periodType, periodStart).split("-").map(Number);
  const months = periodType === "annual" ? 12 : periodType === "quarterly" ? 3 : 1;
  const end = new Date(Date.UTC(year, month - 1 + months, 1));
  return { from: localMidnightUtc(year, month, 1, timeZone), to: localMidnightUtc(end.getUTCFullYear(), end.getUTCMonth() + 1, 1, timeZone) };
}

export function previousPeriodStart(periodType: GoalPeriod, periodStart: string): string {
  const [year, month] = normalizePeriodStart(periodType, periodStart).split("-").map(Number);
  const months = periodType === "annual" ? 12 : periodType === "quarterly" ? 3 : 1;
  const date = new Date(Date.UTC(year, month - 1 - months, 1));
  return date.toISOString().slice(0, 10);
}

export type WonDealFacts = {
  id: string;
  creditedOwnerUserId?: string;
  creditedTeamId?: string;
  contactId?: string;
  closedAt: string;
  finalValueCents: number;
  finalGrossProfitCents?: number;
  finalMrrCents?: number;
};

/** Realizado de uma métrica sobre ganhos já filtrados (escopo/período). */
export function realizedValue(metric: GoalMetric, deals: readonly WonDealFacts[]): number {
  switch (metric) {
    case "sales_revenue": return deals.reduce((sum, deal) => sum + deal.finalValueCents, 0);
    case "gross_margin": return deals.reduce((sum, deal) => sum + (deal.finalGrossProfitCents ?? 0), 0);
    case "won_opportunities": return deals.length;
    case "mrr": return deals.reduce((sum, deal) => sum + (deal.finalMrrCents ?? 0), 0);
    case "arr": return deals.reduce((sum, deal) => sum + (deal.finalMrrCents ?? 0) * 12, 0);
    case "average_ticket": return deals.length ? Math.round(deals.reduce((sum, deal) => sum + deal.finalValueCents, 0) / deals.length) : 0;
    case "new_customers": return new Set(deals.map((deal) => deal.contactId).filter(Boolean)).size;
    default: return 0;
  }
}

export function dealsInGoalScope(goal: Pick<SalesGoal, "scopeType" | "scopeId">, deals: readonly WonDealFacts[]): WonDealFacts[] {
  if (goal.scopeType === "company") return [...deals];
  if (goal.scopeType === "user") return deals.filter((deal) => deal.creditedOwnerUserId === goal.scopeId);
  return deals.filter((deal) => deal.creditedTeamId === goal.scopeId);
}

export type GoalProgress = {
  targetValue: number;
  realizedValue: number;
  /** Basis points (10000 = 100%). */
  attainmentBp: number;
  remainingValue: number;
  reached: boolean;
};

export function goalProgress(targetValue: number, realized: number): GoalProgress {
  return {
    targetValue,
    realizedValue: realized,
    attainmentBp: targetValue > 0 ? Math.round((realized * 10000) / targetValue) : 0,
    remainingValue: Math.max(0, targetValue - realized),
    reached: realized >= targetValue,
  };
}

/** Ritmo e projeção linear para metas de período longo (ano/trimestre) — explicitamente estimativa. */
export function paceAndProjection(periodType: GoalPeriod, periodStart: string, targetValue: number, realized: number, now: Date, timeZone = "UTC"): { elapsedMonths: number; totalMonths: number; requiredPerRemainingMonth: number; projectedValue: number } {
  const { from, to } = periodRange(periodType, periodStart, timeZone);
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const totalMonths = periodType === "annual" ? 12 : periodType === "quarterly" ? 3 : 1;
  const fraction = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  const elapsedMonths = Math.round(fraction * totalMonths * 10) / 10;
  // Meses de calendário já encerrados (dias/365 erraria por fração em meses de 28–31 dias).
  const [startYear, startMonth] = normalizePeriodStart(periodType, periodStart).split("-").map(Number);
  const current = localDate(now, timeZone);
  const completedMonths = Math.min(totalMonths, Math.max(0, (current.year - startYear) * 12 + (current.month - startMonth)));
  const remainingMonths = Math.max(1, totalMonths - completedMonths);
  return {
    elapsedMonths,
    totalMonths,
    requiredPerRemainingMonth: Math.ceil(Math.max(0, targetValue - realized) / remainingMonths),
    projectedValue: fraction > 0 ? Math.round(realized / fraction) : realized,
  };
}
