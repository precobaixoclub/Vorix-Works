import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { SchedulingRepositoryPort } from "../ports/scheduling-repository.port.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { AuditActor } from "../../domain/credential/credential.model.js";
import type { ScheduleOccurrence } from "../../domain/scheduling/scheduling.model.js";
import type { ScheduledPublicationDispatcherPort } from "./scheduled-publication-dispatcher.port.js";

export type TemporalDispatcherDeps = {
  repository: SchedulingRepositoryPort;
  dispatcher: ScheduledPublicationDispatcherPort;
  auditRepository: OperationalAuditRepositoryPort;
  clock: ClockPort;
  idGenerator: () => string;
  leaseMs: number;
  maxBatch: number;
  missedGraceMs: number;
};

export class TemporalQueue {
  constructor(private readonly repository: SchedulingRepositoryPort) {}

  claimDue(input: { tenantId?: string; workspaceId?: string; workerId: string; now: string; leaseMs: number; limit: number }): Promise<ScheduleOccurrence[]> {
    return this.repository.claimDueOccurrences(input);
  }
}

export class TemporalDispatcher {
  constructor(private readonly deps: TemporalDispatcherDeps) {}

  async dispatchDue(input: { tenantId?: string; workspaceId?: string; workerId: string; actor: AuditActor; requestId?: string }): Promise<{ claimed: number; dispatched: number; failed: number; deadLettered: number; fencingRejected: number }> {
    const now = this.deps.clock.nowIso();
    const olderThanUtc = new Date(this.deps.clock.now().getTime() - this.deps.missedGraceMs).toISOString();
    await this.deps.repository.markMissed({ tenantId: input.tenantId, workspaceId: input.workspaceId, now, olderThanUtc, policy: "manual_review" });
    const occurrences = await this.deps.repository.claimDueOccurrences({ tenantId: input.tenantId, workspaceId: input.workspaceId, workerId: input.workerId, now, leaseMs: this.deps.leaseMs, limit: this.deps.maxBatch });
    let dispatched = 0;
    let failed = 0;
    let deadLettered = 0;
    let fencingRejected = 0;
    for (const occurrence of occurrences) {
      await this.event(occurrence, "schedule.occurrence_claimed", input.actor.userId, { workerId: input.workerId, fencingToken: occurrence.fencingToken });
      const result = await this.deps.dispatcher.dispatch({ occurrence, actor: input.actor, requestId: input.requestId });
      const commitNow = this.deps.clock.nowIso();
      if (result.dispatched) {
        const committed = await this.deps.repository.completeOccurrence({ occurrenceId: occurrence.id, workerId: input.workerId, fencingToken: occurrence.fencingToken, now: commitNow, executionReference: result.executionReference });
        if (!committed) {
          fencingRejected += 1;
          await this.event(occurrence, "schedule.fencing_rejected", input.actor.userId, { workerId: input.workerId, fencingToken: occurrence.fencingToken });
          continue;
        }
        dispatched += 1;
        await this.event(occurrence, "schedule.occurrence_dispatched", input.actor.userId, { ...result.executionReference });
        continue;
      }
      const schedule = await this.deps.repository.getSchedule(occurrence.scheduleId);
      const shouldDeadLetter = result.deadLetter === true || occurrence.attemptCount >= (schedule?.maxAttempts ?? 3);
      const failedCommit = await this.deps.repository.failOccurrence({
        occurrenceId: occurrence.id,
        workerId: input.workerId,
        fencingToken: occurrence.fencingToken,
        now: commitNow,
        failureCode: result.code,
        lastError: result.safeMessage,
        retryAtUtc: shouldDeadLetter ? undefined : result.retryAtUtc,
        deadLetter: shouldDeadLetter,
      });
      if (!failedCommit) {
        fencingRejected += 1;
        await this.event(occurrence, "schedule.fencing_rejected", input.actor.userId, { workerId: input.workerId, fencingToken: occurrence.fencingToken });
        continue;
      }
      if (shouldDeadLetter) {
        deadLettered += 1;
        const letter = await this.deps.repository.createDeadLetter({
          id: this.deps.idGenerator(),
          tenantId: occurrence.tenantId,
          workspaceId: occurrence.workspaceId,
          scheduleId: occurrence.scheduleId,
          occurrenceId: occurrence.id,
          failureCode: result.code,
          failureCategory: result.category,
          attemptCount: occurrence.attemptCount,
          lastError: result.safeMessage,
          nextAction: "manual_review",
        });
        await this.event(occurrence, "schedule.dead_letter_created", input.actor.userId, { deadLetterId: letter.id, failureCode: result.code });
        await this.deps.auditRepository.record({
          id: this.deps.idGenerator(),
          tenantId: occurrence.tenantId,
          workspaceId: occurrence.workspaceId,
          eventType: "schedule.dead_letter_created",
          actor: input.actor,
          resource: { type: "schedule_dead_letter", id: letter.id, providerId: occurrence.providerId },
          context: { requestId: input.requestId },
          result: { status: "failure", code: result.code, safeMessage: result.safeMessage },
          metadata: { scheduleId: occurrence.scheduleId, occurrenceId: occurrence.id },
        });
      } else {
        failed += 1;
        await this.event(occurrence, "schedule.occurrence_failed", input.actor.userId, { failureCode: result.code, retryAtUtc: result.retryAtUtc });
      }
    }
    return { claimed: occurrences.length, dispatched, failed, deadLettered, fencingRejected };
  }

  private async event(occurrence: ScheduleOccurrence, eventType: string, actorUserId: string | undefined, payload?: Record<string, unknown>): Promise<void> {
    await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, scheduleId: occurrence.scheduleId, occurrenceId: occurrence.id, eventType, actorUserId, payload });
  }
}
