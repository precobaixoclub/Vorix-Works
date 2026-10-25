import { localDate, localMidnightUtc } from "../shared/company-time.js";
export { localMidnightUtc } from "../shared/company-time.js";
/**
 * Dashboard principal — fórmulas CENTRALIZADAS (um lugar só, nunca repetidas em componentes).
 * Puro: recebe fatos estruturados (timestamps de atendimentos, ciclos de responsabilidade, fases)
 * e devolve indicadores. Nada aqui lê texto de conversa. Ver `docs/dashboard-indicadores.md`.
 *
 * Regras temporais (em que período cada métrica entra):
 * - Aberto: `openedAt` no período. Finalizado/TMR/CSAT/finalização/reabertura: `closedAt` no período.
 * - FRT individual: ciclos cujo `startedAt` está no período. Tempo de posse: ciclos com `endedAt` no período.
 * - Transferências: ciclos encerrados por transferência com `endedAt` no período.
 * - Backlog/SLA em risco: foto do AGORA (não depende do período).
 */

const isValidCsat = (score: unknown): score is number => typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 5;

export type Average = { value?: number; sample: number };

export function average(values: readonly (number | undefined)[]): Average {
  const clean = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return { value: clean.length ? Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : undefined, sample: clean.length };
}

/** Taxa em pontos-base (10000 = 100%); `undefined` quando não há denominador. */
export function rateBp(part: number, whole: number): number | undefined {
  return whole > 0 ? Math.round((part * 10_000) / whole) : undefined;
}

export const secondsBetweenIso = (fromIso: string, toIso: string): number => Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));

const inRange = (iso: string | undefined, from: string, to: string): iso is string => Boolean(iso && iso >= from && iso < to);

// ── Período no fuso da empresa ───────────────────────────────────────────────────────────────

export const DASHBOARD_PERIODS = ["today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month", "custom"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const shiftDays = (date: { year: number; month: number; day: number }, days: number) => {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};

/** Intervalo `[from, to)` em UTC para o período pedido, sempre calculado no fuso da empresa
 * ("hoje" em São Paulo não é "hoje" em UTC perto da meia-noite). `custom` usa datas locais
 * `YYYY-MM-DD` inclusivas. */
export function resolveDashboardPeriod(input: { period: DashboardPeriod; from?: string; to?: string; timeZone: string; now?: Date }): { period: DashboardPeriod; from: string; to: string; monthStart: string } {
  const now = input.now ?? new Date();
  const today = localDate(now, input.timeZone);
  const midnight = (date: { year: number; month: number; day: number }) => localMidnightUtc(date.year, date.month, date.day, input.timeZone);
  const tomorrow = shiftDays(today, 1);
  let from: { year: number; month: number; day: number };
  let to: { year: number; month: number; day: number };
  switch (input.period) {
    case "today": from = today; to = tomorrow; break;
    case "yesterday": from = shiftDays(today, -1); to = today; break;
    case "last_7_days": from = shiftDays(today, -6); to = tomorrow; break;
    case "last_30_days": from = shiftDays(today, -29); to = tomorrow; break;
    case "last_month": {
      const firstThis = { year: today.year, month: today.month, day: 1 };
      from = { ...shiftDays(firstThis, -1), day: 1 };
      to = firstThis;
      break;
    }
    case "custom": {
      const parse = (value: string | undefined) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
        if (!match) throw new Error("DASHBOARD_PERIOD_INVALID: informe as datas no formato AAAA-MM-DD.");
        const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
        const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
        if (check.getUTCFullYear() !== date.year || check.getUTCMonth() + 1 !== date.month || check.getUTCDate() !== date.day) throw new Error("DASHBOARD_PERIOD_INVALID: data inexistente.");
        return date;
      };
      from = parse(input.from);
      to = shiftDays(parse(input.to), 1);
      if (Date.UTC(to.year, to.month - 1, to.day) <= Date.UTC(from.year, from.month - 1, from.day)) throw new Error("DASHBOARD_PERIOD_INVALID: a data final precisa ser depois da inicial.");
      if (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day) > 400 * 86_400_000) throw new Error("DASHBOARD_PERIOD_INVALID: período máximo de 400 dias.");
      break;
    }
    default: from = { year: today.year, month: today.month, day: 1 }; to = tomorrow;
  }
  const lastDay = shiftDays(to, -1);
  return { period: input.period, from: midnight(from), to: midnight(to), monthStart: `${lastDay.year}-${String(lastDay.month).padStart(2, "0")}-01` };
}

// ── SLA ──────────────────────────────────────────────────────────────────────────────────────

/** Metas de prazo (segundos). SLA é prazo operacional — nunca confundir com CSAT. */
export type SlaTargets = { firstResponseSeconds?: number; resolutionSeconds?: number };
/** "Próximo de vencer" = já consumiu este tanto do prazo. */
export const SLA_NEAR_RATIO = 0.8;

export type SlaState = "met" | "breached" | "running" | "near";

/** Estado de um prazo: concluído dentro/fora, ou ainda correndo (perto de vencer ou não). */
export function slaState(elapsedSeconds: number, targetSeconds: number, done: boolean): SlaState {
  if (done) return elapsedSeconds <= targetSeconds ? "met" : "breached";
  if (elapsedSeconds > targetSeconds) return "breached";
  return elapsedSeconds >= targetSeconds * SLA_NEAR_RATIO ? "near" : "running";
}

// ── Fatos de atendimento ─────────────────────────────────────────────────────────────────────

export type AttendanceFact = {
  id: string;
  conversationId: string;
  connectionId: string;
  /** Equipe do atendimento (a de abertura, ou a atual da conversa). */
  teamId?: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt?: string;
  closedBy?: string;
  firstResponseAt?: string;
  closureTypeName?: string;
  closureSubtypeName?: string;
  csatStatus?: string;
  csatScore?: number;
  reopenedCount: number;
  resolutionKnown?: boolean;
  /** Só para abertos: quem falou por último e se a fase atual do kanban é de espera (PAUSED). */
  lastMessageDirection?: "inbound" | "outbound";
  waitingPhase?: boolean;
  sla: SlaTargets;
};

export type AssignmentFact = {
  timingKnown?: boolean;
  attendanceId: string;
  userId: string;
  startedAt: string;
  firstResponseAt?: string;
  endedAt?: string;
  endReason?: string;
};

export type PhaseTimeFact = { phaseName: string; seconds: number };

export type AttendanceMetrics = {
  volume: { opened: number; finalized: number; reopened: number; reopenRateBp?: number };
  /** FRT individual: por ciclo de responsabilidade — o relógio de cada pessoa começa quando ELA recebe. */
  frt: Average;
  /** FRT do atendimento (abertura → primeira resposta humana), mostrado como referência secundária. */
  frtAttendance: Average;
  /** TMR global: `closedAt − openedAt` dos finalizados no período. */
  tmr: Average;
  /** Tempo médio de posse por ciclo (quem segurou o atendimento e por quanto tempo). */
  holding: Average;
  transfers: { count: number; attendancesWithTransfer: number; rateBp?: number; averagePerAttendance?: number };
  sla: {
    configured: boolean;
    firstResponse: { met: number; breached: number; rateBp?: number };
    resolution: { met: number; breached: number; rateBp?: number };
    openNear: number;
    openBreached: number;
  };
  backlog: { total: number; queue: number; awaitingFirstResponse: number; awaitingAgent: number; awaitingCustomer: number; slaBreached: number };
  csat: { average: Average; sent: number; answered: number; responseRateBp?: number; waived: number; disabledByChannel: number; notApplicable: number; failed: number };
  closures: { typeName: string; subtypeName?: string; count: number; shareBp?: number }[];
  phases: { phaseName: string; average: Average }[];
};

/** Calcula o bloco de atendimento a partir dos fatos JÁ recortados pelo escopo. `assignments`
 * pode ser filtrado às pessoas do recorte (FRT/posse individuais); `allAssignments` (todas as do
 * atendimento) serve para contar transferências e saber quem é o responsável atual. */
export function computeAttendanceMetrics(input: {
  attendances: readonly AttendanceFact[];
  assignments: readonly AssignmentFact[];
  allAssignments: readonly AssignmentFact[];
  currentUserIds?: readonly string[];
  phaseTimes: readonly PhaseTimeFact[];
  from: string;
  to: string;
  now: string;
}): AttendanceMetrics {
  const { attendances, assignments, allAssignments, from, to, now } = input;
  const closed = attendances.filter((attendance) => inRange(attendance.closedAt, from, to));
  const open = attendances.filter((attendance) => attendance.status === "open" && (!input.currentUserIds || allAssignments.some(cycle => cycle.attendanceId === attendance.id && !cycle.endedAt && input.currentUserIds!.includes(cycle.userId))));
  const activeByAttendance = new Map(allAssignments.filter((assignment) => !assignment.endedAt).map((assignment) => [assignment.attendanceId, assignment] as const));
  const transfersByAttendance = new Map<string, number>();
  for (const assignment of allAssignments) if (assignment.endReason === "transferred") transfersByAttendance.set(assignment.attendanceId, (transfersByAttendance.get(assignment.attendanceId) ?? 0) + 1);

  // SLA de primeira resposta: SEMPRE por ciclo (quem recebeu depois de uma transferência nunca
  // herda o atraso de quem estava antes). Resolução: global do atendimento.
  const slaById = new Map(attendances.map((attendance) => [attendance.id, attendance.sla] as const));
  let frMet = 0; let frBreached = 0; let openNear = 0; let openBreached = 0;
  for (const cycle of assignments) {
    const target = cycle.timingKnown === false ? undefined : slaById.get(cycle.attendanceId)?.firstResponseSeconds;
    if (!target) continue;
    if (cycle.firstResponseAt) {
      if (!inRange(cycle.firstResponseAt, from, to)) continue;
      if (slaState(secondsBetweenIso(cycle.startedAt, cycle.firstResponseAt), target, true) === "met") frMet += 1; else frBreached += 1;
    } else if (!cycle.endedAt) {
      const state = slaState(secondsBetweenIso(cycle.startedAt, now), target, false);
      if (state === "breached") openBreached += 1; else if (state === "near") openNear += 1;
    } else if (inRange(cycle.endedAt, from, to) && secondsBetweenIso(cycle.startedAt, cycle.endedAt) > target) {
      frBreached += 1; // saiu da mão da pessoa sem nunca responder, já fora do prazo
    }
  }
  let resMet = 0; let resBreached = 0;
  for (const attendance of closed) {
    const target = attendance.resolutionKnown === false ? undefined : attendance.sla.resolutionSeconds;
    if (!target) continue;
    if (slaState(secondsBetweenIso(attendance.openedAt, attendance.closedAt!), target, true) === "met") resMet += 1; else resBreached += 1;
  }
  const openResolutionBreached = new Set<string>();
  for (const attendance of open) {
    const target = attendance.resolutionKnown === false ? undefined : attendance.sla.resolutionSeconds;
    if (!target) continue;
    const state = slaState(secondsBetweenIso(attendance.openedAt, now), target, false);
    if (state === "breached") { openBreached += 1; openResolutionBreached.add(attendance.id); } else if (state === "near") openNear += 1;
  }

  // Backlog: classificação exclusiva, reaproveitando estados existentes (responsável, 1ª resposta,
  // fase de espera do kanban e quem falou por último).
  const backlog = { total: open.length, queue: 0, awaitingFirstResponse: 0, awaitingAgent: 0, awaitingCustomer: 0, slaBreached: 0 };
  for (const attendance of open) {
    const active = activeByAttendance.get(attendance.id);
    if (!active) backlog.queue += 1;
    else if (!active.firstResponseAt) backlog.awaitingFirstResponse += 1;
    else if (attendance.waitingPhase || attendance.lastMessageDirection === "outbound") backlog.awaitingCustomer += 1;
    else backlog.awaitingAgent += 1;
    const frTarget = attendance.sla.firstResponseSeconds;
    const frLate = Boolean(active && active.timingKnown !== false && !active.firstResponseAt && frTarget && secondsBetweenIso(active.startedAt, now) > frTarget);
    if (frLate || openResolutionBreached.has(attendance.id)) backlog.slaBreached += 1;
  }

  const transferCount = allAssignments.filter((assignment) => assignment.endReason === "transferred" && inRange(assignment.endedAt, from, to)).length;
  const closedWithTransfer = closed.filter((attendance) => (transfersByAttendance.get(attendance.id) ?? 0) > 0).length;
  const transfersOfClosed = closed.reduce((sum, attendance) => sum + (transfersByAttendance.get(attendance.id) ?? 0), 0);

  const csatSent = closed.filter((attendance) => attendance.csatStatus === "sent");
  const answered = csatSent.filter((attendance) => isValidCsat(attendance.csatScore));

  const closureCounts = new Map<string, { typeName: string; subtypeName?: string; count: number }>();
  for (const attendance of closed) {
    if (!attendance.closureTypeName) continue;
    const key = `${attendance.closureTypeName}>${attendance.closureSubtypeName ?? ""}`;
    const row = closureCounts.get(key) ?? { typeName: attendance.closureTypeName, subtypeName: attendance.closureSubtypeName, count: 0 };
    row.count += 1;
    closureCounts.set(key, row);
  }
  const classified = [...closureCounts.values()].reduce((sum, row) => sum + row.count, 0);

  const phases = new Map<string, number[]>();
  for (const fact of input.phaseTimes) phases.set(fact.phaseName, [...(phases.get(fact.phaseName) ?? []), fact.seconds]);

  return {
    volume: {
      opened: attendances.filter((attendance) => attendance.resolutionKnown !== false && inRange(attendance.openedAt, from, to)).length,
      finalized: closed.length,
      reopened: closed.filter((attendance) => attendance.reopenedCount > 0).length,
      reopenRateBp: rateBp(closed.filter((attendance) => attendance.reopenedCount > 0).length, closed.length),
    },
    frt: average(assignments.filter((cycle) => cycle.timingKnown !== false && inRange(cycle.startedAt, from, to) && cycle.firstResponseAt).map((cycle) => secondsBetweenIso(cycle.startedAt, cycle.firstResponseAt!))),
    frtAttendance: average(attendances.filter((attendance) => attendance.resolutionKnown !== false && inRange(attendance.openedAt, from, to) && attendance.firstResponseAt).map((attendance) => secondsBetweenIso(attendance.openedAt, attendance.firstResponseAt!))),
    tmr: average(closed.filter(attendance => attendance.resolutionKnown !== false).map((attendance) => secondsBetweenIso(attendance.openedAt, attendance.closedAt!))),
    holding: average(assignments.filter((cycle) => cycle.timingKnown !== false && inRange(cycle.endedAt, from, to)).map((cycle) => secondsBetweenIso(cycle.startedAt, cycle.endedAt!))),
    transfers: {
      count: transferCount,
      attendancesWithTransfer: closedWithTransfer,
      rateBp: rateBp(closedWithTransfer, closed.length),
      averagePerAttendance: closed.length ? Math.round((transfersOfClosed / closed.length) * 100) / 100 : undefined,
    },
    sla: {
      configured: attendances.some((attendance) => attendance.sla.firstResponseSeconds || attendance.sla.resolutionSeconds),
      firstResponse: { met: frMet, breached: frBreached, rateBp: rateBp(frMet, frMet + frBreached) },
      resolution: { met: resMet, breached: resBreached, rateBp: rateBp(resMet, resMet + resBreached) },
      openNear,
      openBreached,
    },
    backlog,
    csat: {
      average: (() => { const avg = answered.map((attendance) => attendance.csatScore!); return { value: avg.length ? Math.round((avg.reduce((a, b) => a + b, 0) / avg.length) * 100) / 100 : undefined, sample: avg.length }; })(),
      sent: csatSent.length,
      answered: answered.length,
      responseRateBp: rateBp(answered.length, csatSent.length),
      waived: closed.filter((attendance) => attendance.csatStatus === "waived").length,
      disabledByChannel: closed.filter((attendance) => attendance.csatStatus === "disabled_by_channel").length,
      notApplicable: closed.filter((attendance) => attendance.csatStatus === "not_applicable").length,
      failed: closed.filter((attendance) => attendance.csatStatus === "failed").length,
    },
    closures: [...closureCounts.values()].sort((a, b) => b.count - a.count).map((row) => ({ ...row, shareBp: rateBp(row.count, classified) })),
    phases: [...phases.entries()].map(([phaseName, values]) => ({ phaseName, average: average(values) })).sort((a, b) => (b.average.value ?? 0) - (a.average.value ?? 0)),
  };
}

/** Comparativo por pessoa: participou ≠ finalizou (nunca misturar). */
export type AgentAttendanceRow = { userId: string; participated: number; finalized: number; frt: Average; holding: Average; csat: Average; transfersOut: number };

export function computeAgentRows(input: { userIds: readonly string[]; attendances: readonly AttendanceFact[]; assignments: readonly AssignmentFact[]; from: string; to: string }): AgentAttendanceRow[] {
  const closed = input.attendances.filter((attendance) => inRange(attendance.closedAt, input.from, input.to));
  const closedIds = new Set(closed.map((attendance) => attendance.id));
  return input.userIds.map((userId) => {
    const cycles = input.assignments.filter((cycle) => cycle.userId === userId);
    const finalizedByUser = closed.filter((attendance) => attendance.closedBy === userId);
    const csatScores = finalizedByUser.map((attendance) => attendance.csatScore).filter((score): score is number => isValidCsat(score));
    return {
      userId,
      participated: new Set(cycles.filter((cycle) => closedIds.has(cycle.attendanceId) || inRange(cycle.startedAt, input.from, input.to)).map((cycle) => cycle.attendanceId)).size,
      finalized: finalizedByUser.length,
      frt: average(cycles.filter((cycle) => cycle.timingKnown !== false && inRange(cycle.startedAt, input.from, input.to) && cycle.firstResponseAt).map((cycle) => secondsBetweenIso(cycle.startedAt, cycle.firstResponseAt!))),
      holding: average(cycles.filter((cycle) => cycle.timingKnown !== false && inRange(cycle.endedAt, input.from, input.to)).map((cycle) => secondsBetweenIso(cycle.startedAt, cycle.endedAt!))),
      csat: { value: csatScores.length ? Math.round((csatScores.reduce((a, b) => a + b, 0) / csatScores.length) * 100) / 100 : undefined, sample: csatScores.length },
      transfersOut: cycles.filter((cycle) => cycle.endReason === "transferred" && inRange(cycle.endedAt, input.from, input.to)).length,
    };
  }).filter((row) => row.participated || row.finalized);
}
