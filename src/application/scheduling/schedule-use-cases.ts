import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { SchedulingRepositoryPort } from "../ports/scheduling-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { AuditActor } from "../../domain/credential/credential.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type { MissedOccurrencePolicy, PublicationSchedule, ScheduleFrequency, ScheduleOccurrence } from "../../domain/scheduling/scheduling.model.js";
import { ScheduleConflictDetector } from "./schedule-conflict-detector.js";
import { ScheduleOccurrenceGenerator, normalizeScheduleLocalInput } from "./schedule-occurrence-generator.js";
import { assertIanaTimezone, zonedTimeToUtc } from "./timezone.js";

export type SchedulingUseCasesDeps = {
  repository: SchedulingRepositoryPort;
  publicationRepository: PublicationRepositoryPort;
  auditRepository: OperationalAuditRepositoryPort;
  clock: ClockPort;
  occurrenceGenerator: ScheduleOccurrenceGenerator;
  conflictDetector: ScheduleConflictDetector;
  idGenerator: () => string;
};

export type CreateScheduleInput = {
  tenantId: string;
  workspaceId: string;
  publicationPlanId: string;
  publicationCandidateId: string;
  providerId: PublicationProvider;
  targetId: string;
  scheduledAt?: string;
  timezone: string;
  governancePolicyReference?: string;
  credentialReferenceId?: string;
  campaignId?: string;
  contentChecksum?: string;
  missedPolicy?: MissedOccurrencePolicy;
  allowDegradedProvider?: boolean;
  maxAttempts?: number;
  recurrence?: {
    frequency: Exclude<ScheduleFrequency, "once">;
    startAt: string;
    endAt?: string;
    count?: number;
    interval?: number;
    daysOfWeek?: readonly number[];
    dayOfMonth?: number;
    windowDays?: number;
    allowOpenRecurrence?: boolean;
  };
  actor: AuditActor;
  requestId?: string;
};

export class SchedulingUseCases {
  constructor(private readonly deps: SchedulingUseCasesDeps) {}

  async createSchedule(input: CreateScheduleInput): Promise<{ schedule: PublicationSchedule; occurrences: ScheduleOccurrence[] }> {
    assertIanaTimezone(input.timezone);
    await this.assertPublicationReferences(input);
    const now = this.deps.clock.nowIso();
    const scheduleId = this.deps.idGenerator();
    const recurrence = input.recurrence ? this.buildRule(scheduleId, input, now) : undefined;
    const single = input.recurrence ? undefined : normalizeScheduleLocalInput({ scheduledAt: input.scheduledAt, timezone: input.timezone });
    const schedule = await this.deps.repository.createSchedule({
      id: scheduleId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      publicationPlanId: input.publicationPlanId,
      publicationCandidateId: input.publicationCandidateId,
      providerId: input.providerId,
      targetId: input.targetId,
      status: "scheduled",
      timezone: input.timezone,
      scheduledAtUtc: single?.utc ?? recurrence?.startAtUtc,
      scheduledAtLocal: single?.localDateTime ?? recurrence?.startAtLocal,
      recurrence,
      governancePolicyReference: input.governancePolicyReference,
      credentialReferenceId: input.credentialReferenceId,
      campaignId: input.campaignId,
      contentChecksum: input.contentChecksum,
      missedPolicy: input.missedPolicy ?? "manual_review",
      allowDegradedProvider: input.allowDegradedProvider ?? false,
      maxAttempts: Math.max(1, Math.min(input.maxAttempts ?? 3, 10)),
      createdByUserId: input.actor.userId,
    });
    const occurrences = await this.generateOccurrences(schedule, now);
    await this.audit("schedule.created", input, { scheduleId: schedule.id, occurrences: occurrences.length });
    await this.event({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: schedule.id, eventType: "schedule.created", actorUserId: input.actor.userId, payload: { occurrences: occurrences.length } });
    return { schedule, occurrences };
  }

  async generateOccurrences(schedule: PublicationSchedule, fromUtc = this.deps.clock.nowIso()): Promise<ScheduleOccurrence[]> {
    const occurrences = this.deps.occurrenceGenerator.generate({ schedule, fromUtc, idGenerator: this.deps.idGenerator });
    const persisted = await this.deps.repository.upsertOccurrences(occurrences);
    await this.deps.conflictDetector.detectForOccurrences({ schedule, occurrences: persisted });
    for (const occurrence of persisted) {
      await this.event({ tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, scheduleId: occurrence.scheduleId, occurrenceId: occurrence.id, eventType: "schedule.occurrence_created", payload: { dueAtUtc: occurrence.dueAtUtc, timezone: occurrence.timezone } });
    }
    return persisted;
  }

  async getSchedule(input: { tenantId: string; workspaceId: string; scheduleId: string }): Promise<PublicationSchedule> {
    const schedule = await this.deps.repository.getSchedule(input.scheduleId);
    if (!schedule || schedule.tenantId !== input.tenantId || schedule.workspaceId !== input.workspaceId) throw new Error("SCHEDULE_NOT_FOUND: schedule não encontrado.");
    return schedule;
  }

  async pauseSchedule(input: { tenantId: string; workspaceId: string; scheduleId: string; actor: AuditActor; requestId?: string }): Promise<PublicationSchedule> {
    const schedule = await this.getSchedule(input);
    const updated = await this.deps.repository.updateSchedule({ id: schedule.id, tenantId: input.tenantId, workspaceId: input.workspaceId, expectedVersion: schedule.version, patch: { status: "paused", pausedAt: this.deps.clock.nowIso() } });
    await this.audit("schedule.paused", input, { scheduleId: schedule.id });
    await this.event({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: schedule.id, eventType: "schedule.paused", actorUserId: input.actor.userId });
    return updated;
  }

  async resumeSchedule(input: { tenantId: string; workspaceId: string; scheduleId: string; actor: AuditActor; requestId?: string }): Promise<{ schedule: PublicationSchedule; occurrences: ScheduleOccurrence[] }> {
    const schedule = await this.getSchedule(input);
    const updated = await this.deps.repository.updateSchedule({ id: schedule.id, tenantId: input.tenantId, workspaceId: input.workspaceId, expectedVersion: schedule.version, patch: { status: "scheduled", pausedAt: undefined } });
    const occurrences = await this.generateOccurrences(updated, this.deps.clock.nowIso());
    await this.audit("schedule.resumed", input, { scheduleId: schedule.id, occurrences: occurrences.length });
    await this.event({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: schedule.id, eventType: "schedule.resumed", actorUserId: input.actor.userId });
    return { schedule: updated, occurrences };
  }

  async cancelSchedule(input: { tenantId: string; workspaceId: string; scheduleId: string; actor: AuditActor; requestId?: string; futureOnly?: boolean }): Promise<PublicationSchedule> {
    const schedule = await this.getSchedule(input);
    const now = this.deps.clock.nowIso();
    const updated = await this.deps.repository.updateSchedule({ id: schedule.id, tenantId: input.tenantId, workspaceId: input.workspaceId, expectedVersion: schedule.version, patch: { status: "cancelled", cancelledAt: now } });
    const occurrences = await this.deps.repository.listOccurrences({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: schedule.id, limit: 1000 });
    for (const occurrence of occurrences.filter((item) => item.status === "pending" || item.status === "missed" || item.status === "claimed")) {
      if (input.futureOnly && occurrence.dueAtUtc < now) continue;
      await this.deps.repository.markOccurrenceStatus({ occurrenceId: occurrence.id, tenantId: input.tenantId, workspaceId: input.workspaceId, status: "cancelled", now, reason: "schedule_cancelled" });
      await this.event({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: schedule.id, occurrenceId: occurrence.id, eventType: "schedule.occurrence_cancelled", actorUserId: input.actor.userId });
    }
    await this.audit("schedule.cancelled", input, { scheduleId: schedule.id, futureOnly: input.futureOnly ?? false });
    await this.event({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: schedule.id, eventType: "schedule.cancelled", actorUserId: input.actor.userId });
    return updated;
  }

  async rescheduleOccurrence(input: { tenantId: string; workspaceId: string; occurrenceId: string; scheduledAt: string; timezone: string; actor: AuditActor; requestId?: string }): Promise<ScheduleOccurrence> {
    assertIanaTimezone(input.timezone);
    const dueAtUtc = zonedTimeToUtc(input.scheduledAt, input.timezone);
    const occurrence = await this.deps.repository.rescheduleOccurrence({ occurrenceId: input.occurrenceId, tenantId: input.tenantId, workspaceId: input.workspaceId, dueAtUtc, localDateTime: input.scheduledAt, timezone: input.timezone, now: this.deps.clock.nowIso() });
    await this.audit("schedule.occurrence_rescheduled", input, { occurrenceId: occurrence.id, dueAtUtc, timezone: input.timezone });
    await this.event({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: occurrence.scheduleId, occurrenceId: occurrence.id, eventType: "schedule.occurrence_rescheduled", actorUserId: input.actor.userId, payload: { dueAtUtc, timezone: input.timezone } });
    return occurrence;
  }

  async cancelOccurrence(input: { tenantId: string; workspaceId: string; occurrenceId: string; actor: AuditActor; requestId?: string }): Promise<ScheduleOccurrence | undefined> {
    const occurrence = await this.deps.repository.markOccurrenceStatus({ occurrenceId: input.occurrenceId, tenantId: input.tenantId, workspaceId: input.workspaceId, status: "cancelled", now: this.deps.clock.nowIso(), reason: "occurrence_cancelled" });
    if (occurrence) {
      await this.audit("schedule.occurrence_cancelled", input, { occurrenceId: occurrence.id, scheduleId: occurrence.scheduleId });
      await this.event({ tenantId: input.tenantId, workspaceId: input.workspaceId, scheduleId: occurrence.scheduleId, occurrenceId: occurrence.id, eventType: "schedule.occurrence_cancelled", actorUserId: input.actor.userId });
    }
    return occurrence;
  }

  private buildRule(scheduleId: string, input: CreateScheduleInput, now: string) {
    const recurrence = input.recurrence!;
    if (!recurrence.endAt && !recurrence.count && !recurrence.allowOpenRecurrence) throw new Error("SCHEDULE_RECURRENCE_BOUNDED_REQUIRED: recorrência exige endAt ou count.");
    const start = normalizeScheduleLocalInput({ startAt: recurrence.startAt, timezone: input.timezone });
    const endAtUtc = recurrence.endAt ? zonedTimeToUtc(recurrence.endAt, input.timezone) : undefined;
    const interval = Math.max(1, Math.min(recurrence.interval ?? 1, 365));
    if (recurrence.frequency === "weekly" && recurrence.daysOfWeek?.some((day) => day < 0 || day > 6)) throw new Error("SCHEDULE_DAYS_OF_WEEK_INVALID: daysOfWeek usa 0-6.");
    if (recurrence.frequency === "monthly" && recurrence.dayOfMonth && (recurrence.dayOfMonth < 1 || recurrence.dayOfMonth > 31)) throw new Error("SCHEDULE_DAY_OF_MONTH_INVALID: dayOfMonth usa 1-31.");
    return {
      id: `${scheduleId}:rule`,
      scheduleId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      frequency: recurrence.frequency,
      startAtLocal: recurrence.startAt,
      startAtUtc: start.utc,
      timezone: input.timezone,
      interval,
      endAtLocal: recurrence.endAt,
      endAtUtc,
      count: recurrence.count,
      daysOfWeek: recurrence.daysOfWeek,
      dayOfMonth: recurrence.dayOfMonth,
      windowDays: Math.max(1, Math.min(recurrence.windowDays ?? 30, 90)),
      createdAt: now,
      updatedAt: now,
    };
  }

  private async assertPublicationReferences(input: CreateScheduleInput): Promise<void> {
    const detail = await this.deps.publicationRepository.getDetail(input.publicationPlanId);
    if (!detail || detail.plan.tenantId !== input.tenantId || detail.plan.workspaceId !== input.workspaceId) throw new Error("SCHEDULE_PUBLICATION_NOT_FOUND: PublicationPlan não encontrado.");
    if (!detail.candidates.some((candidate) => candidate.id === input.publicationCandidateId)) throw new Error("SCHEDULE_CANDIDATE_NOT_FOUND: PublicationCandidate não encontrado.");
    const target = detail.targets.find((item) => item.id === input.targetId);
    if (!target) throw new Error("SCHEDULE_TARGET_NOT_FOUND: PublicationTarget não encontrado.");
    if (target.provider !== input.providerId) throw new Error("SCHEDULE_PROVIDER_TARGET_MISMATCH: provider do target diverge do schedule.");
  }

  private async audit(eventType: string, input: { tenantId: string; workspaceId: string; actor: AuditActor; requestId?: string }, metadata: Record<string, unknown>): Promise<void> {
    await this.deps.auditRepository.record({
      id: this.deps.idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      eventType,
      actor: input.actor,
      resource: { type: "schedule", id: String(metadata.scheduleId ?? metadata.occurrenceId ?? "scheduling") },
      context: { requestId: input.requestId },
      result: { status: "success" },
      metadata,
    });
  }

  private async event(input: Omit<Parameters<SchedulingRepositoryPort["appendEvent"]>[0], "id">): Promise<void> {
    await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), ...input });
  }
}
