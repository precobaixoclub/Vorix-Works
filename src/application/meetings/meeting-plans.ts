import type { MeetingPlanEvent, MeetingPlanRepositoryPort } from "../ports/meeting-plan-repository.port.js";
import type { SolutionEntitlementRepositoryPort } from "../ports/solution-entitlement-repository.port.js";
import type { MeetingMediaStoragePort, MeetingRecordingGate } from "./meeting-use-cases.js";
import {
  activatePlan,
  advanceMeetingPlan,
  changePlan,
  closeExportWindow,
  dueRetentionNotice,
  markPaymentFailed,
  markPaymentRecovered,
  meetingPlanDefinition,
  meetingPlanEntitlement,
  MEETING_PLAN_CODES,
  MEETING_PLANS,
  MEETING_RECORDING_MAX_MINUTES,
  MEETING_RETENTION_NOTICE_DAYS,
  MEETING_TRIAL,
  MEETING_TRIAL_DAYS,
  MeetingPlanError,
  recordingAllowance,
  recordingDeletionDate,
  revertCancellation,
  scheduleCancellation,
  startTrial,
  type MeetingPlanCode,
  type MeetingPlanDefinition,
  type MeetingPlanSubscription,
  type MeetingPlanTransition,
  type RecordingAllowance,
} from "../../domain/meetings/meeting-plans.model.js";

/**
 * Casos de uso dos planos de gravação do Meetings (regras em `meeting-plans.model.ts`).
 *
 * COBRANÇA: a contratação paga self-service fica FECHADA (`checkoutOpen: false`) até a validação de
 * custos e a autorização comercial. Enquanto isso o cliente pode iniciar o teste, reduzir o plano,
 * cancelar e desfazer o cancelamento; ativar/subir de plano e registrar pagamento é feito pelo
 * admin da plataforma (concessão manual, auditada) — o mesmo caminho que o webhook do gateway vai
 * usar quando a cobrança for ligada.
 */
export type MeetingPlanDeps = {
  plans: MeetingPlanRepositoryPort;
  entitlements: Pick<SolutionEntitlementRepositoryPort, "listByTenant" | "set">;
  now: () => Date;
  idGenerator: (prefix: string) => string;
};

export type MeetingPlanActor = { tenantId: string; userId: string; role: string };

const MANAGER_ROLES = new Set(["owner", "admin"]);

export function assertCanManageMeetingPlan(actor: MeetingPlanActor): void {
  if (!MANAGER_ROLES.has(actor.role)) throw new MeetingPlanAccessError();
}

export class MeetingPlanAccessError extends Error {
  constructor() {
    super("MEETING_PLAN_FORBIDDEN: só o dono ou um administrador da organização pode alterar o plano de gravação.");
  }
}

export class MeetingPlanCheckoutClosedError extends Error {
  constructor() {
    super("MEETING_PLAN_CHECKOUT_CLOSED: a contratação dos planos pagos ainda não está aberta. Fale com a equipe Vorix para ativar um plano.");
  }
}

/** Lê, aplica a transição, grava com concorrência otimista, audita e sincroniza o acesso. */
async function apply(deps: MeetingPlanDeps, tenantId: string, transition: (current: MeetingPlanSubscription | undefined) => MeetingPlanTransition, actorUserId?: string): Promise<MeetingPlanSubscription> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await deps.plans.get(tenantId);
    const { next, events } = transition(current);
    if (events.length === 0) return next;
    if (!(await deps.plans.save(next, current?.updatedAt))) continue;
    const occurredAt = deps.now().toISOString();
    await deps.plans.appendEvents(events.map((event): MeetingPlanEvent => ({
      id: deps.idGenerator("mpe"), tenantId, kind: event.kind, planCode: next.planCode, status: next.status,
      details: event.details ?? {}, ...(actorUserId ? { actorUserId } : {}), occurredAt,
    })));
    await syncMeetingPlanEntitlement(deps, next);
    return next;
  }
  throw new Error("MEETING_PLAN_CONFLICT: o plano mudou durante a operação. Tente de novo.");
}

/**
 * Entitlement `meetings` derivado do plano. Concessão do operador (`internal`/`manual`) sempre vence
 * e nunca é tocada — mesmo princípio de `syncMeetingsEntitlementFromSubscription`.
 */
export async function syncMeetingPlanEntitlement(deps: Pick<MeetingPlanDeps, "entitlements" | "now">, subscription: MeetingPlanSubscription): Promise<void> {
  const current = (await deps.entitlements.listByTenant(subscription.tenantId)).find((entitlement) => entitlement.solutionKey === "meetings");
  if (current && current.source !== "subscription") return;
  const target = meetingPlanEntitlement(subscription, deps.now());
  const limits = target.enabled ? { ...(current?.limits ?? {}), ...target.limits } : { ...(current?.limits ?? {}), recordingPlan: 0 };
  const same = current?.enabled === target.enabled && Object.entries(limits).every(([key, value]) => current?.limits?.[key] === value);
  if (same) return;
  const definition = meetingPlanDefinition(subscription.planCode);
  await deps.entitlements.set({
    tenantId: subscription.tenantId, solutionKey: "meetings", enabled: target.enabled, source: "subscription", limits,
    reason: target.enabled ? `Plano de gravação: ${definition.name} (${subscription.status})` : "Plano de gravação encerrado (janela de exportação terminou)",
  });
}

/** Consumo do ciclo atual (do teste: desde o início dos 7 dias). */
async function usedInCycle(deps: MeetingPlanDeps, subscription: MeetingPlanSubscription): Promise<number> {
  return deps.plans.usedSeconds(subscription.tenantId, subscription.currentPeriodStart, subscription.currentPeriodEnd);
}

/** Gate de gravação nova (backend é a autoridade). Sem plano = `undefined` (regra antiga). */
export function meetingRecordingGate(deps: MeetingPlanDeps): MeetingRecordingGate {
  return async (tenantId) => {
    const subscription = await deps.plans.get(tenantId);
    if (!subscription) return undefined;
    const allowance = recordingAllowance(subscription, await usedInCycle(deps, subscription), deps.now());
    return allowance.ok ? { ok: true } : { ok: false, reason: allowance.reason, message: allowance.message };
  };
}

export type MeetingPlanCatalogEntry = MeetingPlanDefinition & { recordingHours: number };

export type MeetingPlanOverview = {
  catalog: { trial: MeetingPlanCatalogEntry & { days: number }; plans: MeetingPlanCatalogEntry[] };
  subscription?: MeetingPlanSubscription;
  usage?: { usedSeconds: number; limitSeconds: number; periodStart: string; periodEnd: string };
  allowance?: RecordingAllowance;
  trialAvailable: boolean;
  /** Contratação paga self-service aberta? (fechada até a liberação da cobrança). */
  checkoutOpen: boolean;
  canManage: boolean;
  rules: { exportWindowDays: number; retentionNoticeDays: readonly number[]; maxRecordingMinutes: number };
};

const entry = (definition: MeetingPlanDefinition): MeetingPlanCatalogEntry => ({ ...definition, recordingHours: definition.recordingMinutes / 60 });

export function meetingPlanCatalog(): MeetingPlanOverview["catalog"] {
  return { trial: { ...entry(MEETING_TRIAL), days: MEETING_TRIAL_DAYS }, plans: MEETING_PLAN_CODES.map((code) => entry(MEETING_PLANS[code])) };
}

export async function getMeetingPlanOverview(deps: MeetingPlanDeps, actor: MeetingPlanActor): Promise<MeetingPlanOverview> {
  const subscription = await deps.plans.get(actor.tenantId);
  const base = {
    catalog: meetingPlanCatalog(),
    trialAvailable: !subscription?.trialStartedAt && !(subscription && ["trial", "active", "past_due"].includes(subscription.status)),
    checkoutOpen: false,
    canManage: MANAGER_ROLES.has(actor.role),
    rules: { exportWindowDays: 30, retentionNoticeDays: MEETING_RETENTION_NOTICE_DAYS, maxRecordingMinutes: MEETING_RECORDING_MAX_MINUTES },
  };
  if (!subscription) return base;
  const usedSeconds = await usedInCycle(deps, subscription);
  const allowance = recordingAllowance(subscription, usedSeconds, deps.now());
  return {
    ...base,
    subscription,
    usage: { usedSeconds, limitSeconds: allowance.limitSeconds, periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd },
    allowance,
  };
}

export async function startMeetingTrial(deps: MeetingPlanDeps, actor: MeetingPlanActor): Promise<MeetingPlanSubscription> {
  assertCanManageMeetingPlan(actor);
  return apply(deps, actor.tenantId, (current) => startTrial(current, actor.tenantId, deps.now()), actor.userId);
}

/** Troca de plano pedida pelo CLIENTE: reduzir (sem custo) é liberado; contratar ou subir de plano
 * exige pagamento e fica fechado até a cobrança ser liberada. */
export async function requestMeetingPlanChange(deps: MeetingPlanDeps, actor: MeetingPlanActor, planCode: MeetingPlanCode): Promise<MeetingPlanSubscription> {
  assertCanManageMeetingPlan(actor);
  const current = await deps.plans.get(actor.tenantId);
  const paidActive = current && current.status === "active" && current.planCode !== "trial";
  if (!paidActive) throw new MeetingPlanCheckoutClosedError();
  const isUpgrade = MEETING_PLANS[planCode].priceCents > MEETING_PLANS[current.planCode as MeetingPlanCode].priceCents;
  if (isUpgrade) throw new MeetingPlanCheckoutClosedError();
  return apply(deps, actor.tenantId, (latest) => changePlan(latest, planCode, deps.now()), actor.userId);
}

export async function cancelMeetingPlan(deps: MeetingPlanDeps, actor: MeetingPlanActor): Promise<MeetingPlanSubscription> {
  assertCanManageMeetingPlan(actor);
  return apply(deps, actor.tenantId, (current) => scheduleCancellation(current, deps.now()), actor.userId);
}

export async function revertMeetingPlanCancellation(deps: MeetingPlanDeps, actor: MeetingPlanActor): Promise<MeetingPlanSubscription> {
  assertCanManageMeetingPlan(actor);
  return apply(deps, actor.tenantId, (current) => revertCancellation(current, deps.now()), actor.userId);
}

export const MEETING_PLAN_ADMIN_ACTIONS = ["activate", "change", "cancel", "revert_cancel", "payment_failed", "payment_recovered", "advance"] as const;
export type MeetingPlanAdminAction = (typeof MEETING_PLAN_ADMIN_ACTIONS)[number];

/** Operação do ADMIN DA PLATAFORMA sobre o plano de um tenant (concessão manual / registro de
 * pagamento) — também é o ponto de entrada do futuro webhook do gateway. Sempre auditada. */
export async function adminMeetingPlanAction(deps: MeetingPlanDeps, input: { tenantId: string; adminUserId: string; action: MeetingPlanAdminAction; planCode?: MeetingPlanCode }): Promise<MeetingPlanSubscription | undefined> {
  const now = deps.now();
  const need = () => {
    if (!input.planCode) throw new MeetingPlanError("INVALID_PLAN", "Informe o plano.");
    return input.planCode;
  };
  switch (input.action) {
    case "activate": {
      const planCode = need();
      return apply(deps, input.tenantId, (current) => activatePlan(current, input.tenantId, planCode, now), input.adminUserId);
    }
    case "change": {
      const planCode = need();
      return apply(deps, input.tenantId, (current) => changePlan(current, planCode, now), input.adminUserId);
    }
    case "cancel":
      return apply(deps, input.tenantId, (current) => scheduleCancellation(current, now), input.adminUserId);
    case "revert_cancel":
      return apply(deps, input.tenantId, (current) => revertCancellation(current, now), input.adminUserId);
    case "payment_failed":
      return apply(deps, input.tenantId, (current) => markPaymentFailed(current, now), input.adminUserId);
    case "payment_recovered":
      return apply(deps, input.tenantId, (current) => markPaymentRecovered(current, now), input.adminUserId);
    case "advance": {
      const current = await deps.plans.get(input.tenantId);
      if (!current) return undefined;
      return apply(deps, input.tenantId, (latest) => (latest ? advanceMeetingPlan(latest, now) : { next: current, events: [] }), input.adminUserId);
    }
  }
}

export type MeetingPlanMaintenanceDeps = MeetingPlanDeps & {
  media: Pick<MeetingMediaStoragePort, "delete">;
  markRecordingPurged: (recordingId: string) => Promise<boolean>;
  audit: (input: { tenantId: string; workspaceId: string; meetingId: string; action: string; details: Record<string, unknown> }) => Promise<void>;
  notify?: (input: { tenantId: string; workspaceId: string; userId: string; title: string; body: string; meetingId: string }) => Promise<void>;
};

const dateBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Rotina periódica (worker `retention`): (1) fim de teste/renovação/cancelamento/carência;
 * (2) janela de exportação encerrada → remove os arquivos (auditado) e fecha o acesso;
 * (3) avisos de exclusão 15 e 3 dias antes. Idempotente e segura para rodar em paralelo.
 */
export async function runMeetingPlanMaintenance(deps: MeetingPlanMaintenanceDeps, input: { limit: number; defaultRetentionDays: number }): Promise<{ advanced: number; windowsClosed: number; filesRemoved: number; notices: number }> {
  const now = deps.now();
  let advanced = 0;
  for (const due of await deps.plans.listDue(now, input.limit)) {
    const before = due.updatedAt;
    const next = await apply(deps, due.tenantId, (current) => (current ? advanceMeetingPlan(current, now) : { next: due, events: [] }));
    if (next.updatedAt !== before) advanced += 1;
  }

  let windowsClosed = 0;
  let filesRemoved = 0;
  for (const ended of await deps.plans.listExportWindowDue(now, input.limit)) {
    let failed = false;
    for (;;) {
      const batch = await deps.plans.listRecordingsOfTenant(ended.tenantId, 100);
      if (batch.length === 0) break;
      for (const recording of batch) {
        try {
          await deps.media.delete(recording.storageKey);
          if (await deps.markRecordingPurged(recording.recordingId)) {
            filesRemoved += 1;
            await deps.audit({ tenantId: recording.tenantId, workspaceId: recording.workspaceId, meetingId: recording.meetingId, action: "recording.purged", details: { recordingId: recording.recordingId, bytes: recording.bytes, reason: "plan_export_window_closed" } });
          }
        } catch (error) {
          failed = true;
          await deps.audit({ tenantId: recording.tenantId, workspaceId: recording.workspaceId, meetingId: recording.meetingId, action: "recording.purge_failed", details: { recordingId: recording.recordingId, error: error instanceof Error ? error.message.slice(0, 300) : String(error) } });
        }
      }
      if (failed) break;
    }
    // Só fecha a janela quando TODOS os arquivos saíram; uma falha tenta de novo na próxima rodada.
    if (!failed) {
      await apply(deps, ended.tenantId, (current) => (current ? closeExportWindow(current, now) : { next: ended, events: [] }));
      windowsClosed += 1;
    }
  }

  let notices = 0;
  const horizon = Math.max(...MEETING_RETENTION_NOTICE_DAYS);
  for (const candidate of await deps.plans.listRetentionNoticeCandidates({ now, horizonDays: horizon, defaultRetentionDays: input.defaultRetentionDays, limit: input.limit * 5 })) {
    const deletionAt = recordingDeletionDate({ recordedAt: candidate.recordedAt, retentionDays: candidate.retentionDays, ...(candidate.exportUntil ? { exportUntil: candidate.exportUntil } : {}) });
    const days = dueRetentionNotice({ deletionAt, now, sent: candidate.sentNotices });
    if (days === undefined) continue;
    if (!(await deps.plans.markRetentionNotice({ recordingId: candidate.recordingId, tenantId: candidate.tenantId, daysBefore: days }))) continue;
    notices += 1;
    if (deps.notify && candidate.ownerUserId) {
      await deps.notify({
        tenantId: candidate.tenantId, workspaceId: candidate.workspaceId, userId: candidate.ownerUserId, meetingId: candidate.meetingId,
        title: `Gravação será excluída em ${days} dias`,
        body: `${candidate.meetingTitle}: o vídeo será removido em ${dateBr(deletionAt)}, conforme a retenção do seu plano. Exporte antes dessa data se quiser guardar uma cópia.`,
      }).catch(() => undefined);
    }
  }
  return { advanced, windowsClosed, filesRemoved, notices };
}
