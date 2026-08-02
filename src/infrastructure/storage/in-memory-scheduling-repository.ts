import type {
  ClaimDueOccurrencesInput,
  CreatePublicationScheduleInput,
  ListOccurrencesFilter,
  ListSchedulesFilter,
  SchedulingRepositoryPort,
} from "../../application/ports/scheduling-repository.port.js";
import type {
  CalendarEntry,
  PublicationSchedule,
  ScheduleConflict,
  ScheduleDeadLetter,
  ScheduleEvent,
  ScheduleOccurrence,
  SchedulingMetrics,
} from "../../domain/scheduling/scheduling.model.js";

export class InMemorySchedulingRepository implements SchedulingRepositoryPort {
  private readonly schedules = new Map<string, PublicationSchedule>();
  private readonly occurrences = new Map<string, ScheduleOccurrence>();
  private readonly conflicts = new Map<string, ScheduleConflict>();
  private readonly deadLetters = new Map<string, ScheduleDeadLetter>();
  private readonly events = new Map<string, ScheduleEvent>();

  async createSchedule(input: CreatePublicationScheduleInput): Promise<PublicationSchedule> {
    const now = new Date().toISOString();
    const schedule: PublicationSchedule = {
      ...input,
      recurrence: input.recurrence ? { ...input.recurrence, createdAt: now, updatedAt: now } : undefined,
      createdAt: now,
      updatedAt: now,
      version: 0,
    };
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  async getSchedule(id: string): Promise<PublicationSchedule | undefined> {
    return this.schedules.get(id);
  }

  async listSchedules(filter: ListSchedulesFilter): Promise<PublicationSchedule[]> {
    return [...this.schedules.values()]
      .filter((schedule) => schedule.tenantId === filter.tenantId && schedule.workspaceId === filter.workspaceId)
      .filter((schedule) => !filter.status || schedule.status === filter.status)
      .filter((schedule) => !filter.providerId || schedule.providerId === filter.providerId)
      .sort((a, b) => (a.scheduledAtUtc ?? a.createdAt).localeCompare(b.scheduledAtUtc ?? b.createdAt));
  }

  async updateSchedule(input: Parameters<SchedulingRepositoryPort["updateSchedule"]>[0]): Promise<PublicationSchedule> {
    const schedule = this.schedules.get(input.id);
    if (!schedule || schedule.tenantId !== input.tenantId || schedule.workspaceId !== input.workspaceId) throw new Error("SCHEDULE_NOT_FOUND: schedule não encontrado.");
    if (input.expectedVersion !== undefined && schedule.version !== input.expectedVersion) throw new Error("SCHEDULE_OPTIMISTIC_LOCK_CONFLICT: versão divergente.");
    const updated: PublicationSchedule = { ...schedule, ...input.patch, updatedAt: new Date().toISOString(), version: schedule.version + 1 };
    this.schedules.set(updated.id, updated);
    return updated;
  }

  async upsertOccurrences(inputs: readonly Omit<ScheduleOccurrence, "createdAt" | "updatedAt" | "fencingToken" | "attemptCount">[]): Promise<ScheduleOccurrence[]> {
    const now = new Date().toISOString();
    const output: ScheduleOccurrence[] = [];
    for (const input of inputs) {
      const existing = [...this.occurrences.values()].find((item) => item.idempotencyKey === input.idempotencyKey || (item.scheduleId === input.scheduleId && item.occurrenceKey === input.occurrenceKey));
      if (existing) {
        output.push(existing);
        continue;
      }
      const occurrence: ScheduleOccurrence = { ...input, fencingToken: 0, attemptCount: 0, createdAt: now, updatedAt: now };
      this.occurrences.set(occurrence.id, occurrence);
      output.push(occurrence);
    }
    return output;
  }

  async getOccurrence(id: string): Promise<ScheduleOccurrence | undefined> {
    return this.occurrences.get(id);
  }

  async listOccurrences(filter: ListOccurrencesFilter): Promise<ScheduleOccurrence[]> {
    return [...this.occurrences.values()]
      .filter((occurrence) => occurrence.tenantId === filter.tenantId && occurrence.workspaceId === filter.workspaceId)
      .filter((occurrence) => !filter.scheduleId || occurrence.scheduleId === filter.scheduleId)
      .filter((occurrence) => !filter.status || occurrence.status === filter.status)
      .filter((occurrence) => !filter.providerId || occurrence.providerId === filter.providerId)
      .filter((occurrence) => !filter.dueFromUtc || occurrence.dueAtUtc >= filter.dueFromUtc)
      .filter((occurrence) => !filter.dueToUtc || occurrence.dueAtUtc <= filter.dueToUtc)
      .sort((a, b) => a.dueAtUtc.localeCompare(b.dueAtUtc))
      .slice(0, filter.limit ?? Number.POSITIVE_INFINITY);
  }

  async claimDueOccurrences(input: ClaimDueOccurrencesInput): Promise<ScheduleOccurrence[]> {
    const claimed: ScheduleOccurrence[] = [];
    const claimableStatuses = input.includeMissed ? ["pending", "missed"] : ["pending"];
    for (const occurrence of [...this.occurrences.values()].sort((a, b) => a.dueAtUtc.localeCompare(b.dueAtUtc))) {
      if (claimed.length >= input.limit) break;
      if (input.tenantId && occurrence.tenantId !== input.tenantId) continue;
      if (input.workspaceId && occurrence.workspaceId !== input.workspaceId) continue;
      if (!claimableStatuses.includes(occurrence.status)) continue;
      if (occurrence.dueAtUtc > input.now) continue;
      const schedule = this.schedules.get(occurrence.scheduleId);
      if (!schedule || schedule.status === "paused" || schedule.status === "cancelled" || schedule.status === "failed") continue;
      const blocking = [...this.conflicts.values()].some((conflict) => !conflict.resolvedAt && conflict.severity === "blocking" && (conflict.occurrenceId === occurrence.id || conflict.scheduleId === occurrence.scheduleId));
      if (blocking) continue;
      const updated: ScheduleOccurrence = {
        ...occurrence,
        status: "claimed",
        claimedBy: input.workerId,
        claimedAt: input.now,
        leaseUntil: new Date(new Date(input.now).getTime() + input.leaseMs).toISOString(),
        fencingToken: occurrence.fencingToken + 1,
        attemptCount: occurrence.attemptCount + 1,
        updatedAt: input.now,
      };
      this.occurrences.set(updated.id, updated);
      claimed.push(updated);
    }
    return claimed;
  }

  async completeOccurrence(input: Parameters<SchedulingRepositoryPort["completeOccurrence"]>[0]): Promise<boolean> {
    const occurrence = this.occurrences.get(input.occurrenceId);
    if (!this.isCurrentClaim(occurrence, input.workerId, input.fencingToken, input.now)) return false;
    const updated: ScheduleOccurrence = {
      ...occurrence!,
      status: "dispatched",
      executionReference: input.executionReference,
      dispatchedAt: input.now,
      leaseUntil: undefined,
      claimedBy: undefined,
      claimedAt: undefined,
      updatedAt: input.now,
    };
    this.occurrences.set(updated.id, updated);
    return true;
  }

  async failOccurrence(input: Parameters<SchedulingRepositoryPort["failOccurrence"]>[0]): Promise<boolean> {
    const occurrence = this.occurrences.get(input.occurrenceId);
    if (!occurrence) return false;
    if (input.workerId && input.fencingToken !== undefined && !this.isCurrentClaim(occurrence, input.workerId, input.fencingToken, input.now)) return false;
    const updated: ScheduleOccurrence = {
      ...occurrence,
      status: input.deadLetter ? "dead_lettered" : input.retryAtUtc ? "pending" : "failed",
      dueAtUtc: input.retryAtUtc ?? occurrence.dueAtUtc,
      lastFailureCode: input.failureCode,
      lastError: input.lastError,
      leaseUntil: undefined,
      claimedBy: undefined,
      claimedAt: undefined,
      updatedAt: input.now,
    };
    this.occurrences.set(updated.id, updated);
    return true;
  }

  async markOccurrenceStatus(input: Parameters<SchedulingRepositoryPort["markOccurrenceStatus"]>[0]): Promise<ScheduleOccurrence | undefined> {
    const occurrence = this.occurrences.get(input.occurrenceId);
    if (!occurrence || occurrence.tenantId !== input.tenantId || occurrence.workspaceId !== input.workspaceId) return undefined;
    const terminal = ["dispatched", "completed", "dead_lettered"].includes(occurrence.status);
    if (terminal && input.status !== occurrence.status) throw new Error("SCHEDULE_OCCURRENCE_TERMINAL: ocorrência terminal não pode ser alterada.");
    const updated: ScheduleOccurrence = {
      ...occurrence,
      status: input.status,
      cancelledAt: input.status === "cancelled" ? input.now : occurrence.cancelledAt,
      missedAt: input.status === "missed" ? input.now : occurrence.missedAt,
      updatedAt: input.now,
    };
    this.occurrences.set(updated.id, updated);
    return updated;
  }

  async rescheduleOccurrence(input: Parameters<SchedulingRepositoryPort["rescheduleOccurrence"]>[0]): Promise<ScheduleOccurrence> {
    const occurrence = this.occurrences.get(input.occurrenceId);
    if (!occurrence || occurrence.tenantId !== input.tenantId || occurrence.workspaceId !== input.workspaceId) throw new Error("SCHEDULE_OCCURRENCE_NOT_FOUND: ocorrência não encontrada.");
    if (occurrence.status !== "pending" && occurrence.status !== "missed") throw new Error("SCHEDULE_OCCURRENCE_ALREADY_CLAIMED: somente ocorrências pendentes ou em revisão podem ser reagendadas.");
    const updated: ScheduleOccurrence = { ...occurrence, dueAtUtc: input.dueAtUtc, localDateTime: input.localDateTime, timezone: input.timezone, status: "pending", updatedAt: input.now };
    this.occurrences.set(updated.id, updated);
    return updated;
  }

  async releaseExpiredLeases(now: string): Promise<number> {
    let released = 0;
    for (const occurrence of this.occurrences.values()) {
      if (occurrence.status === "claimed" && (occurrence.leaseUntil ?? "") <= now) {
        this.occurrences.set(occurrence.id, { ...occurrence, status: "pending", claimedBy: undefined, claimedAt: undefined, leaseUntil: undefined, updatedAt: now });
        released += 1;
      }
    }
    return released;
  }

  async markMissed(input: Parameters<SchedulingRepositoryPort["markMissed"]>[0]): Promise<number> {
    let marked = 0;
    for (const occurrence of this.occurrences.values()) {
      if (input.tenantId && occurrence.tenantId !== input.tenantId) continue;
      if (input.workspaceId && occurrence.workspaceId !== input.workspaceId) continue;
      if (occurrence.status !== "pending" || occurrence.dueAtUtc > input.olderThanUtc) continue;
      this.occurrences.set(occurrence.id, { ...occurrence, status: input.policy === "skip" ? "cancelled" : "missed", missedAt: input.now, updatedAt: input.now });
      marked += 1;
    }
    return marked;
  }

  async createConflicts(inputs: readonly Omit<ScheduleConflict, "createdAt">[]): Promise<ScheduleConflict[]> {
    const now = new Date().toISOString();
    const created = inputs.map((input) => ({ ...input, createdAt: now }));
    for (const conflict of created) this.conflicts.set(conflict.id, conflict);
    return created;
  }

  async listConflicts(filter: Parameters<SchedulingRepositoryPort["listConflicts"]>[0]): Promise<ScheduleConflict[]> {
    return [...this.conflicts.values()]
      .filter((conflict) => conflict.tenantId === filter.tenantId && conflict.workspaceId === filter.workspaceId)
      .filter((conflict) => !filter.scheduleId || conflict.scheduleId === filter.scheduleId)
      .filter((conflict) => !filter.occurrenceId || conflict.occurrenceId === filter.occurrenceId)
      .filter((conflict) => !filter.severity || conflict.severity === filter.severity)
      .filter((conflict) => !filter.unresolvedOnly || !conflict.resolvedAt);
  }

  async resolveConflicts(input: Parameters<SchedulingRepositoryPort["resolveConflicts"]>[0]): Promise<number> {
    let resolved = 0;
    for (const conflict of this.conflicts.values()) {
      if (conflict.tenantId !== input.tenantId || conflict.workspaceId !== input.workspaceId) continue;
      if (input.scheduleId && conflict.scheduleId !== input.scheduleId) continue;
      if (input.occurrenceId && conflict.occurrenceId !== input.occurrenceId) continue;
      if (conflict.resolvedAt) continue;
      this.conflicts.set(conflict.id, { ...conflict, resolvedAt: input.now });
      resolved += 1;
    }
    return resolved;
  }

  async createDeadLetter(input: Omit<ScheduleDeadLetter, "createdAt">): Promise<ScheduleDeadLetter> {
    const letter = { ...input, createdAt: new Date().toISOString() };
    this.deadLetters.set(letter.id, letter);
    return letter;
  }

  async listDeadLetters(filter: Parameters<SchedulingRepositoryPort["listDeadLetters"]>[0]): Promise<ScheduleDeadLetter[]> {
    return [...this.deadLetters.values()]
      .filter((letter) => letter.tenantId === filter.tenantId && letter.workspaceId === filter.workspaceId)
      .filter((letter) => !filter.unresolvedOnly || !letter.reprocessedAt);
  }

  async reprocessDeadLetter(input: Parameters<SchedulingRepositoryPort["reprocessDeadLetter"]>[0]): Promise<ScheduleDeadLetter | undefined> {
    const letter = this.deadLetters.get(input.id);
    if (!letter || letter.tenantId !== input.tenantId || letter.workspaceId !== input.workspaceId) return undefined;
    const occurrence = this.occurrences.get(letter.occurrenceId);
    if (occurrence && occurrence.status === "dead_lettered") this.occurrences.set(occurrence.id, { ...occurrence, status: "pending", lastFailureCode: undefined, lastError: undefined, updatedAt: input.now });
    const updated = { ...letter, reprocessedAt: input.now, reprocessedByUserId: input.actorUserId };
    this.deadLetters.set(updated.id, updated);
    return updated;
  }

  async appendEvent(input: Omit<ScheduleEvent, "createdAt">): Promise<ScheduleEvent> {
    const event = { ...input, createdAt: new Date().toISOString() };
    this.events.set(event.id, event);
    return event;
  }

  async listEvents(filter: Parameters<SchedulingRepositoryPort["listEvents"]>[0]): Promise<ScheduleEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.tenantId === filter.tenantId && event.workspaceId === filter.workspaceId)
      .filter((event) => !filter.scheduleId || event.scheduleId === filter.scheduleId)
      .filter((event) => !filter.occurrenceId || event.occurrenceId === filter.occurrenceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit ?? 200);
  }

  async calendar(input: Parameters<SchedulingRepositoryPort["calendar"]>[0]): Promise<CalendarEntry[]> {
    const occurrences = await this.listOccurrences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: input.providerId, status: input.status, dueFromUtc: input.fromUtc, dueToUtc: input.toUtc, limit: 1000 });
    return occurrences.flatMap((occurrence) => {
      const schedule = this.schedules.get(occurrence.scheduleId);
      if (!schedule) return [];
      const conflicts = [...this.conflicts.values()].filter((conflict) => !conflict.resolvedAt && (conflict.occurrenceId === occurrence.id || conflict.scheduleId === schedule.id));
      return [{ occurrence, schedule, conflicts }];
    });
  }

  async metrics(filter: { tenantId: string; workspaceId: string }): Promise<SchedulingMetrics> {
    const schedules = [...this.schedules.values()].filter((schedule) => schedule.tenantId === filter.tenantId && schedule.workspaceId === filter.workspaceId);
    const occurrences = [...this.occurrences.values()].filter((occurrence) => occurrence.tenantId === filter.tenantId && occurrence.workspaceId === filter.workspaceId);
    const conflicts = [...this.conflicts.values()].filter((conflict) => conflict.tenantId === filter.tenantId && conflict.workspaceId === filter.workspaceId);
    const deadLetters = [...this.deadLetters.values()].filter((letter) => letter.tenantId === filter.tenantId && letter.workspaceId === filter.workspaceId);
    const events = [...this.events.values()].filter((event) => event.tenantId === filter.tenantId && event.workspaceId === filter.workspaceId);
    return {
      schedulesCreatedTotal: schedules.length,
      schedulesActiveTotal: schedules.filter((schedule) => schedule.status === "scheduled" || schedule.status === "due" || schedule.status === "dispatching").length,
      scheduleOccurrencesDueTotal: occurrences.filter((occurrence) => occurrence.status === "pending").length,
      scheduleOccurrencesDispatchedTotal: occurrences.filter((occurrence) => occurrence.status === "dispatched" || occurrence.status === "completed").length,
      scheduleOccurrencesMissedTotal: occurrences.filter((occurrence) => occurrence.status === "missed").length,
      scheduleOccurrencesFailedTotal: occurrences.filter((occurrence) => occurrence.status === "failed" || occurrence.status === "dead_lettered").length,
      scheduleConflictsTotal: conflicts.length,
      scheduleDeadLettersTotal: deadLetters.length,
      schedulePolicyDenialsTotal: events.filter((event) => event.eventType === "schedule.policy_denied").length,
      scheduleCredentialFailuresTotal: events.filter((event) => event.eventType === "schedule.credential_invalid").length,
    };
  }

  private isCurrentClaim(occurrence: ScheduleOccurrence | undefined, workerId: string, fencingToken: number, now: string): boolean {
    return !!occurrence && occurrence.status === "claimed" && occurrence.claimedBy === workerId && occurrence.fencingToken === fencingToken && !!occurrence.leaseUntil && occurrence.leaseUntil > now;
  }
}
