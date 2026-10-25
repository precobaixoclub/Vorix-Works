import { localDateIso } from "../../domain/shared/company-time.js";
import type { Deal, PipelineStage } from "../../domain/crm/crm.model.js";
import {
  ACTIVE_GOAL_METRICS,
  dealsInGoalScope,
  goalProgress,
  normalizePeriodStart,
  paceAndProjection,
  periodRange,
  previousPeriodStart,
  realizedValue,
  type GoalMetric,
  type GoalPeriod,
  type GoalProgress,
  type GoalScope,
  type SalesGoal,
  type WonDealFacts,
} from "../../domain/sales/goals.js";
import { hasPermission } from "../../domain/identity/identity.model.js";
import type { SalesAnalyticsRepositoryPort, SalesGoalRepositoryPort } from "../ports/sales-goal-repository.port.js";
import { notifyBestEffort } from "../notification/notification-use-cases.js";
import { fireDealAutomation, resolveDealProbability } from "./deal-commercial-use-cases.js";
import { isSalesManager, listManagerUserIds, loadCommercialSettings, mustDealInWorkspace, resolveVisibility, type SalesActor, type SalesEngineDeps } from "./sales-context.js";

export type SalesPerformanceDeps = SalesEngineDeps & { goalRepository: SalesGoalRepositoryPort; analyticsRepository: SalesAnalyticsRepositoryPort };

async function companyTimeZone(deps: SalesEngineDeps, workspaceId: string): Promise<string> {
  return (await deps.workspaceRepository?.getById(workspaceId))?.settings?.timezone || "America/Sao_Paulo";
}

const DAY_MS = 86_400_000;
const bp = (part: number, whole: number): number | undefined => (whole > 0 ? Math.round((part * 10000) / whole) : undefined);

function toWonFacts(deal: Deal): WonDealFacts {
  return {
    id: deal.id,
    creditedOwnerUserId: deal.creditedOwnerUserId ?? deal.ownerUserId,
    creditedTeamId: deal.creditedTeamId ?? deal.teamId,
    contactId: deal.contactId,
    closedAt: deal.closedAt ?? deal.wonAt ?? deal.updatedAt,
    finalValueCents: deal.finalValueCents ?? deal.valueCents,
    finalGrossProfitCents: deal.finalGrossProfitCents,
    finalMrrCents: deal.finalMrrCents,
  };
}

export type ReportSubject = { userId?: string; teamId?: string; teamIds?: string[] };

/** "Minhas equipes" — consolidado das equipes das quais a pessoa participa. */
export const MY_TEAMS = "mine";

/**
 * Sujeito de um relatório/dashboard dentro do escopo (0173): `sales_report:read_all` vê empresa,
 * qualquer equipe ou pessoa; `sales_report:read_team` vê as próprias equipes (uma, ou todas
 * consolidadas com `teamId: "mine"`), os colegas delas e a si mesma; sem nenhuma, só a si mesma.
 * Pedir algo fora do escopo é erro (nunca devolve silenciosamente outro recorte).
 */
export async function resolveReportSubject(deps: Pick<SalesPerformanceDeps, "teamMembershipRepository">, actor: SalesActor, requested: { userId?: string; teamId?: string }): Promise<ReportSubject> {
  const all = hasPermission(actor, "sales_report:read_all");
  const team = all || hasPermission(actor, "sales_report:read_team");
  if (!team) {
    if (requested.teamId || (requested.userId && requested.userId !== actor.userId)) throw new Error("SALES_REPORT_FORBIDDEN: você só pode ver a sua própria performance.");
    return { userId: actor.userId };
  }
  const memberTeams = (await deps.teamMembershipRepository.listByUser(actor.userId, actor.tenantId)).filter(m => actor.role !== "admin" || m.role === "owner" || m.role === "admin").map((membership) => membership.teamId);
  if (requested.teamId === MY_TEAMS) return memberTeams.length ? { teamIds: memberTeams, ...(requested.userId ? { userId: requested.userId } : {}) } : { userId: actor.userId };
  if (all) return requested;
  if (requested.teamId && !memberTeams.includes(requested.teamId)) throw new Error("SALES_REPORT_FORBIDDEN: esta equipe está fora do seu escopo.");
  if (requested.userId && requested.userId !== actor.userId) {
    const colleagues = new Set<string>();
    for (const teamId of memberTeams) for (const member of await deps.teamMembershipRepository.listByTeam(teamId)) colleagues.add(member.userId);
    if (!colleagues.has(requested.userId)) throw new Error("SALES_REPORT_FORBIDDEN: esta pessoa está fora do seu escopo.");
  }
  if (!requested.userId && !requested.teamId) return memberTeams.length ? { teamIds: memberTeams } : { userId: actor.userId };
  return requested.userId && requested.userId !== actor.userId && !requested.teamId ? { ...requested, teamIds: memberTeams } : requested;
}

/** Oportunidade dentro do sujeito do relatório (`credited` = responsável/equipe CREDITADOS no fechamento). */
export function matchesSubject(deal: Deal, subject: ReportSubject, credited: boolean): boolean {
  const owner = credited ? deal.creditedOwnerUserId ?? deal.ownerUserId : deal.ownerUserId;
  const team = credited ? deal.creditedTeamId ?? deal.teamId : deal.teamId;
  if (subject.userId && owner !== subject.userId) return false;
  if (subject.teamId && team !== subject.teamId) return false;
  if (subject.teamIds && !(team && subject.teamIds.includes(team))) return false;
  return true;
}

/** Metas visíveis: própria sempre; equipes das quais participa (e colegas) com `goal:read_team`;
 * todas (inclusive a da empresa) com `goal:read_all`. */
async function filterGoalsInScope(deps: Pick<SalesPerformanceDeps, "teamMembershipRepository">, actor: SalesActor, goals: SalesGoal[]): Promise<SalesGoal[]> {
  if (hasPermission(actor, "goal:read_all")) return goals;
  if (!hasPermission(actor, "goal:read_team")) return goals.filter((goal) => goal.scopeType === "user" && goal.scopeId === actor.userId);
  const teams = new Set((await deps.teamMembershipRepository.listByUser(actor.userId, actor.tenantId)).filter(m => actor.role !== "admin" || m.role === "owner" || m.role === "admin").map((membership) => membership.teamId));
  const colleagues = new Set<string>([actor.userId]);
  for (const teamId of teams) for (const member of await deps.teamMembershipRepository.listByTeam(teamId)) colleagues.add(member.userId);
  return goals.filter((goal) => (goal.scopeType === "user" && goal.scopeId && colleagues.has(goal.scopeId)) || (goal.scopeType === "team" && goal.scopeId && teams.has(goal.scopeId)));
}

/** Definir metas (`goal:manage`): com escopo global, qualquer uma; senão só metas das equipes que
 * a pessoa GERENCIA e dos membros delas — nunca a da empresa. */
async function assertGoalInManageScope(deps: Pick<SalesPerformanceDeps, "teamMembershipRepository">, actor: SalesActor, goal: { scopeType: GoalScope; scopeId?: string }): Promise<void> {
  if (!hasPermission(actor, "goal:manage")) throw new Error("SALES_REPORT_FORBIDDEN: só a gestão define metas.");
  if (hasPermission(actor, "goal:read_all")) return;
  const managed = (await deps.teamMembershipRepository.listByUser(actor.userId, actor.tenantId)).filter((membership) => membership.role === "owner" || membership.role === "admin").map((membership) => membership.teamId);
  if (goal.scopeType === "team" && goal.scopeId && managed.includes(goal.scopeId)) return;
  if (goal.scopeType === "user" && goal.scopeId) {
    for (const teamId of managed) if ((await deps.teamMembershipRepository.listByTeam(teamId)).some((member) => member.userId === goal.scopeId)) return;
  }
  throw new Error("SALES_REPORT_FORBIDDEN: você só define metas das equipes que gerencia e dos membros delas.");
}

async function stageMap(deps: SalesPerformanceDeps, deals: readonly Deal[]): Promise<Map<string, PipelineStage[]>> {
  const map = new Map<string, PipelineStage[]>();
  for (const pipelineId of new Set(deals.map((deal) => deal.pipelineId))) map.set(pipelineId, await deps.pipelineStageRepository.listByPipeline(pipelineId));
  return map;
}

// ---------------------------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------------------------

export type GoalWithProgress = SalesGoal & { progress: GoalProgress; pace?: ReturnType<typeof paceAndProjection> };

async function wonDealsBetween(deps: SalesPerformanceDeps, tenantId: string, workspaceId: string, from: string, to: string): Promise<Deal[]> {
  return deps.analyticsRepository.listDeals({ tenantId, workspaceId, statuses: ["won"], closedFrom: from, closedTo: to });
}

async function attachProgress(deps: SalesPerformanceDeps, tenantId: string, workspaceId: string, goals: readonly SalesGoal[], now: Date): Promise<GoalWithProgress[]> {
  if (goals.length === 0) return [];
  const timeZone = await companyTimeZone(deps, workspaceId);
  const ranges = goals.map((goal) => periodRange(goal.periodType, goal.periodStart, timeZone));
  const from = ranges.map((range) => range.from).sort()[0];
  const to = ranges.map((range) => range.to).sort().at(-1) as string;
  const won = (await wonDealsBetween(deps, tenantId, workspaceId, from, to)).map(toWonFacts);
  return goals.map((goal, index) => {
    const range = ranges[index];
    const inPeriod = dealsInGoalScope(goal, won.filter((deal) => deal.closedAt >= range.from && deal.closedAt < range.to));
    const progress = goalProgress(goal.targetValue, realizedValue(goal.metric, inPeriod));
    return { ...goal, progress, pace: goal.periodType !== "monthly" ? paceAndProjection(goal.periodType, goal.periodStart, goal.targetValue, progress.realizedValue, now, timeZone) : undefined };
  });
}

export async function listGoals(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; year?: number; periodType?: GoalPeriod; now?: Date }): Promise<GoalWithProgress[]> {
  if (!hasPermission(actor, "goal:read")) throw new Error("SALES_REPORT_FORBIDDEN: sem acesso a metas.");
  const now = input.now ?? new Date();
  const year = input.year ?? Number(localDateIso(now, await companyTimeZone(deps, input.workspaceId)).slice(0, 4));
  let goals = await deps.goalRepository.list({ tenantId: actor.tenantId, workspaceId: input.workspaceId, periodFrom: `${year}-01-01`, periodTo: `${year + 1}-01-01` });
  if (input.periodType) goals = goals.filter((goal) => goal.periodType === input.periodType);
  goals = await filterGoalsInScope(deps, actor, goals);
  return attachProgress(deps, actor.tenantId, input.workspaceId, goals, now);
}

type GoalInput = { workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; periodType: GoalPeriod; periodStart: string; targetValue: number; currency?: string };

/** Metas são definidas MÊS a MÊS; trimestre e ano são sempre a soma dos meses (nunca digitados). */
export async function upsertGoal(deps: SalesPerformanceDeps, actor: SalesActor, input: GoalInput): Promise<SalesGoal> {
  if (input.periodType !== "monthly") throw new Error("SALES_GOAL_INVALID: defina metas mensais — a meta trimestral e a anual são a soma dos meses.");
  const goal = await writeMonthlyGoal(deps, actor, input);
  await syncDerivedGoals(deps, actor, { workspaceId: input.workspaceId, scopeType: input.scopeType, scopeId: input.scopeId, metric: input.metric, year: Number(goal.periodStart.slice(0, 4)), currency: input.currency });
  return goal;
}

/** "Aplicar a todos os meses" e edição em lote: um valor por mês (null = sem meta), um único recálculo. */
export async function setMonthlyGoals(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; year: number; months: (number | null)[]; currency?: string }): Promise<GoalWithProgress[]> {
  if (input.scopeType !== "company" && !input.scopeId) throw new Error("SALES_GOAL_INVALID: informe o vendedor ou a equipe.");
  await assertGoalInManageScope(deps, actor, input);
  if (input.months.length !== 12) throw new Error("SALES_GOAL_INVALID: informe os 12 meses.");
  const existing = await scopeGoals(deps, actor, input);
  for (let index = 0; index < 12; index += 1) {
    const value = input.months[index];
    const periodStart = `${input.year}-${String(index + 1).padStart(2, "0")}-01`;
    const current = existing.find((goal) => goal.periodType === "monthly" && goal.periodStart === periodStart);
    if (value === null || !(value > 0)) {
      if (current) await removeGoal(deps, actor, input.workspaceId, current);
    } else if (!current || current.targetValue !== value) {
      await writeMonthlyGoal(deps, actor, { workspaceId: input.workspaceId, scopeType: input.scopeType, scopeId: input.scopeId, metric: input.metric, periodType: "monthly", periodStart, targetValue: value, currency: input.currency });
    }
  }
  await syncDerivedGoals(deps, actor, input);
  return listGoals(deps, actor, { workspaceId: input.workspaceId, year: input.year });
}

async function scopeGoals(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; year: number }): Promise<SalesGoal[]> {
  const goals = await deps.goalRepository.list({ tenantId: actor.tenantId, workspaceId: input.workspaceId, periodFrom: `${input.year}-01-01`, periodTo: `${input.year + 1}-01-01` });
  const scopeId = input.scopeType === "company" ? undefined : input.scopeId;
  return goals.filter((goal) => goal.scopeType === input.scopeType && (goal.scopeId ?? undefined) === scopeId && goal.metric === input.metric);
}

/** Recalcula as metas trimestrais e a anual a partir dos meses (remove as que ficaram sem meses). */
async function syncDerivedGoals(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; year: number; currency?: string }): Promise<void> {
  const goals = await scopeGoals(deps, actor, input);
  const monthly = goals.filter((goal) => goal.periodType === "monthly");
  const sumOf = (months: number[]) => monthly.filter((goal) => months.includes(Number(goal.periodStart.slice(5, 7)))).reduce((sum, goal) => sum + goal.targetValue, 0);
  const derived: { periodType: GoalPeriod; periodStart: string; months: number[] }[] = [
    { periodType: "annual", periodStart: `${input.year}-01-01`, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    ...[0, 1, 2, 3].map((quarter) => ({ periodType: "quarterly" as GoalPeriod, periodStart: `${input.year}-${String(quarter * 3 + 1).padStart(2, "0")}-01`, months: [quarter * 3 + 1, quarter * 3 + 2, quarter * 3 + 3] })),
  ];
  for (const target of derived) {
    const total = sumOf(target.months);
    const current = goals.find((goal) => goal.periodType === target.periodType && goal.periodStart === target.periodStart);
    if (total <= 0) {
      if (current) await removeGoal(deps, actor, input.workspaceId, current);
    } else if (!current || current.targetValue !== total) {
      await writeGoal(deps, actor, { workspaceId: input.workspaceId, scopeType: input.scopeType, scopeId: input.scopeId, metric: input.metric, periodType: target.periodType, periodStart: target.periodStart, targetValue: total, currency: input.currency });
    }
  }
}

async function removeGoal(deps: SalesPerformanceDeps, actor: SalesActor, workspaceId: string, goal: SalesGoal): Promise<void> {
  await deps.goalRepository.delete(goal.id);
  await deps.goalRepository.recordChange({ goalId: goal.id, tenantId: actor.tenantId, workspaceId, changedBy: actor.userId, fromValue: goal.targetValue, action: "deleted" });
}

async function writeMonthlyGoal(deps: SalesPerformanceDeps, actor: SalesActor, input: GoalInput): Promise<SalesGoal> {
  return writeGoal(deps, actor, { ...input, periodType: "monthly" });
}

async function writeGoal(deps: SalesPerformanceDeps, actor: SalesActor, input: GoalInput): Promise<SalesGoal> {
  if (input.scopeType !== "company" && !input.scopeId) throw new Error("SALES_GOAL_INVALID: informe o vendedor ou a equipe.");
  await assertGoalInManageScope(deps, actor, input);
  if (!ACTIVE_GOAL_METRICS.includes(input.metric)) throw new Error("SALES_GOAL_INVALID: este tipo de meta ainda não está disponível.");
  if (!(input.targetValue > 0) || !Number.isInteger(input.targetValue)) throw new Error("SALES_GOAL_INVALID: a meta deve ser um valor positivo.");
  if (input.scopeType === "user" && !(await deps.membershipRepository.getByUserAndTenant(input.scopeId as string, actor.tenantId))) throw new Error("SALES_GOAL_INVALID: vendedor não pertence a esta conta.");
  const { goal, previousTarget } = await deps.goalRepository.upsert({
    tenantId: actor.tenantId, workspaceId: input.workspaceId, scopeType: input.scopeType, scopeId: input.scopeType === "company" ? undefined : input.scopeId,
    metric: input.metric, periodType: input.periodType, periodStart: normalizePeriodStart(input.periodType, input.periodStart), targetValue: input.targetValue, currency: input.currency, actorUserId: actor.userId,
  });
  await deps.goalRepository.recordChange({ goalId: goal.id, tenantId: actor.tenantId, workspaceId: input.workspaceId, changedBy: actor.userId, fromValue: previousTarget, toValue: goal.targetValue, action: previousTarget === undefined ? "created" : "updated" });
  return goal;
}

export async function deleteGoal(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; goalId: string }): Promise<void> {
  if (!hasPermission(actor, "goal:manage")) throw new Error("SALES_REPORT_FORBIDDEN: só a gestão define metas.");
  const goal = await deps.goalRepository.getById(input.goalId);
  if (!goal || goal.tenantId !== actor.tenantId || goal.workspaceId !== input.workspaceId) throw new Error(`SALES_GOAL_NOT_FOUND: meta "${input.goalId}" não existe.`);
  await assertGoalInManageScope(deps, actor, goal);
  if (goal.periodType !== "monthly") throw new Error("SALES_GOAL_INVALID: a meta trimestral e a anual são a soma dos meses — remova os meses.");
  await removeGoal(deps, actor, input.workspaceId, goal);
  await syncDerivedGoals(deps, actor, { workspaceId: input.workspaceId, scopeType: goal.scopeType, scopeId: goal.scopeId, metric: goal.metric, year: Number(goal.periodStart.slice(0, 4)), currency: goal.currency });
}

/** "Meta atingida" — avaliado a cada ganho; notifica uma única vez por meta. */
export async function checkGoalsReached(deps: SalesPerformanceDeps, deal: Deal): Promise<void> {
  if (deal.status !== "won" || !deal.closedAt) return;
  const timeZone = await companyTimeZone(deps, deal.workspaceId);
  const day = localDateIso(new Date(deal.closedAt), timeZone);
  const candidates = (await deps.goalRepository.list({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, periodFrom: `${day.slice(0, 4)}-01-01`, periodTo: `${Number(day.slice(0, 4)) + 1}-01-01` }))
    .filter((goal) => {
      const range = periodRange(goal.periodType, goal.periodStart, timeZone);
      if (deal.closedAt! < range.from || deal.closedAt! >= range.to) return false;
      const facts = toWonFacts(deal);
      return dealsInGoalScope(goal, [facts]).length > 0;
    });
  // Trimestre e ano são a soma dos meses: o mesmo ganho pode "atingir" vários períodos de uma vez
  // (ex.: só um mês tem meta). Todos são marcados como atingidos, mas a pessoa recebe UM aviso por
  // escopo/indicador — o do período mais longo alcançado.
  const PERIOD_WEIGHT = { monthly: 1, quarterly: 2, annual: 3 } as const;
  const newlyReached: GoalWithProgress[] = [];
  for (const goal of await attachProgress(deps, deal.tenantId, deal.workspaceId, candidates, new Date())) {
    if (goal.progress.reached && (await deps.goalRepository.claimAchievement(goal.id, deal.id))) newlyReached.push(goal);
  }
  const byScope = new Map<string, GoalWithProgress>();
  for (const goal of newlyReached) {
    const key = `${goal.scopeType}:${goal.scopeId ?? ""}:${goal.metric}`;
    const current = byScope.get(key);
    if (!current || PERIOD_WEIGHT[goal.periodType] > PERIOD_WEIGHT[current.periodType]) byScope.set(key, goal);
  }
  for (const goal of byScope.values()) {
    const recipients = goal.scopeType === "user" ? [goal.scopeId as string] : await listManagerUserIds(deps, deal.tenantId);
    for (const userId of new Set(recipients)) {
      notifyBestEffort(deps.notification, {
        tenantId: deal.tenantId, workspaceId: deal.workspaceId, userId, title: "Meta atingida! 🎯",
        body: `${goal.scopeType === "user" ? "Sua meta" : goal.scopeType === "team" ? "A meta da equipe" : "A meta da empresa"} ${goal.periodType === "monthly" ? "do mês" : goal.periodType === "quarterly" ? "do trimestre" : "do ano"} foi alcançada.`,
        sourceType: "sales_goal_reached", sourceId: goal.id, sourceUrl: `/workspaces/${deal.workspaceId}/performance`,
      });
    }
    await fireDealAutomation(deps, deal, "goal_reached");
  }
}

// ---------------------------------------------------------------------------------------------
// Performance, forecast e impacto na meta
// ---------------------------------------------------------------------------------------------

export type ForecastBuckets = { wonCents: number; commitCents: number; bestCaseCents: number; pipelineCents: number; weightedCents: number };

function forecastFor(openDeals: readonly Deal[], stages: Map<string, PipelineStage[]>, range: { from: string; to: string }, wonCents: number, timeZone: string): ForecastBuckets {
  const inPeriod = openDeals.filter((deal) => deal.expectedCloseDate && deal.expectedCloseDate >= localDateIso(new Date(range.from), timeZone) && deal.expectedCloseDate < localDateIso(new Date(range.to), timeZone));
  const sum = (category: Deal["forecastCategory"]) => inPeriod.filter((deal) => deal.forecastCategory === category).reduce((total, deal) => total + deal.valueCents, 0);
  return {
    wonCents,
    commitCents: sum("commit"),
    bestCaseCents: sum("best_case"),
    pipelineCents: sum("pipeline"),
    weightedCents: inPeriod.filter((deal) => deal.forecastCategory !== "omitted").reduce((total, deal) => total + Math.round((deal.valueCents * resolveDealProbability(deal, stages.get(deal.pipelineId) ?? []).value) / 100), 0),
  };
}

export type PerformanceReport = {
  subject: { userId?: string; teamId?: string };
  period: { type: GoalPeriod; start: string; from: string; to: string };
  goals: GoalWithProgress[];
  won: { count: number; revenueCents: number; averageTicketCents?: number; grossProfitCents?: number; averageMarginBp?: number; mrrCents: number; arrCents: number };
  lost: { count: number; valueCents: number };
  conversionBp?: number;
  averageCycleDays?: number;
  pipeline: { openCount: number; openValueCents: number; weightedValueCents: number };
  forecast: ForecastBuckets;
  dataQuality: { withoutNextActivity: number; stale: number; overdueExpectedClose: number; withoutValue: number; withoutOwner: number };
  comparison: { previousRevenueCents: number; previousWonCount: number; available: boolean };
};

export async function getPerformance(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; userId?: string; teamId?: string; periodType?: GoalPeriod; periodStart?: string; now?: Date }): Promise<PerformanceReport> {
  const now = input.now ?? new Date();
  const subject = await resolveReportSubject(deps, actor, { userId: input.userId, teamId: input.teamId });
  const periodType = input.periodType ?? "monthly";
  const timeZone = await companyTimeZone(deps, input.workspaceId);
  const start = normalizePeriodStart(periodType, input.periodStart ?? localDateIso(now, timeZone));
  const range = periodRange(periodType, start, timeZone);
  const previous = periodRange(periodType, previousPeriodStart(periodType, start), timeZone);
  const settings = await loadCommercialSettings(deps, actor.tenantId, input.workspaceId);
  const visibility = resolveVisibility(actor, settings);

  const [closed, previousWon, open, withTasks] = await Promise.all([
    deps.analyticsRepository.listDeals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, statuses: ["won", "lost"], closedFrom: range.from, closedTo: range.to }),
    deps.analyticsRepository.listDeals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, statuses: ["won"], closedFrom: previous.from, closedTo: previous.to }),
    deps.analyticsRepository.listDeals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, statuses: ["open"] }),
    deps.analyticsRepository.listDealIdsWithPendingTasks({ tenantId: actor.tenantId, workspaceId: input.workspaceId }),
  ]);
  const won = closed.filter((deal) => deal.status === "won" && matchesSubject(deal, subject, true));
  const lost = closed.filter((deal) => deal.status === "lost" && matchesSubject(deal, subject, true));
  const mine = open.filter((deal) => matchesSubject(deal, subject, false));
  const stages = await stageMap(deps, mine);
  const revenue = won.reduce((sum, deal) => sum + (deal.finalValueCents ?? deal.valueCents), 0);
  const withMargin = won.filter((deal) => deal.finalGrossProfitCents !== undefined);
  const marginRevenue = withMargin.reduce((sum, deal) => sum + (deal.finalValueCents ?? 0), 0);
  const profit = withMargin.reduce((sum, deal) => sum + (deal.finalGrossProfitCents ?? 0), 0);
  const mrr = won.reduce((sum, deal) => sum + (deal.finalMrrCents ?? 0), 0);
  const cycles = [...won, ...lost].filter((deal) => deal.closedAt).map((deal) => (new Date(deal.closedAt as string).getTime() - new Date(deal.createdAt).getTime()) / DAY_MS);

  // Consolidado de várias equipes: as metas de cada equipe (somadas na tela, nunca duplicadas aqui).
  const goalScopes = subject.userId ? { scopeType: "user" as const, scopeId: subject.userId } : subject.teamId ? { scopeType: "team" as const, scopeId: subject.teamId } : subject.teamIds ? { scopeType: "team" as const } : { scopeType: "company" as const };
  const goals = (await deps.goalRepository.list({ tenantId: actor.tenantId, workspaceId: input.workspaceId, scopeType: goalScopes.scopeType, scopeId: "scopeId" in goalScopes ? goalScopes.scopeId : undefined }))
    .filter((goal) => !subject.teamIds || subject.userId || (goal.scopeId !== undefined && subject.teamIds.includes(goal.scopeId)))
    .filter((goal) => goal.periodType === periodType && goal.periodStart === start && (visibility.canViewMargin || goal.metric !== "gross_margin"));

  return {
    subject,
    period: { type: periodType, start, ...range },
    goals: await attachProgress(deps, actor.tenantId, input.workspaceId, goals, now),
    won: {
      count: won.length,
      revenueCents: revenue,
      averageTicketCents: won.length ? Math.round(revenue / won.length) : undefined,
      grossProfitCents: visibility.canViewMargin && withMargin.length ? profit : undefined,
      averageMarginBp: visibility.canViewMargin ? bp(profit, marginRevenue) : undefined,
      mrrCents: mrr,
      arrCents: mrr * 12,
    },
    lost: { count: lost.length, valueCents: lost.reduce((sum, deal) => sum + deal.valueCents, 0) },
    conversionBp: bp(won.length, won.length + lost.length),
    averageCycleDays: cycles.length ? Math.round((cycles.reduce((a, b) => a + b, 0) / cycles.length) * 10) / 10 : undefined,
    pipeline: {
      openCount: mine.length,
      openValueCents: mine.reduce((sum, deal) => sum + deal.valueCents, 0),
      weightedValueCents: mine.reduce((sum, deal) => sum + Math.round((deal.valueCents * resolveDealProbability(deal, stages.get(deal.pipelineId) ?? []).value) / 100), 0),
    },
    forecast: forecastFor(mine, stages, range, revenue, timeZone),
    dataQuality: {
      withoutNextActivity: mine.filter((deal) => !withTasks.has(deal.id)).length,
      stale: mine.filter((deal) => {
        const stage = stages.get(deal.pipelineId)?.find((item) => item.id === deal.stageId);
        return stage?.staleAfterDays !== undefined && (now.getTime() - new Date(deal.lastStageChangedAt).getTime()) / DAY_MS >= stage.staleAfterDays;
      }).length,
      overdueExpectedClose: mine.filter((deal) => deal.expectedCloseDate && deal.expectedCloseDate < localDateIso(now, timeZone)).length,
      withoutValue: mine.filter((deal) => !(deal.valueCents > 0)).length,
      withoutOwner: mine.filter((deal) => !deal.ownerUserId).length,
    },
    comparison: {
      previousRevenueCents: previousWon.filter((deal) => matchesSubject(deal, subject, true)).reduce((sum, deal) => sum + (deal.finalValueCents ?? deal.valueCents), 0),
      previousWonCount: previousWon.filter((deal) => matchesSubject(deal, subject, true)).length,
      available: previousWon.length > 0,
    },
  };
}

/** "Se você fechar esta venda" — cálculo determinístico sobre a meta mensal de receita do responsável. */
export async function getDealGoalImpact(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; now?: Date }) {
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  const ownerUserId = deal.ownerUserId ?? actor.userId;
  if (ownerUserId !== actor.userId && !hasPermission(actor, "sales_report:read_team")) return { available: false as const };
  const now = input.now ?? new Date();
  const start = normalizePeriodStart("monthly", localDateIso(now, await companyTimeZone(deps, input.workspaceId)));
  const [goal] = await deps.goalRepository.list({ tenantId: actor.tenantId, workspaceId: input.workspaceId, scopeType: "user", scopeId: ownerUserId, metric: "sales_revenue" })
    .then((goals) => goals.filter((item) => item.periodType === "monthly" && item.periodStart === start));
  if (!goal) return { available: false as const, ownerUserId };
  const [withProgress] = await attachProgress(deps, actor.tenantId, input.workspaceId, [goal], now);
  const value = deal.status === "won" ? 0 : deal.valueCents;
  const after = withProgress.progress.realizedValue + value;
  return {
    available: true as const,
    ownerUserId,
    targetCents: goal.targetValue,
    realizedCents: withProgress.progress.realizedValue,
    attainmentBp: withProgress.progress.attainmentBp,
    remainingCents: withProgress.progress.remainingValue,
    dealValueCents: value,
    dealShareOfGoalBp: bp(value, goal.targetValue) ?? 0,
    afterCloseCents: after,
    afterCloseAttainmentBp: bp(after, goal.targetValue) ?? 0,
    afterCloseRemainingCents: Math.max(0, goal.targetValue - after),
  };
}

// ---------------------------------------------------------------------------------------------
// Equipe, forecast mensal e relatórios
// ---------------------------------------------------------------------------------------------

export async function getTeamPerformance(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; teamId?: string; periodType?: GoalPeriod; periodStart?: string; now?: Date }) {
  if (!hasPermission(actor, "sales_report:read_team") && !hasPermission(actor, "sales_report:read_all")) throw new Error("SALES_REPORT_FORBIDDEN: visão de equipe é da gestão.");
  const now = input.now ?? new Date();
  const periodType = input.periodType ?? "monthly";
  const timeZone = await companyTimeZone(deps, input.workspaceId);
  const start = normalizePeriodStart(periodType, input.periodStart ?? localDateIso(now, timeZone));
  // Comparativo só entre pessoas do escopo: empresa toda (global) ou membros das equipes do recorte.
  const subject = await resolveReportSubject(deps, actor, { teamId: input.teamId });
  const subjectTeams = subject.teamIds ?? (subject.teamId ? [subject.teamId] : undefined);
  const members = subjectTeams
    ? [...new Map((await Promise.all(subjectTeams.map((teamId) => deps.teamMembershipRepository.listByTeam(teamId)))).flat().map((member) => [member.userId, member] as const)).values()]
    : hasPermission(actor, "sales_report:read_all") ? await deps.membershipRepository.listByTenant(actor.tenantId) : [{ userId: actor.userId, role: actor.role }];
  const company = await getPerformance(deps, actor, { workspaceId: input.workspaceId, teamId: input.teamId, periodType, periodStart: start, now });
  const rows = [];
  for (const member of members) {
    const report = await getPerformance(deps, actor, { workspaceId: input.workspaceId, userId: member.userId, periodType, periodStart: start, now });
    if (input.teamId) {
      // Escopo de equipe: só quem tem atividade creditada na equipe aparece.
      const teamReport = await getPerformance(deps, actor, { workspaceId: input.workspaceId, userId: member.userId, teamId: input.teamId, periodType, periodStart: start, now });
      if (teamReport.won.count + teamReport.pipeline.openCount + teamReport.lost.count === 0 && report.goals.length === 0) continue;
    }
    const revenueGoal = report.goals.find((goal) => goal.metric === "sales_revenue");
    rows.push({
      userId: member.userId,
      role: member.role,
      goalCents: revenueGoal?.targetValue,
      soldCents: report.won.revenueCents,
      attainmentBp: revenueGoal?.progress.attainmentBp,
      averageMarginBp: report.won.averageMarginBp,
      wonCount: report.won.count,
      pipelineCents: report.pipeline.openValueCents,
      weightedCents: report.pipeline.weightedValueCents,
      conversionBp: report.conversionBp,
      averageTicketCents: report.won.averageTicketCents,
      averageCycleDays: report.averageCycleDays,
    });
  }
  const settings = await loadCommercialSettings(deps, actor.tenantId, input.workspaceId);
  return { team: company, sellers: rows.sort((a, b) => b.soldCents - a.soldCents), rankingEnabled: settings.rankingEnabled };
}

/** Forecast por mês (trimestre/ano): ganho, commit, best case, pipeline, ponderado, meta e gap. */
export async function getForecast(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; userId?: string; teamId?: string; periodType?: "quarterly" | "annual" | "monthly"; periodStart?: string; now?: Date }) {
  const now = input.now ?? new Date();
  const periodType = input.periodType ?? "quarterly";
  const timeZone = await companyTimeZone(deps, input.workspaceId);
  const start = normalizePeriodStart(periodType, input.periodStart ?? localDateIso(now, timeZone));
  const months = periodType === "annual" ? 12 : periodType === "quarterly" ? 3 : 1;
  const [year, month] = start.split("-").map(Number);
  const rows: (ForecastBuckets & { month: string; goalCents?: number; gapCents?: number })[] = [];
  for (let index = 0; index < months; index++) {
    const monthStart = new Date(Date.UTC(year, month - 1 + index, 1)).toISOString().slice(0, 10);
    const report = await getPerformance(deps, actor, { workspaceId: input.workspaceId, userId: input.userId, teamId: input.teamId, periodType: "monthly", periodStart: monthStart, now });
    const goal = report.goals.find((item) => item.metric === "sales_revenue");
    rows.push({ month: monthStart, ...report.forecast, goalCents: goal?.targetValue, gapCents: goal ? Math.max(0, goal.targetValue - report.forecast.wonCents) : undefined });
  }
  const sum = (key: "wonCents" | "commitCents" | "bestCaseCents" | "pipelineCents" | "weightedCents") => rows.reduce((total, row) => total + row[key], 0);
  const goalTotal = rows.every((row) => row.goalCents !== undefined) ? rows.reduce((total, row) => total + (row.goalCents ?? 0), 0) : undefined;
  return { periodType, start, months: rows, totals: { wonCents: sum("wonCents"), commitCents: sum("commitCents"), bestCaseCents: sum("bestCaseCents"), pipelineCents: sum("pipelineCents"), weightedCents: sum("weightedCents"), goalCents: goalTotal, gapCents: goalTotal !== undefined ? Math.max(0, goalTotal - sum("wonCents")) : undefined } };
}

export async function getSalesReports(deps: SalesPerformanceDeps, actor: SalesActor, input: { workspaceId: string; from: string; to: string; userId?: string; teamId?: string; pipelineId?: string; origin?: string }) {
  const subject = await resolveReportSubject(deps, actor, { userId: input.userId, teamId: input.teamId });
  const settings = await loadCommercialSettings(deps, actor.tenantId, input.workspaceId);
  const visibility = resolveVisibility(actor, settings);
  const filterDeal = (deal: Deal, credited: boolean) => matchesSubject(deal, subject, credited) && (!input.pipelineId || deal.pipelineId === input.pipelineId) && (!input.origin || deal.origin === input.origin);
  const [closedAll, createdAll, proposals, approvals, events] = await Promise.all([
    deps.analyticsRepository.listDeals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, statuses: ["won", "lost"], closedFrom: input.from, closedTo: input.to }),
    deps.analyticsRepository.listDeals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, createdFrom: input.from, createdTo: input.to }),
    deps.analyticsRepository.listProposals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, createdFrom: input.from, createdTo: input.to }),
    deps.analyticsRepository.listApprovals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, from: input.from, to: input.to }),
    deps.analyticsRepository.listDealStageEvents({ tenantId: actor.tenantId, workspaceId: input.workspaceId, from: input.from, to: input.to }),
  ]);
  const closed = closedAll.filter((deal) => filterDeal(deal, true));
  const won = closed.filter((deal) => deal.status === "won");
  const lost = closed.filter((deal) => deal.status === "lost");
  const items = await deps.dealItemRepository.listByDeals(closed.map((deal) => deal.id));

  // Produtos: vendidos (itens de ganhos) + conversão (oportunidades fechadas que continham o produto).
  const products = new Map<string, { productId?: string; name: string; quantity: number; revenueCents: number; costCents?: number; wonDeals: Set<string>; lostDeals: Set<string> }>();
  const statusOf = new Map(closed.map((deal) => [deal.id, deal.status]));
  for (const item of items) {
    const key = item.productId ?? `avulso:${item.productNameSnapshot}`;
    const row = products.get(key) ?? { productId: item.productId, name: item.productNameSnapshot, quantity: 0, revenueCents: 0, costCents: 0, wonDeals: new Set<string>(), lostDeals: new Set<string>() };
    if (statusOf.get(item.dealId) === "won") {
      row.quantity += item.quantity;
      row.revenueCents += item.subtotalProposedCents;
      row.costCents = row.costCents === undefined || item.subtotalCostCents === undefined ? undefined : row.costCents + item.subtotalCostCents;
      row.wonDeals.add(item.dealId);
    } else row.lostDeals.add(item.dealId);
    products.set(key, row);
  }

  const group = <K extends string>(deals: readonly Deal[], key: (deal: Deal) => K | undefined) => {
    const map = new Map<string, { won: number; lost: number; wonValueCents: number }>();
    for (const deal of deals) {
      const id = key(deal) ?? "—";
      const row = map.get(id) ?? { won: 0, lost: 0, wonValueCents: 0 };
      if (deal.status === "won") { row.won++; row.wonValueCents += deal.finalValueCents ?? deal.valueCents; } else row.lost++;
      map.set(id, row);
    }
    return [...map.entries()].map(([id, row]) => ({ id, ...row, conversionBp: bp(row.won, row.won + row.lost) })).sort((a, b) => b.wonValueCents - a.wonValueCents);
  };

  // Funil: entradas por etapa e tempo médio na etapa (eventos de mudança de etapa no período).
  const entries = new Map<string, number>();
  const durations = new Map<string, number[]>();
  const byDeal = new Map<string, { stageId: string; at: string }[]>();
  for (const event of events) {
    const stageId = String((event.eventType === "deal_created" ? event.payload.stageId : event.payload.toStageId) ?? "");
    if (!stageId) continue;
    entries.set(stageId, (entries.get(stageId) ?? 0) + 1);
    byDeal.set(event.entityId, [...(byDeal.get(event.entityId) ?? []), { stageId, at: event.occurredAt }]);
  }
  for (const steps of byDeal.values()) {
    for (let index = 0; index < steps.length - 1; index++) {
      const days = (new Date(steps[index + 1].at).getTime() - new Date(steps[index].at).getTime()) / DAY_MS;
      durations.set(steps[index].stageId, [...(durations.get(steps[index].stageId) ?? []), days]);
    }
  }
  const pipelineIds = new Set([...createdAll, ...closed].map((deal) => deal.pipelineId).filter((id) => !input.pipelineId || id === input.pipelineId));
  const funnel = [];
  for (const pipelineId of pipelineIds) {
    const stages = (await deps.pipelineStageRepository.listByPipeline(pipelineId)).sort((a, b) => a.position - b.position);
    funnel.push({
      pipelineId,
      stages: stages.map((stage, index) => {
        const entered = entries.get(stage.id) ?? 0;
        const next = stages.slice(index + 1).reduce((total, later) => total + (entries.get(later.id) ?? 0), 0);
        const times = durations.get(stage.id) ?? [];
        return { stageId: stage.id, name: stage.name, isWon: stage.isWon, isLost: stage.isLost, entered, advanceRateBp: stage.isWon || stage.isLost ? undefined : bp(Math.min(entered, next), entered), averageDays: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : undefined };
      }),
    });
  }

  const scopedProposals = proposals.filter((proposal) => !subject.userId || proposal.createdByUserId === subject.userId || proposal.sentByUserId === subject.userId);
  const sent = scopedProposals.filter((proposal) => proposal.sentAt);
  const viewed = sent.filter((proposal) => proposal.viewedAt);
  const accepted = sent.filter((proposal) => proposal.status === "accepted");
  const hoursBetween = (a?: string, b?: string) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000 : undefined);
  const avg = (values: (number | undefined)[]) => {
    const clean = values.filter((value): value is number => value !== undefined);
    return clean.length ? Math.round((clean.reduce((x, y) => x + y, 0) / clean.length) * 10) / 10 : undefined;
  };

  const discountWon = won.map((deal) => {
    const totals = (deal.finalSnapshot as { totals?: { listTotalCents?: number; discountCents?: number; discountBp?: number } } | undefined)?.totals;
    return { listTotal: totals?.listTotalCents, discount: totals?.discountCents, discountBp: totals?.discountBp };
  }).filter((row) => row.listTotal !== undefined);

  return {
    period: { from: input.from, to: input.to },
    subject,
    conversion: {
      won: won.length, lost: lost.length, conversionBp: bp(won.length, won.length + lost.length),
      bySeller: group(closed, (deal) => deal.creditedOwnerUserId ?? deal.ownerUserId),
      byTeam: group(closed, (deal) => deal.creditedTeamId ?? deal.teamId),
      byPipeline: group(closed, (deal) => deal.pipelineId),
      byOrigin: group(closed, (deal) => deal.origin),
    },
    products: [...products.values()].map((row) => ({
      productId: row.productId, name: row.name, quantity: row.quantity, revenueCents: row.revenueCents, wonDeals: row.wonDeals.size, lostDeals: row.lostDeals.size,
      averageTicketCents: row.wonDeals.size ? Math.round(row.revenueCents / row.wonDeals.size) : undefined,
      grossMarginBp: visibility.canViewMargin && row.costCents !== undefined ? bp(row.revenueCents - row.costCents, row.revenueCents) : undefined,
      conversionBp: bp(row.wonDeals.size, row.wonDeals.size + row.lostDeals.size),
    })).sort((a, b) => b.revenueCents - a.revenueCents),
    losses: {
      count: lost.length,
      valueCents: lost.reduce((sum, deal) => sum + deal.valueCents, 0),
      byReason: group(lost, (deal) => deal.lossReason).map((row) => ({ reason: row.id, count: row.lost })),
      byCompetitor: group(lost, (deal) => deal.competitorId).map((row) => ({ competitorId: row.id, count: row.lost })),
      bySeller: group(lost, (deal) => deal.creditedOwnerUserId ?? deal.ownerUserId).map((row) => ({ userId: row.id, count: row.lost })),
    },
    funnel,
    cycle: {
      averageDaysWon: avg(won.map((deal) => (deal.closedAt ? (new Date(deal.closedAt).getTime() - new Date(deal.createdAt).getTime()) / DAY_MS : undefined))),
      averageDaysLost: avg(lost.map((deal) => (deal.closedAt ? (new Date(deal.closedAt).getTime() - new Date(deal.createdAt).getTime()) / DAY_MS : undefined))),
    },
    proposals: {
      created: scopedProposals.length, sent: sent.length, viewed: viewed.length, accepted: accepted.length,
      declined: sent.filter((proposal) => proposal.status === "rejected").length, expired: scopedProposals.filter((proposal) => proposal.status === "expired").length,
      sentToViewedBp: bp(viewed.length, sent.length), viewedToAcceptedBp: bp(accepted.length, viewed.length), sentToAcceptedBp: bp(accepted.length, sent.length),
      averageHoursSentToViewed: avg(viewed.map((proposal) => hoursBetween(proposal.sentAt, proposal.viewedAt))),
      averageHoursViewedToAccepted: avg(accepted.map((proposal) => hoursBetween(proposal.viewedAt, proposal.respondedAt))),
    },
    margin: visibility.canViewMargin ? {
      revenueCents: won.reduce((sum, deal) => sum + (deal.finalValueCents ?? 0), 0),
      costCents: won.reduce((sum, deal) => sum + (deal.finalCostCents ?? 0), 0),
      grossProfitCents: won.reduce((sum, deal) => sum + (deal.finalGrossProfitCents ?? 0), 0),
      grossMarginBp: bp(won.reduce((sum, deal) => sum + (deal.finalGrossProfitCents ?? 0), 0), won.filter((deal) => deal.finalGrossProfitCents !== undefined).reduce((sum, deal) => sum + (deal.finalValueCents ?? 0), 0)),
      bySeller: [...new Set(won.map((deal) => deal.creditedOwnerUserId ?? "—"))].map((userId) => {
        const mine = won.filter((deal) => (deal.creditedOwnerUserId ?? "—") === userId && deal.finalGrossProfitCents !== undefined);
        return { userId, revenueCents: mine.reduce((sum, deal) => sum + (deal.finalValueCents ?? 0), 0), grossProfitCents: mine.reduce((sum, deal) => sum + (deal.finalGrossProfitCents ?? 0), 0), grossMarginBp: bp(mine.reduce((sum, deal) => sum + (deal.finalGrossProfitCents ?? 0), 0), mine.reduce((sum, deal) => sum + (deal.finalValueCents ?? 0), 0)) };
      }),
    } : undefined,
    discounts: {
      wonWithDiscount: discountWon.filter((row) => (row.discount ?? 0) > 0).length,
      totalDiscountCents: discountWon.reduce((sum, row) => sum + (row.discount ?? 0), 0),
      averageDiscountBp: discountWon.length ? Math.round(discountWon.reduce((sum, row) => sum + (row.discountBp ?? 0), 0) / discountWon.length) : undefined,
      approvalsRequested: approvals.length,
      approvalsApproved: approvals.filter((request) => request.status === "approved").length,
      approvalsRejected: approvals.filter((request) => request.status === "rejected").length,
    },
    visibility,
  };
}

export { isSalesManager };
