/**
 * Planos de gravação de reuniões do Vorix Meetings (assinatura por FRANQUIA DE HORAS GRAVADAS).
 *
 * Convive com o modelo antigo de gravações simultâneas (`meetings_base`/`meetings_extra_recording`):
 * um tenant SEM linha em `meeting_plan_subscriptions` continua exatamente como antes. Quando há
 * linha, este módulo é a fonte de verdade do acesso de gravação do tenant — o entitlement
 * `meetings` é recalculado daqui (marcado com `limits.recordingPlan = 1`) e o gate de gravação
 * (`recordingAllowance`) vale para "Gravar agora", gravação automática da agenda e upload.
 *
 * Regras (todas no backend; o frontend só exibe):
 * - Teste gratuito: 7 dias corridos, 5 horas no total, sem cartão, UM por organização (tenant),
 *   para sempre — `trialStartedAt` nunca é apagado.
 * - Franquia renovada a cada ciclo de cobrança (mensal, a partir da data de ativação); minutos não
 *   usados não acumulam.
 * - Consumo = duração efetivamente gravada (e enviada por upload) dentro do ciclo.
 * - Gravação em andamento NUNCA é cortada pela franquia: uma gravação que começou com saldo vai até
 *   o fim da reunião (limite técnico do gravador, 4 h por gravação). O excedente é descontado do
 *   ciclo e novas gravações ficam bloqueadas até a renovação ou um upgrade. Sem saldo, nenhuma
 *   gravação nova começa — nunca há consumo ilimitado.
 * - Upgrade vale na hora (mesmo ciclo, franquia maior). Downgrade vale na próxima renovação.
 * - Cancelamento vale no fim do ciclo pago. Depois disso (e depois do fim do teste sem contratação):
 *   novas gravações bloqueadas e 30 dias para exportar; então os arquivos de vídeo são removidos de
 *   forma auditada (transcrições e metadados permanecem, sem acesso, até uma nova contratação ou
 *   pedido de exclusão LGPD).
 * - Falha de pagamento: `past_due` bloqueia novas gravações na hora (dados preservados); sem
 *   regularização em 7 dias, a assinatura é encerrada como um cancelamento.
 */

export const MEETING_PLAN_CODES = ["individual", "professional", "teams"] as const;
export type MeetingPlanCode = (typeof MEETING_PLAN_CODES)[number];
export type MeetingPlanOrTrial = MeetingPlanCode | "trial";

export const MEETING_PLAN_STATUSES = ["trial", "active", "past_due", "canceled", "expired"] as const;
export type MeetingPlanStatus = (typeof MEETING_PLAN_STATUSES)[number];

export type MeetingPlanDefinition = {
  code: MeetingPlanOrTrial;
  name: string;
  /** Preço mensal em centavos de real. 0 no teste. */
  priceCents: number;
  currency: "BRL";
  /** Franquia do ciclo (no teste: o total dos 7 dias). */
  recordingMinutes: number;
  retentionDays: number;
  maxConcurrentRecordings: number;
  /** Texto curto exibido na comparação. */
  summary: string;
};

export const MEETING_TRIAL: MeetingPlanDefinition = Object.freeze({
  code: "trial",
  name: "Teste gratuito",
  priceCents: 0,
  currency: "BRL",
  recordingMinutes: 5 * 60,
  retentionDays: 90,
  maxConcurrentRecordings: 1,
  summary: "7 dias, até 5 horas de gravação, sem cartão.",
});
export const MEETING_TRIAL_DAYS = 7;

export const MEETING_PLANS: Readonly<Record<MeetingPlanCode, MeetingPlanDefinition>> = Object.freeze({
  individual: Object.freeze({ code: "individual", name: "Individual", priceCents: 1990, currency: "BRL", recordingMinutes: 20 * 60, retentionDays: 90, maxConcurrentRecordings: 1, summary: "Para quem grava as próprias reuniões." }),
  professional: Object.freeze({ code: "professional", name: "Profissional", priceCents: 3990, currency: "BRL", recordingMinutes: 60 * 60, retentionDays: 180, maxConcurrentRecordings: 1, summary: "Mais horas e retenção maior para uma rotina intensa de reuniões." }),
  teams: Object.freeze({ code: "teams", name: "Equipes", priceCents: 7990, currency: "BRL", recordingMinutes: 150 * 60, retentionDays: 365, maxConcurrentRecordings: 2, summary: "Horas compartilhadas pela equipe, com as permissões do Vorix." }),
});

export const MEETING_PLAN_EXPORT_WINDOW_DAYS = 30;
export const MEETING_PLAN_PAST_DUE_GRACE_DAYS = 7;
export const MEETING_RETENTION_NOTICE_DAYS = [15, 3] as const;
/** Limite técnico do gravador por gravação (MEETINGS_MAX_RECORDING_DURATION_MINUTES). */
export const MEETING_RECORDING_MAX_MINUTES = 240;

export function isMeetingPlanCode(value: unknown): value is MeetingPlanCode {
  return typeof value === "string" && (MEETING_PLAN_CODES as readonly string[]).includes(value);
}

export function meetingPlanDefinition(code: MeetingPlanOrTrial): MeetingPlanDefinition {
  return code === "trial" ? MEETING_TRIAL : MEETING_PLANS[code];
}

export type MeetingPlanSubscription = {
  tenantId: string;
  planCode: MeetingPlanOrTrial;
  status: MeetingPlanStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  /** Downgrade agendado para a próxima renovação. */
  pendingPlanCode?: MeetingPlanCode;
  /** Marca permanente de "teste já usado" (um por organização). */
  trialStartedAt?: string;
  canceledAt?: string;
  endedAt?: string;
  /** Fim da janela de exportação depois do encerramento. */
  exportUntil?: string;
  paymentFailedAt?: string;
  /** Janela de exportação fechada: arquivos removidos e acesso encerrado. */
  exportClosedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MeetingPlanEventKind =
  | "trial_started"
  | "trial_expired"
  | "plan_activated"
  | "plan_upgraded"
  | "downgrade_scheduled"
  | "downgrade_canceled"
  | "downgrade_applied"
  | "renewed"
  | "cancel_scheduled"
  | "cancel_reverted"
  | "canceled"
  | "payment_failed"
  | "payment_recovered"
  | "ended_unpaid"
  | "export_window_closed";

export type MeetingPlanTransition = { next: MeetingPlanSubscription; events: { kind: MeetingPlanEventKind; details?: Record<string, unknown> }[] };

export class MeetingPlanError extends Error {
  constructor(
    readonly code:
      | "TRIAL_ALREADY_USED"
      | "PLAN_ALREADY_ACTIVE"
      | "PLAN_NOT_ACTIVE"
      | "SAME_PLAN"
      | "NOT_CANCELED"
      | "INVALID_PLAN",
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

/** Mesmo dia do mês seguinte (31/01 → 28/02 ou 29/02): ciclo mensal sem "pular" mês. */
export function addOneMonth(iso: string): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next.toISOString();
}

/** Assinatura que ainda dá direito a GRAVAR (o bloqueio por franquia é aplicado à parte). */
export function isRecordingStatus(status: MeetingPlanStatus): boolean {
  return status === "trial" || status === "active";
}

/** Status em que a assinatura está "viva" (não encerrada). */
export function isLiveStatus(status: MeetingPlanStatus): boolean {
  return status === "trial" || status === "active" || status === "past_due";
}

export function startTrial(current: MeetingPlanSubscription | undefined, tenantId: string, now: Date): MeetingPlanTransition {
  if (current?.trialStartedAt) throw new MeetingPlanError("TRIAL_ALREADY_USED", "O teste gratuito já foi usado por esta organização.");
  if (current && isLiveStatus(current.status)) throw new MeetingPlanError("PLAN_ALREADY_ACTIVE", "Esta organização já tem um plano de gravação ativo.");
  const at = now.toISOString();
  const next: MeetingPlanSubscription = {
    tenantId,
    planCode: "trial",
    status: "trial",
    currentPeriodStart: at,
    currentPeriodEnd: addDays(at, MEETING_TRIAL_DAYS),
    cancelAtPeriodEnd: false,
    trialStartedAt: at,
    createdAt: current?.createdAt ?? at,
    updatedAt: at,
  };
  return { next, events: [{ kind: "trial_started", details: { endsAt: next.currentPeriodEnd } }] };
}

/** Ativação de um plano PAGO (pagamento confirmado ou concessão do admin da plataforma). Começa um
 * ciclo novo a partir de agora — vale para quem vem do teste, de um encerramento ou do zero. */
export function activatePlan(current: MeetingPlanSubscription | undefined, tenantId: string, planCode: MeetingPlanCode, now: Date): MeetingPlanTransition {
  if (current && (current.status === "active" || current.status === "past_due")) throw new MeetingPlanError("PLAN_ALREADY_ACTIVE", "Já existe um plano pago ativo — use a troca de plano.");
  const at = now.toISOString();
  const next: MeetingPlanSubscription = {
    tenantId,
    planCode,
    status: "active",
    currentPeriodStart: at,
    currentPeriodEnd: addOneMonth(at),
    cancelAtPeriodEnd: false,
    ...(current?.trialStartedAt ? { trialStartedAt: current.trialStartedAt } : {}),
    createdAt: current?.createdAt ?? at,
    updatedAt: at,
  };
  return { next, events: [{ kind: "plan_activated", details: { planCode, from: current?.planCode ?? null, periodEnd: next.currentPeriodEnd } }] };
}

/** Upgrade: imediato, no MESMO ciclo (a franquia maior passa a valer já). Downgrade: agendado. */
export function changePlan(current: MeetingPlanSubscription | undefined, planCode: MeetingPlanCode, now: Date): MeetingPlanTransition {
  if (!current || current.status !== "active" || current.planCode === "trial") throw new MeetingPlanError("PLAN_NOT_ACTIVE", "Não há plano pago ativo para trocar.");
  const at = now.toISOString();
  if (current.planCode === planCode) {
    if (current.pendingPlanCode) {
      const { pendingPlanCode: _dropped, ...rest } = current;
      return { next: { ...rest, updatedAt: at }, events: [{ kind: "downgrade_canceled", details: { planCode } }] };
    }
    throw new MeetingPlanError("SAME_PLAN", "Este já é o plano atual.");
  }
  const from = MEETING_PLANS[current.planCode];
  const to = MEETING_PLANS[planCode];
  const { pendingPlanCode: _pending, ...base } = current;
  if (to.priceCents > from.priceCents) {
    return { next: { ...base, planCode, updatedAt: at }, events: [{ kind: "plan_upgraded", details: { from: current.planCode, to: planCode } }] };
  }
  return { next: { ...base, pendingPlanCode: planCode, updatedAt: at }, events: [{ kind: "downgrade_scheduled", details: { from: current.planCode, to: planCode, effectiveAt: current.currentPeriodEnd } }] };
}

export function scheduleCancellation(current: MeetingPlanSubscription | undefined, now: Date): MeetingPlanTransition {
  if (!current || !isLiveStatus(current.status) || current.status === "trial") throw new MeetingPlanError("PLAN_NOT_ACTIVE", "Não há plano pago ativo para cancelar.");
  if (current.cancelAtPeriodEnd) return { next: current, events: [] };
  const at = now.toISOString();
  return { next: { ...current, cancelAtPeriodEnd: true, canceledAt: at, updatedAt: at }, events: [{ kind: "cancel_scheduled", details: { effectiveAt: current.currentPeriodEnd } }] };
}

export function revertCancellation(current: MeetingPlanSubscription | undefined, now: Date): MeetingPlanTransition {
  if (!current || !isLiveStatus(current.status) || !current.cancelAtPeriodEnd) throw new MeetingPlanError("NOT_CANCELED", "Não há cancelamento agendado para desfazer.");
  const { canceledAt: _canceledAt, ...rest } = current;
  const at = now.toISOString();
  return { next: { ...rest, cancelAtPeriodEnd: false, updatedAt: at }, events: [{ kind: "cancel_reverted" }] };
}

export function markPaymentFailed(current: MeetingPlanSubscription | undefined, now: Date): MeetingPlanTransition {
  if (!current || (current.status !== "active" && current.status !== "past_due")) throw new MeetingPlanError("PLAN_NOT_ACTIVE", "Não há plano pago ativo.");
  if (current.status === "past_due") return { next: current, events: [] };
  const at = now.toISOString();
  return { next: { ...current, status: "past_due", paymentFailedAt: at, updatedAt: at }, events: [{ kind: "payment_failed" }] };
}

/** Pagamento regularizado: volta a `active` e começa um ciclo novo a partir de agora. */
export function markPaymentRecovered(current: MeetingPlanSubscription | undefined, now: Date): MeetingPlanTransition {
  if (!current || current.status !== "past_due") throw new MeetingPlanError("PLAN_NOT_ACTIVE", "Não há pagamento pendente.");
  const at = now.toISOString();
  const { paymentFailedAt: _failed, ...rest } = current;
  return { next: { ...rest, status: "active", currentPeriodStart: at, currentPeriodEnd: addOneMonth(at), updatedAt: at }, events: [{ kind: "payment_recovered" }] };
}

function ended(current: MeetingPlanSubscription, status: "canceled" | "expired", endedAt: string, at: string): MeetingPlanSubscription {
  const { pendingPlanCode: _pending, ...rest } = current;
  return { ...rest, status, cancelAtPeriodEnd: false, endedAt, exportUntil: addDays(endedAt, MEETING_PLAN_EXPORT_WINDOW_DAYS), updatedAt: at };
}

/**
 * Passagem do tempo (scheduler): fim do teste, renovação mensal (com downgrade agendado),
 * cancelamento no fim do ciclo e encerramento por falta de pagamento. Idempotente: sem nada
 * vencido devolve `events: []`. Renovação "pula" ciclos perdidos (worker parado) até alcançar agora.
 *
 * Com cobrança real, a renovação de um plano pago só deveria acontecer com o pagamento do ciclo
 * confirmado; enquanto a cobrança está desligada (concessão manual), renova sozinha.
 */
export function advanceMeetingPlan(current: MeetingPlanSubscription, now: Date): MeetingPlanTransition {
  const at = now.toISOString();
  const nowMs = now.getTime();
  if (current.status === "trial" && Date.parse(current.currentPeriodEnd) <= nowMs) {
    return { next: ended(current, "expired", current.currentPeriodEnd, at), events: [{ kind: "trial_expired" }] };
  }
  if (current.status === "past_due" && current.paymentFailedAt && Date.parse(current.paymentFailedAt) + MEETING_PLAN_PAST_DUE_GRACE_DAYS * DAY_MS <= nowMs) {
    const endedAt = addDays(current.paymentFailedAt, MEETING_PLAN_PAST_DUE_GRACE_DAYS);
    return { next: ended(current, "canceled", endedAt, at), events: [{ kind: "ended_unpaid" }] };
  }
  if (current.status === "active" && Date.parse(current.currentPeriodEnd) <= nowMs) {
    if (current.cancelAtPeriodEnd) {
      return { next: ended(current, "canceled", current.currentPeriodEnd, at), events: [{ kind: "canceled", details: { endedAt: current.currentPeriodEnd } }] };
    }
    let start = current.currentPeriodEnd;
    let end = addOneMonth(start);
    while (Date.parse(end) <= nowMs) {
      start = end;
      end = addOneMonth(start);
    }
    const events: MeetingPlanTransition["events"] = [];
    let planCode = current.planCode;
    if (current.pendingPlanCode) {
      events.push({ kind: "downgrade_applied", details: { from: current.planCode, to: current.pendingPlanCode } });
      planCode = current.pendingPlanCode;
    }
    events.push({ kind: "renewed", details: { periodStart: start, periodEnd: end } });
    const { pendingPlanCode: _pending, ...rest } = current;
    return { next: { ...rest, planCode, currentPeriodStart: start, currentPeriodEnd: end, updatedAt: at }, events };
  }
  return { next: current, events: [] };
}

/** Fim da janela de exportação de uma assinatura encerrada (o chamador remove os arquivos). */
export function closeExportWindow(current: MeetingPlanSubscription, now: Date): MeetingPlanTransition {
  if (isLiveStatus(current.status) || current.exportClosedAt || !current.exportUntil || Date.parse(current.exportUntil) > now.getTime()) return { next: current, events: [] };
  const at = now.toISOString();
  return { next: { ...current, exportClosedAt: at, updatedAt: at }, events: [{ kind: "export_window_closed" }] };
}

/** Precisa de `advanceMeetingPlan` agora? (o scheduler usa isto para listar só o que venceu). */
export function meetingPlanDueAt(current: MeetingPlanSubscription): string | undefined {
  if (current.status === "trial" || current.status === "active") return current.currentPeriodEnd;
  if (current.status === "past_due" && current.paymentFailedAt) return addDays(current.paymentFailedAt, MEETING_PLAN_PAST_DUE_GRACE_DAYS);
  return undefined;
}

export type RecordingAllowance =
  | { ok: true; usedSeconds: number; limitSeconds: number; remainingSeconds: number }
  | { ok: false; reason: "TRIAL_EXPIRED" | "PLAN_ENDED" | "PAYMENT_FAILED" | "PLAN_QUOTA_REACHED"; message: string; usedSeconds: number; limitSeconds: number };

/** Pode começar uma gravação NOVA? `usedSeconds` = consumo do ciclo atual. */
export function recordingAllowance(current: MeetingPlanSubscription, usedSeconds: number, now: Date): RecordingAllowance {
  const definition = meetingPlanDefinition(current.planCode);
  const limitSeconds = definition.recordingMinutes * 60;
  const expired = Date.parse(current.currentPeriodEnd) <= now.getTime();
  if (current.status === "expired" || (current.status === "trial" && expired)) {
    return { ok: false, reason: "TRIAL_EXPIRED", message: "Seu teste gratuito terminou. Escolha um plano para continuar gravando — suas gravações seguem disponíveis para exportação.", usedSeconds, limitSeconds };
  }
  if (current.status === "canceled" || (current.status === "active" && expired && current.cancelAtPeriodEnd)) {
    return { ok: false, reason: "PLAN_ENDED", message: "Sua assinatura de gravação foi encerrada. Contrate um plano para voltar a gravar — as gravações seguem disponíveis para exportação durante 30 dias.", usedSeconds, limitSeconds };
  }
  if (current.status === "past_due") {
    return { ok: false, reason: "PAYMENT_FAILED", message: "O pagamento da sua assinatura não foi confirmado. Regularize para voltar a gravar — nenhuma gravação foi apagada.", usedSeconds, limitSeconds };
  }
  if (usedSeconds >= limitSeconds) {
    const what = current.status === "trial" ? "as 5 horas do teste gratuito" : `as ${definition.recordingMinutes / 60} horas do plano ${definition.name} neste ciclo`;
    const next = current.status === "trial" ? "Escolha um plano para continuar gravando." : "A franquia renova no próximo ciclo; para gravar antes, mude para um plano maior.";
    return { ok: false, reason: "PLAN_QUOTA_REACHED", message: `Você usou ${what}. ${next}`, usedSeconds, limitSeconds };
  }
  return { ok: true, usedSeconds, limitSeconds, remainingSeconds: limitSeconds - usedSeconds };
}

/** Entitlement `meetings` derivado do plano. Acesso (ler/exportar) continua durante a janela de
 * exportação; depois, só uma nova contratação devolve o acesso. */
export function meetingPlanEntitlement(current: MeetingPlanSubscription, now: Date): { enabled: boolean; limits: Record<string, number> } {
  const definition = meetingPlanDefinition(current.planCode);
  const inExportWindow = Boolean(current.exportUntil && Date.parse(current.exportUntil) > now.getTime());
  return {
    enabled: isLiveStatus(current.status) || inExportWindow,
    limits: {
      recordingPlan: 1,
      maxConcurrentRecordings: definition.maxConcurrentRecordings,
      // A franquia do plano é aplicada por `recordingAllowance` (ciclo de cobrança); o limite
      // mensal antigo (mês civil) fica desligado para não contar duas vezes.
      monthlyRecordingMinutes: 0,
      meetingRetentionDays: definition.retentionDays,
    },
  };
}

/** Data em que o arquivo de uma gravação será removido: retenção do plano OU fim da janela de
 * exportação, o que vier primeiro. */
export function recordingDeletionDate(input: { recordedAt: string; retentionDays: number; exportUntil?: string }): string {
  const byRetention = Date.parse(input.recordedAt) + input.retentionDays * DAY_MS;
  const byWindow = input.exportUntil ? Date.parse(input.exportUntil) : Number.POSITIVE_INFINITY;
  return new Date(Math.min(byRetention, byWindow)).toISOString();
}

/** Qual aviso de exclusão (15 ou 3 dias antes) está devido agora, se algum. Avisos já enviados
 * (`sent`) nunca repetem; se o de 15 dias foi perdido e já faltam ≤3, só o de 3 sai. */
export function dueRetentionNotice(input: { deletionAt: string; now: Date; sent: readonly number[] }): number | undefined {
  const remainingDays = (Date.parse(input.deletionAt) - input.now.getTime()) / DAY_MS;
  if (remainingDays <= 0) return undefined;
  const candidates = [...MEETING_RETENTION_NOTICE_DAYS].sort((a, b) => a - b).filter((days) => remainingDays <= days);
  const closest = candidates[0];
  return closest !== undefined && !input.sent.includes(closest) ? closest : undefined;
}
