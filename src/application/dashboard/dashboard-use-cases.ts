import type { AuthPrincipal } from "../../domain/identity/identity.model.js";
import type { Deal } from "../../domain/crm/crm.model.js";
import {
  computeAgentRows,
  computeAttendanceMetrics,
  rateBp,
  resolveDashboardPeriod,
  type AttendanceFact,
  type DashboardPeriod,
  type SlaTargets,
} from "../../domain/dashboard/dashboard-metrics.js";
import { readableTeamIds, resolveAccessContext, scopeFor, teamScopeUserIds, type AccessContext, type ScopeDomain, type ScopeLevel } from "../identity/access-control-use-cases.js";
import type { DashboardRepositoryPort, SlaPolicy } from "../ports/dashboard-repository.port.js";
import type { TeamMembershipRepositoryPort, TeamRepositoryPort } from "../ports/team-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import { getPerformance, matchesSubject, MY_TEAMS, resolveReportSubject, type ReportSubject, type SalesPerformanceDeps } from "../sales/sales-performance-use-cases.js";

/**
 * Dashboard principal (Atendimento, SLA, CSAT, Comercial e Metas) — sempre dentro do escopo
 * Perfil + Permissões + Equipes (0173). O backend recorta os dados; a tela só escolhe entre os
 * recortes que o próprio backend ofereceu (`options`). Cada bloco confere o próprio domínio de
 * permissão: atendimento (`inbox:*`), comercial (`sales_report:*`), metas (`goal:*`).
 *
 * Escopo principal é a EQUIPE (Canal → Equipe → Pessoas/Gerentes): o canal só direciona para uma
 * equipe; a Dashboard nunca depende de um "gerente do canal".
 */
export type DashboardDeps = {
  dashboardRepository: DashboardRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  teamRepository?: TeamRepositoryPort;
  teamMembershipRepository?: TeamMembershipRepositoryPort;
  sales?: SalesPerformanceDeps;
};

/** "me" | "company" | "my_teams" | "team:<id>" | "user:<id>". */
export type DashboardViewing = string;

type Subject =
  | { kind: "me"; userIds: string[] }
  | { kind: "user"; userIds: string[] }
  | { kind: "team"; teamIds: string[]; userIds: string[] }
  | { kind: "company" };

const LEVEL_ORDER: Record<ScopeLevel, number> = { own: 0, team: 1, all: 2 };
const allows = (context: AccessContext, domain: ScopeDomain, level: ScopeLevel) => LEVEL_ORDER[scopeFor(context, domain)] >= LEVEL_ORDER[level];
const DOMAINS: ScopeDomain[] = ["inbox", "report", "goal"];

async function membersOf(deps: DashboardDeps, teamIds: readonly string[]): Promise<string[]> {
  const users = new Set<string>();
  for (const teamId of teamIds) for (const member of (await deps.teamMembershipRepository?.listByTeam(teamId)) ?? []) users.add(member.userId);
  return [...users];
}

async function resolveSubject(deps: DashboardDeps, context: AccessContext, viewing: DashboardViewing, workspaceId: string): Promise<{ subject: Subject; level: ScopeLevel }> {
  if (viewing === "me") return { subject: { kind: "me", userIds: [context.userId] }, level: "own" };
  if (viewing === "company") return { subject: { kind: "company" }, level: "all" };
  if (viewing === MY_TEAMS || viewing === "my_teams") {
    if (!readableTeamIds(context).length) throw new Error("DASHBOARD_SCOPE_FORBIDDEN: você não participa de nenhuma equipe.");
    return { subject: { kind: "team", teamIds: readableTeamIds(context), userIds: await membersOf(deps, readableTeamIds(context)) }, level: "team" };
  }
  const [kind, id] = viewing.split(":");
  if (kind === "team" && id) {
    const team = await deps.teamRepository?.getById(id);
    if (!team || team.tenantId !== context.tenantId || team.workspaceId !== workspaceId) throw new Error("DASHBOARD_SCOPE_FORBIDDEN: equipe fora do workspace.");
    return { subject: { kind: "team", teamIds: [id], userIds: await membersOf(deps, [id]) }, level: readableTeamIds(context).includes(id) ? "team" : "all" };
  }
  if (kind === "user" && id) {
    const member = await deps.membershipRepository.getByUserAndTenant(id, context.tenantId);
    if (!member) throw new Error("DASHBOARD_SCOPE_FORBIDDEN: pessoa fora da empresa.");
    if (id === context.userId) return { subject: { kind: "me", userIds: [id] }, level: "own" };
    const colleagues = await teamScopeUserIds(deps, context);
    return { subject: { kind: "user", userIds: [id] }, level: colleagues.includes(id) ? "team" : "all" };
  }
  throw new Error("DASHBOARD_VIEWING_INVALID: recorte inválido.");
}

/** Recortes que esta pessoa pode escolher — a UI só oferece estes; o backend revalida mesmo assim. */
async function viewingOptions(deps: DashboardDeps, context: AccessContext, workspaceId: string) {
  const team = DOMAINS.some((domain) => allows(context, domain, "team"));
  const all = DOMAINS.some((domain) => allows(context, domain, "all"));
  const teams = deps.teamRepository ? await deps.teamRepository.listByWorkspace({ tenantId: context.tenantId, workspaceId }) : [];
  const visibleTeams = teams.filter((item) => all || (team && readableTeamIds(context).includes(item.id)));
  const users = all
    ? (await deps.membershipRepository.listByTenant(context.tenantId)).filter((member) => member.status !== "disabled").map((member) => member.userId)
    : team ? await teamScopeUserIds(deps, context) : [context.userId];
  return {
    viewings: [
      { value: "me", label: "Eu" },
      ...visibleTeams.map((item) => ({ value: `team:${item.id}`, label: item.name })),
      ...(team && readableTeamIds(context).length > 1 ? [{ value: "my_teams", label: "Minhas equipes" }] : []),
      ...(all ? [{ value: "company", label: "Empresa inteira" }] : []),
    ],
    userIds: users,
    teams: visibleTeams.map((item) => ({ id: item.id, name: item.name })),
  };
}

/** Prazo efetivo: canal > equipe > empresa, campo a campo (sem meta = sem SLA para aquele prazo). */
export function resolveSlaTargets(policies: readonly SlaPolicy[], fact: { connectionId: string; teamId?: string }): SlaTargets {
  const pick = (scopeType: SlaPolicy["scopeType"], scopeId?: string) => policies.find((policy) => policy.scopeType === scopeType && (policy.scopeId ?? undefined) === scopeId);
  const layers = [pick("workspace"), fact.teamId ? pick("team", fact.teamId) : undefined, pick("connection", fact.connectionId)].filter(Boolean) as SlaPolicy[];
  const targets: SlaTargets = {};
  for (const layer of layers) {
    if (layer.firstResponseSeconds) targets.firstResponseSeconds = layer.firstResponseSeconds;
    if (layer.resolutionSeconds) targets.resolutionSeconds = layer.resolutionSeconds;
  }
  return targets;
}

export type DashboardInput = {
  workspaceId: string;
  viewing?: DashboardViewing;
  period?: DashboardPeriod;
  from?: string;
  to?: string;
  connectionId?: string;
  now?: Date;
};

export async function getDashboard(deps: DashboardDeps, principal: AuthPrincipal, input: DashboardInput) {
  const workspace = await deps.workspaceRepository.getById(input.workspaceId);
  if (!workspace || workspace.tenantId !== principal.tenantId) throw new Error("DASHBOARD_WORKSPACE_NOT_FOUND: workspace não existe.");
  const context = await resolveAccessContext(deps, principal);
  const viewing = input.viewing ?? "me";
  const { subject, level } = await resolveSubject(deps, context, viewing, input.workspaceId);
  if (!DOMAINS.some((domain) => allows(context, domain, level))) throw new Error("DASHBOARD_SCOPE_FORBIDDEN: este recorte está fora do seu escopo.");
  const timeZone = workspace.settings?.timezone || "America/Sao_Paulo";
  const now = input.now ?? new Date();
  const period = resolveDashboardPeriod({ period: input.period ?? "this_month", from: input.from, to: input.to, timeZone, now });
  const options = await viewingOptions(deps, context, input.workspaceId);

  const [attendance, commercial] = await Promise.all([
    allows(context, "inbox", level) ? attendanceBlock(deps, { context, subject, workspaceId: input.workspaceId, connectionId: input.connectionId, from: period.from, to: period.to, now: now.toISOString() }) : Promise.resolve(undefined),
    deps.sales && allows(context, "report", level) ? commercialBlock(deps.sales, principal, { subject, viewing, workspaceId: input.workspaceId, from: period.from, to: period.to }) : Promise.resolve(undefined),
  ]);
  const goals = deps.sales && allows(context, "goal", level) && allows(context, "report", level)
    ? await goalsBlock(deps.sales, principal, { subject, viewing, workspaceId: input.workspaceId, monthStart: period.monthStart, now })
    : undefined;

  return {
    viewing,
    subject: { kind: subject.kind, ...("teamIds" in subject ? { teamIds: subject.teamIds } : {}), ...("userIds" in subject ? { userIds: subject.userIds } : {}) },
    period: { ...period, timeZone },
    options,
    attendance: attendance ?? { available: false as const },
    commercial: commercial ?? { available: false as const },
    goals: goals ?? { available: false as const },
  };
}

async function attendanceBlock(deps: DashboardDeps, input: { context: AccessContext; subject: Subject; workspaceId: string; connectionId?: string; from: string; to: string; now: string }) {
  const [facts, phaseRows, policies] = await Promise.all([
    deps.dashboardRepository.listAttendanceFacts({ tenantId: input.context.tenantId, workspaceId: input.workspaceId, from: input.from, to: input.to, connectionId: input.connectionId }),
    deps.dashboardRepository.listPhaseTimes({ tenantId: input.context.tenantId, workspaceId: input.workspaceId, from: input.from, to: input.to }),
    deps.dashboardRepository.listSlaPolicies(input.workspaceId),
  ]);
  const attendances: AttendanceFact[] = facts.attendances.map((fact) => ({ ...fact, sla: resolveSlaTargets(policies, fact) }));
  const subjectUsers = input.subject.kind === "company" ? undefined : new Set(input.subject.userIds);
  const subjectTeams = input.subject.kind === "team" ? new Set(input.subject.teamIds) : undefined;
  const participants = new Map<string, Set<string>>();
  for (const cycle of facts.assignments) participants.set(cycle.attendanceId, (participants.get(cycle.attendanceId) ?? new Set()).add(cycle.userId));

  // Recorte: pessoa = atendimentos em que participou ou que finalizou; equipe = da equipe ou com
  // participação de alguém dela; empresa = tudo. Cada atendimento conta UMA vez no volume.
  const restrictedTeams = input.subject.kind === "user" && scopeFor(input.context, "inbox") !== "all" ? new Set(readableTeamIds(input.context)) : undefined;
  const inScope = attendances.filter((attendance) => {
    if (restrictedTeams && attendance.teamId && !restrictedTeams.has(attendance.teamId)) return false;
    if (!subjectUsers) return true;
    if (subjectTeams && attendance.teamId) return subjectTeams.has(attendance.teamId);
    if (attendance.closedBy && subjectUsers.has(attendance.closedBy)) return true;
    return [...(participants.get(attendance.id) ?? [])].some((userId) => subjectUsers.has(userId));
  });
  const ids = new Set(inScope.map((attendance) => attendance.id));
  const allAssignments = facts.assignments.filter((cycle) => ids.has(cycle.attendanceId));
  // Métricas individuais (FRT, posse) só dos ciclos das pessoas do recorte: nunca atribui à pessoa
  // o tempo de outra.
  const assignments = subjectUsers ? allAssignments.filter((cycle) => subjectUsers.has(cycle.userId)) : allAssignments;
  const scopedConversations = new Set(inScope.map((attendance) => attendance.conversationId));
  const phaseTimes = phaseRows.filter((row) => (subjectTeams ? subjectTeams.has(row.teamId) : !subjectUsers || scopedConversations.has(row.conversationId)));

  const metrics = computeAttendanceMetrics({ attendances: inScope, assignments, allAssignments, currentUserIds: input.subject.kind === "me" || input.subject.kind === "user" ? input.subject.userIds : undefined, phaseTimes, from: input.from, to: input.to, now: input.now });
  const comparisonUsers = subjectUsers ? [...subjectUsers] : [...new Set(allAssignments.map((cycle) => cycle.userId))];
  const agents = input.subject.kind === "me" || input.subject.kind === "user" ? [] : computeAgentRows({ userIds: comparisonUsers, attendances: inScope, assignments: allAssignments, from: input.from, to: input.to });
  const teamIds = input.subject.kind === "company" ? [...new Set(inScope.map((attendance) => attendance.teamId).filter((teamId): teamId is string => Boolean(teamId)))] : input.subject.kind === "team" && input.subject.teamIds.length > 1 ? input.subject.teamIds : [];
  const teams = teamIds.map((teamId) => {
    const teamAttendances = inScope.filter((attendance) => attendance.teamId === teamId);
    const teamIdsSet = new Set(teamAttendances.map((attendance) => attendance.id));
    const teamCycles = allAssignments.filter((cycle) => teamIdsSet.has(cycle.attendanceId));
    const teamMetrics = computeAttendanceMetrics({ attendances: teamAttendances, assignments: teamCycles, allAssignments: teamCycles, phaseTimes: [], from: input.from, to: input.to, now: input.now });
    return { teamId, finalized: teamMetrics.volume.finalized, tmr: teamMetrics.tmr, frt: teamMetrics.frt, csat: teamMetrics.csat.average, backlog: teamMetrics.backlog.total };
  });
  return { available: true as const, ...metrics, agents, teams };
}

const dealValue = (deal: Deal) => deal.finalValueCents ?? deal.valueCents;

function reportRequest(subject: Subject, viewing: DashboardViewing): { userId?: string; teamId?: string } {
  if (subject.kind === "me" || subject.kind === "user") return { userId: subject.userIds[0] };
  if (subject.kind === "team") return { teamId: subject.teamIds.length === 1 && viewing.startsWith("team:") ? subject.teamIds[0] : MY_TEAMS };
  return {};
}

async function commercialBlock(sales: SalesPerformanceDeps, principal: AuthPrincipal, input: { subject: Subject; viewing: DashboardViewing; workspaceId: string; from: string; to: string }) {
  const actor = { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, permissions: principal.permissions, permissionRevokes: principal.permissionRevokes };
  const reportSubject: ReportSubject = await resolveReportSubject(sales, actor, reportRequest(input.subject, input.viewing));
  const [closedAll, openAll, proposalsAll] = await Promise.all([
    sales.analyticsRepository.listDeals({ tenantId: principal.tenantId, workspaceId: input.workspaceId, statuses: ["won", "lost"], closedFrom: input.from, closedTo: input.to }),
    sales.analyticsRepository.listDeals({ tenantId: principal.tenantId, workspaceId: input.workspaceId, statuses: ["open"] }),
    sales.analyticsRepository.listProposals({ tenantId: principal.tenantId, workspaceId: input.workspaceId, createdFrom: input.from, createdTo: input.to }),
  ]);
  // Ganha/perdida entram pelo FECHAMENTO no período e pelo responsável CREDITADO; em andamento é a
  // foto atual do responsável/equipe da oportunidade.
  const closed = closedAll.filter((deal) => matchesSubject(deal, reportSubject, true));
  const won = closed.filter((deal) => deal.status === "won");
  const lost = closed.filter((deal) => deal.status === "lost");
  const open = openAll.filter((deal) => matchesSubject(deal, reportSubject, false));
  const wonValue = won.reduce((sum, deal) => sum + dealValue(deal), 0);

  const stagesByPipeline = new Map<string, Awaited<ReturnType<typeof sales.pipelineStageRepository.listByPipeline>>>();
  for (const pipelineId of new Set(open.map((deal) => deal.pipelineId))) stagesByPipeline.set(pipelineId, await sales.pipelineStageRepository.listByPipeline(pipelineId));
  const byStage = new Map<string, { pipelineId: string; stageId: string; name: string; position: number; count: number; valueCents: number }>();
  for (const deal of open) {
    const stage = stagesByPipeline.get(deal.pipelineId)?.find((item) => item.id === deal.stageId);
    if (stage?.isWon || stage?.isLost) continue;
    const row = byStage.get(deal.stageId) ?? { pipelineId: deal.pipelineId, stageId: deal.stageId, name: stage?.name ?? "Etapa", position: stage?.position ?? 0, count: 0, valueCents: 0 };
    row.count += 1;
    row.valueCents += deal.valueCents;
    byStage.set(deal.stageId, row);
  }
  const lossReasons = new Map<string, number>();
  for (const deal of lost) lossReasons.set(deal.lossReason ?? "Sem motivo", (lossReasons.get(deal.lossReason ?? "Sem motivo") ?? 0) + 1);

  // Propostas criadas no período, de quem está no recorte. Aceite ≠ venda: a conversão em venda
  // conta só propostas aceitas cuja oportunidade foi efetivamente GANHA.
  const users = input.subject.kind === "company" ? undefined : new Set(input.subject.userIds);
  const proposals = proposalsAll.filter((proposal) => !users || (proposal.createdByUserId && users.has(proposal.createdByUserId)) || (proposal.sentByUserId && users.has(proposal.sentByUserId)));
  const sent = proposals.filter((proposal) => proposal.sentAt);
  const accepted = sent.filter((proposal) => proposal.status === "accepted");
  const wonIds = new Set(won.map((deal) => deal.id));
  let convertedToSale = 0;
  for (const proposal of accepted) {
    if (!proposal.dealId) continue;
    if (wonIds.has(proposal.dealId) || (await sales.dealRepository.getById(proposal.dealId))?.status === "won") convertedToSale += 1;
  }

  const sellers = new Map<string, { won: number; lost: number; wonValueCents: number }>();
  for (const deal of closed) {
    const userId = deal.creditedOwnerUserId ?? deal.ownerUserId ?? "—";
    const row = sellers.get(userId) ?? { won: 0, lost: 0, wonValueCents: 0 };
    if (deal.status === "won") { row.won += 1; row.wonValueCents += dealValue(deal); } else row.lost += 1;
    sellers.set(userId, row);
  }

  return {
    available: true as const,
    open: { count: open.length, valueCents: open.reduce((sum, deal) => sum + deal.valueCents, 0) },
    pipelineByStage: [...byStage.values()].sort((a, b) => a.pipelineId.localeCompare(b.pipelineId) || a.position - b.position),
    won: { count: won.length, valueCents: wonValue },
    lost: { count: lost.length, valueCents: lost.reduce((sum, deal) => sum + deal.valueCents, 0), reasons: [...lossReasons.entries()].map(([reason, count]) => ({ reason, count, shareBp: rateBp(count, lost.length) })).sort((a, b) => b.count - a.count) },
    /** Conversão = ganhas ÷ (ganhas + perdidas) fechadas no período; abertas nunca entram no denominador. */
    conversionBp: rateBp(won.length, won.length + lost.length),
    /** Ticket médio = valor ganho (valor FINAL de fechamento) ÷ quantidade de ganhas no período. */
    averageTicketCents: won.length ? Math.round(wonValue / won.length) : undefined,
    proposals: {
      created: proposals.length,
      sent: sent.length,
      accepted: accepted.length,
      declined: sent.filter((proposal) => proposal.status === "rejected").length,
      acceptanceRateBp: rateBp(accepted.length, sent.length),
      convertedToSale,
      saleConversionBp: rateBp(convertedToSale, sent.length),
    },
    sellers: input.subject.kind === "me" || input.subject.kind === "user" ? [] : [...sellers.entries()].map(([userId, row]) => ({ userId, ...row, conversionBp: rateBp(row.won, row.won + row.lost) })).sort((a, b) => b.wonValueCents - a.wonValueCents),
  };
}

async function goalsBlock(sales: SalesPerformanceDeps, principal: AuthPrincipal, input: { subject: Subject; viewing: DashboardViewing; workspaceId: string; monthStart: string; now: Date }) {
  const actor = { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, permissions: principal.permissions, permissionRevokes: principal.permissionRevokes };
  // Reaproveita a performance do Sales Engine (mesmas metas, mesma apuração de realizado) — a meta
  // da equipe soma o que foi CREDITADO à equipe; nunca soma metas individuais por cima (evita duplicar).
  const report = await getPerformance(sales, actor, { workspaceId: input.workspaceId, ...reportRequest(input.subject, input.viewing), periodType: "monthly", periodStart: input.monthStart, now: input.now });
  const revenueGoals = report.goals.filter((goal) => goal.metric === "sales_revenue");
  const target = revenueGoals.reduce((sum, goal) => sum + goal.targetValue, 0);
  const realized = revenueGoals.length ? revenueGoals.reduce((sum, goal) => sum + goal.progress.realizedValue, 0) : report.won.revenueCents;
  return {
    available: true as const,
    month: input.monthStart,
    hasGoal: revenueGoals.length > 0,
    targetCents: revenueGoals.length ? target : undefined,
    realizedCents: realized,
    pipelineCents: report.pipeline.openValueCents,
    attainmentBp: revenueGoals.length ? rateBp(realized, target) : undefined,
    remainingCents: revenueGoals.length ? Math.max(0, target - realized) : undefined,
  };
}
