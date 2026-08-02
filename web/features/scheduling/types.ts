import type { PublicationProviderDescriptor } from "@/features/publication/types";

export type ScheduleStatus = "draft" | "scheduled" | "paused" | "due" | "dispatching" | "completed" | "cancelled" | "expired" | "failed";
export type ScheduleOccurrenceStatus = "pending" | "claimed" | "dispatched" | "completed" | "cancelled" | "missed" | "failed" | "dead_lettered";
export type MissedOccurrencePolicy = "skip" | "dispatch_immediately" | "reschedule_next_window" | "manual_review";

export type ScheduleRule = {
  id: string;
  scheduleId: string;
  frequency: "once" | "daily" | "weekly" | "monthly" | "custom_interval";
  startAtLocal: string;
  startAtUtc: string;
  timezone: string;
  interval: number;
  endAtLocal?: string;
  endAtUtc?: string;
  count?: number;
  daysOfWeek?: readonly number[];
  dayOfMonth?: number;
  windowDays: number;
};

export type PublicationSchedule = {
  id: string;
  tenantId: string;
  workspaceId: string;
  publicationPlanId: string;
  publicationCandidateId: string;
  providerId: string;
  targetId: string;
  status: ScheduleStatus;
  timezone: string;
  scheduledAtUtc?: string;
  scheduledAtLocal?: string;
  recurrence?: ScheduleRule;
  credentialReferenceId?: string;
  governancePolicyReference?: string;
  campaignId?: string;
  contentChecksum?: string;
  missedPolicy: MissedOccurrencePolicy;
  allowDegradedProvider: boolean;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleOccurrence = {
  id: string;
  scheduleId: string;
  occurrenceNumber: number;
  providerId: string;
  targetId: string;
  status: ScheduleOccurrenceStatus;
  dueAtUtc: string;
  localDateTime: string;
  timezone: string;
  idempotencyKey: string;
  attemptCount: number;
  fencingToken: number;
  claimedBy?: string;
  leaseUntil?: string;
  lastFailureCode?: string;
  executionReference?: Record<string, unknown>;
};

export type ScheduleConflict = {
  id: string;
  scheduleId: string;
  occurrenceId?: string;
  severity: "info" | "warning" | "blocking";
  code: string;
  safeMessage: string;
  conflictingOccurrenceId?: string;
  providerId?: string;
  targetId?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type ScheduleDeadLetter = {
  id: string;
  scheduleId: string;
  occurrenceId: string;
  failureCode: string;
  failureCategory: string;
  attemptCount: number;
  lastError: string;
  nextAction: string;
  createdAt: string;
  reprocessedAt?: string;
};

export type CalendarEntry = {
  occurrence: ScheduleOccurrence;
  schedule: PublicationSchedule;
  conflicts: readonly ScheduleConflict[];
};

export type SchedulingHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  checks: readonly { id: string; status: "pass" | "warn" | "fail"; safeMessage: string; evidence?: Record<string, unknown> }[];
  metrics: Record<string, number>;
  lastDispatchAt?: string;
  lastRecoveryAt?: string;
};

export type CreateSchedulePayload = {
  workspaceId: string;
  publicationPlanId: string;
  publicationCandidateId: string;
  providerId: string;
  targetId: string;
  scheduledAt?: string;
  timezone: string;
  credentialReferenceId?: string;
  missedPolicy?: MissedOccurrencePolicy;
  maxAttempts?: number;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly" | "custom_interval";
    startAt: string;
    endAt?: string;
    count?: number;
    interval?: number;
    daysOfWeek?: readonly number[];
    dayOfMonth?: number;
    windowDays?: number;
  };
};

export type ScheduleCreateResult = { schedule: PublicationSchedule; occurrences: readonly ScheduleOccurrence[] };
export type ScheduleDetail = { schedule: PublicationSchedule; occurrences: readonly ScheduleOccurrence[]; conflicts: readonly ScheduleConflict[]; events: readonly { id: string; eventType: string; createdAt: string; payload?: Record<string, unknown> }[] };
export type ProviderList = readonly PublicationProviderDescriptor[];
