import type { ScheduleOccurrence, ScheduleRule, PublicationSchedule } from "../../domain/scheduling/scheduling.model.js";
import { addDays, addMonths, dayOfWeek, formatLocalDateTime, parseLocalDateTime, utcToZonedParts, zonedTimeToUtc } from "./timezone.js";

export type ScheduleOccurrenceGeneratorConfig = {
  windowDays: number;
  maxOccurrencesPerRun: number;
};

export class ScheduleOccurrenceGenerator {
  constructor(private readonly config: ScheduleOccurrenceGeneratorConfig) {}

  generate(input: {
    schedule: PublicationSchedule;
    fromUtc: string;
    toUtc?: string;
    idGenerator: () => string;
  }): Omit<ScheduleOccurrence, "createdAt" | "updatedAt" | "fencingToken" | "attemptCount">[] {
    const windowEnd = input.toUtc ?? new Date(new Date(input.fromUtc).getTime() + this.config.windowDays * 24 * 60 * 60 * 1000).toISOString();
    if (input.schedule.status !== "scheduled" && input.schedule.status !== "due") return [];
    const rule = input.schedule.recurrence;
    if (!rule || rule.frequency === "once") {
      const dueAtUtc = input.schedule.scheduledAtUtc ?? rule?.startAtUtc;
      const localDateTime = input.schedule.scheduledAtLocal ?? rule?.startAtLocal;
      if (!dueAtUtc || !localDateTime || dueAtUtc > windowEnd) return [];
      return [this.buildOccurrence(input.schedule, "once", 1, dueAtUtc, localDateTime, input.idGenerator)];
    }
    return this.generateRecurring(input.schedule, rule, input.fromUtc, windowEnd, input.idGenerator);
  }

  private generateRecurring(
    schedule: PublicationSchedule,
    rule: ScheduleRule,
    fromUtc: string,
    toUtc: string,
    idGenerator: () => string,
  ): Omit<ScheduleOccurrence, "createdAt" | "updatedAt" | "fencingToken" | "attemptCount">[] {
    const results: Omit<ScheduleOccurrence, "createdAt" | "updatedAt" | "fencingToken" | "attemptCount">[] = [];
    const startParts = parseLocalDateTime(rule.startAtLocal);
    const countLimit = rule.count ?? this.config.maxOccurrencesPerRun;
    const endAtUtc = rule.endAtUtc ?? toUtc;
    let generated = 0;
    let cursor = startParts;
    const maxLoops = Math.max(this.config.maxOccurrencesPerRun * 20, 400);

    for (let loop = 0; loop < maxLoops && results.length < this.config.maxOccurrencesPerRun && generated < countLimit; loop += 1) {
      const candidates = this.candidatesForCursor(rule, cursor, startParts);
      for (const localParts of candidates) {
        const localDateTime = formatLocalDateTime(localParts);
        const dueAtUtc = zonedTimeToUtc(localDateTime, rule.timezone);
        if (dueAtUtc < rule.startAtUtc) continue;
        if (dueAtUtc > endAtUtc || dueAtUtc > toUtc) return results;
        generated += 1;
        if (generated > countLimit) return results;
        if (dueAtUtc >= fromUtc) {
          results.push(this.buildOccurrence(schedule, localDateTime, generated, dueAtUtc, localDateTime, idGenerator));
          if (results.length >= this.config.maxOccurrencesPerRun) return results;
        }
      }
      cursor = nextCursor(rule, cursor);
    }
    return results;
  }

  private candidatesForCursor(rule: ScheduleRule, cursor: ReturnType<typeof parseLocalDateTime>, start: ReturnType<typeof parseLocalDateTime>) {
    if (rule.frequency === "weekly" && rule.daysOfWeek?.length) {
      const startOfWeek = addDays(cursor, -dayOfWeek(cursor));
      return [...rule.daysOfWeek].sort((a, b) => a - b).map((day) => ({ ...addDays(startOfWeek, day), hour: start.hour, minute: start.minute, second: start.second, millisecond: start.millisecond }));
    }
    if (rule.frequency === "monthly" && rule.dayOfMonth) {
      return [addMonths({ ...cursor, day: 1 }, 0, rule.dayOfMonth)];
    }
    return [cursor];
  }

  private buildOccurrence(
    schedule: PublicationSchedule,
    occurrenceKey: string,
    occurrenceNumber: number,
    dueAtUtc: string,
    localDateTime: string,
    idGenerator: () => string,
  ): Omit<ScheduleOccurrence, "createdAt" | "updatedAt" | "fencingToken" | "attemptCount"> {
    const stableKey = occurrenceKey.replace(/[^0-9A-Za-z]/g, "");
    const id = `${schedule.id}:occurrence:${occurrenceNumber}:${stableKey}`;
    const idempotencyKey = `${schedule.id}:${id}:${schedule.publicationCandidateId}:${schedule.providerId}:${schedule.targetId}`;
    return {
      id,
      scheduleId: schedule.id,
      occurrenceKey,
      occurrenceNumber,
      tenantId: schedule.tenantId,
      workspaceId: schedule.workspaceId,
      publicationPlanId: schedule.publicationPlanId,
      publicationCandidateId: schedule.publicationCandidateId,
      providerId: schedule.providerId,
      targetId: schedule.targetId,
      status: "pending",
      dueAtUtc,
      localDateTime,
      timezone: schedule.timezone,
      idempotencyKey,
      credentialReferenceId: schedule.credentialReferenceId,
      governancePolicyReference: schedule.governancePolicyReference,
      campaignId: schedule.campaignId,
      contentChecksum: schedule.contentChecksum,
    };
  }
}

export function normalizeScheduleLocalInput(input: { scheduledAt?: string; startAt?: string; timezone: string }): { localDateTime: string; utc: string } {
  const localDateTime = input.scheduledAt ?? input.startAt;
  if (!localDateTime) throw new Error("SCHEDULE_DATETIME_REQUIRED: informe scheduledAt ou startAt.");
  return { localDateTime, utc: zonedTimeToUtc(localDateTime, input.timezone) };
}

export function nextLocalForMissed(input: { occurrence: ScheduleOccurrence; policyWindowMinutes: number }): { localDateTime: string; dueAtUtc: string } {
  const current = utcToZonedParts(input.occurrence.dueAtUtc, input.occurrence.timezone);
  const next = addDays(current, 1);
  const localDateTime = formatLocalDateTime({ ...next, hour: current.hour, minute: current.minute, second: current.second, millisecond: current.millisecond });
  return { localDateTime, dueAtUtc: zonedTimeToUtc(localDateTime, input.occurrence.timezone) };
}

function nextCursor(rule: ScheduleRule, cursor: ReturnType<typeof parseLocalDateTime>): ReturnType<typeof parseLocalDateTime> {
  const interval = Math.max(1, rule.interval);
  if (rule.frequency === "daily" || rule.frequency === "custom_interval") return addDays(cursor, interval);
  if (rule.frequency === "weekly") return addDays(cursor, 7 * interval);
  if (rule.frequency === "monthly") return addMonths(cursor, interval);
  return cursor;
}
