import type { PublicationProvider } from "../publication/publication.model.js";

export const SCHEDULE_STATUSES = ["draft", "scheduled", "paused", "due", "dispatching", "completed", "cancelled", "expired", "failed"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_OCCURRENCE_STATUSES = ["pending", "claimed", "dispatched", "completed", "cancelled", "missed", "failed", "dead_lettered"] as const;
export type ScheduleOccurrenceStatus = (typeof SCHEDULE_OCCURRENCE_STATUSES)[number];

export const SCHEDULE_FREQUENCIES = ["once", "daily", "weekly", "monthly", "custom_interval"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const MISSED_OCCURRENCE_POLICIES = ["skip", "dispatch_immediately", "reschedule_next_window", "manual_review"] as const;
export type MissedOccurrencePolicy = (typeof MISSED_OCCURRENCE_POLICIES)[number];

export const SCHEDULE_CONFLICT_SEVERITIES = ["info", "warning", "blocking"] as const;
export type ScheduleConflictSeverity = (typeof SCHEDULE_CONFLICT_SEVERITIES)[number];

export const SCHEDULE_DEAD_LETTER_CATEGORIES = ["policy", "credential", "provider", "dispatch", "timeout", "internal"] as const;
export type ScheduleDeadLetterCategory = (typeof SCHEDULE_DEAD_LETTER_CATEGORIES)[number];

export type ScheduleTimezone = {
  value: string;
};

export type ScheduleWindow = {
  startsAtUtc: string;
  endsAtUtc: string;
};

export type ScheduleRule = {
  id: string;
  scheduleId: string;
  tenantId: string;
  workspaceId: string;
  frequency: ScheduleFrequency;
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
  createdAt: string;
  updatedAt: string;
};

export type PublicationSchedule = {
  id: string;
  tenantId: string;
  workspaceId: string;
  publicationPlanId: string;
  publicationCandidateId: string;
  providerId: PublicationProvider;
  targetId: string;
  status: ScheduleStatus;
  timezone: string;
  scheduledAtUtc?: string;
  scheduledAtLocal?: string;
  recurrence?: ScheduleRule;
  governancePolicyReference?: string;
  credentialReferenceId?: string;
  campaignId?: string;
  contentChecksum?: string;
  missedPolicy: MissedOccurrencePolicy;
  allowDegradedProvider: boolean;
  maxAttempts: number;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
  pausedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
  version: number;
};

export type ScheduleExecutionReference = {
  publicationId: string;
  targetId: string;
  outboxMessageId?: string;
  attemptId?: string;
  dispatchedAt?: string;
};

export type ScheduleAuditReference = {
  auditEventId?: string;
  requestId?: string;
  actorUserId?: string;
};

export type ScheduleOccurrence = {
  id: string;
  scheduleId: string;
  occurrenceKey: string;
  occurrenceNumber: number;
  tenantId: string;
  workspaceId: string;
  publicationPlanId: string;
  publicationCandidateId: string;
  providerId: PublicationProvider;
  targetId: string;
  status: ScheduleOccurrenceStatus;
  dueAtUtc: string;
  localDateTime: string;
  timezone: string;
  idempotencyKey: string;
  credentialReferenceId?: string;
  governancePolicyReference?: string;
  campaignId?: string;
  contentChecksum?: string;
  claimedBy?: string;
  claimedAt?: string;
  leaseUntil?: string;
  fencingToken: number;
  attemptCount: number;
  lastFailureCode?: string;
  lastError?: string;
  executionReference?: ScheduleExecutionReference;
  auditReference?: ScheduleAuditReference;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  missedAt?: string;
};

export type TemporalQueueItem = ScheduleOccurrence;

export type TemporalClaim = {
  occurrenceId: string;
  workerId: string;
  claimedAt: string;
  leaseUntil: string;
  fencingToken: number;
};

export type TemporalLease = {
  leaseUntil: string;
  claimedBy: string;
};

export type TemporalFencingToken = {
  value: number;
};

export type ScheduleConflict = {
  id: string;
  tenantId: string;
  workspaceId: string;
  scheduleId: string;
  occurrenceId?: string;
  severity: ScheduleConflictSeverity;
  code: string;
  safeMessage: string;
  conflictingScheduleId?: string;
  conflictingOccurrenceId?: string;
  providerId?: PublicationProvider;
  targetId?: string;
  window?: ScheduleWindow;
  createdAt: string;
  resolvedAt?: string;
};

export type ScheduleDeadLetter = {
  id: string;
  tenantId: string;
  workspaceId: string;
  scheduleId: string;
  occurrenceId: string;
  failureCode: string;
  failureCategory: ScheduleDeadLetterCategory;
  attemptCount: number;
  lastError: string;
  nextAction: "manual_review" | "reprocess" | "ignore";
  createdAt: string;
  reprocessedAt?: string;
  reprocessedByUserId?: string;
};

export type ScheduleEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  scheduleId?: string;
  occurrenceId?: string;
  eventType: string;
  createdAt: string;
  actorUserId?: string;
  payload?: Record<string, unknown>;
};

export type SchedulingMetrics = {
  schedulesCreatedTotal: number;
  schedulesActiveTotal: number;
  scheduleOccurrencesDueTotal: number;
  scheduleOccurrencesDispatchedTotal: number;
  scheduleOccurrencesMissedTotal: number;
  scheduleOccurrencesFailedTotal: number;
  scheduleConflictsTotal: number;
  scheduleDeadLettersTotal: number;
  schedulePolicyDenialsTotal: number;
  scheduleCredentialFailuresTotal: number;
};

export type SchedulingHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  checks: readonly {
    id: string;
    status: "pass" | "warn" | "fail";
    safeMessage: string;
    evidence?: Record<string, unknown>;
  }[];
  metrics: SchedulingMetrics;
  lastDispatchAt?: string;
  lastRecoveryAt?: string;
};

export type CalendarEntry = {
  occurrence: ScheduleOccurrence;
  schedule: PublicationSchedule;
  conflicts: readonly ScheduleConflict[];
};
