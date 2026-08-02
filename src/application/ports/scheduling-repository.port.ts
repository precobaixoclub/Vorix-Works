import type {
  CalendarEntry,
  PublicationSchedule,
  ScheduleConflict,
  ScheduleDeadLetter,
  ScheduleEvent,
  ScheduleOccurrence,
  ScheduleOccurrenceStatus,
  ScheduleRule,
  ScheduleStatus,
  SchedulingMetrics,
} from "../../domain/scheduling/scheduling.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";

export type CreatePublicationScheduleInput = Omit<PublicationSchedule, "createdAt" | "updatedAt" | "version" | "recurrence"> & {
  recurrence?: Omit<ScheduleRule, "createdAt" | "updatedAt">;
};

export type ListSchedulesFilter = {
  tenantId: string;
  workspaceId: string;
  status?: ScheduleStatus;
  providerId?: PublicationProvider;
};

export type ListOccurrencesFilter = {
  tenantId: string;
  workspaceId: string;
  scheduleId?: string;
  status?: ScheduleOccurrenceStatus;
  providerId?: PublicationProvider;
  dueFromUtc?: string;
  dueToUtc?: string;
  limit?: number;
};

export type ClaimDueOccurrencesInput = {
  tenantId?: string;
  workspaceId?: string;
  workerId: string;
  now: string;
  leaseMs: number;
  limit: number;
  includeMissed?: boolean;
};

export type SchedulingRepositoryPort = {
  createSchedule(input: CreatePublicationScheduleInput): Promise<PublicationSchedule>;
  getSchedule(id: string): Promise<PublicationSchedule | undefined>;
  listSchedules(filter: ListSchedulesFilter): Promise<PublicationSchedule[]>;
  updateSchedule(input: { id: string; tenantId: string; workspaceId: string; patch: Partial<Pick<PublicationSchedule, "status" | "timezone" | "scheduledAtUtc" | "scheduledAtLocal" | "credentialReferenceId" | "governancePolicyReference" | "missedPolicy" | "allowDegradedProvider" | "maxAttempts" | "pausedAt" | "cancelledAt" | "completedAt">>; expectedVersion?: number }): Promise<PublicationSchedule>;

  upsertOccurrences(inputs: readonly Omit<ScheduleOccurrence, "createdAt" | "updatedAt" | "fencingToken" | "attemptCount">[]): Promise<ScheduleOccurrence[]>;
  getOccurrence(id: string): Promise<ScheduleOccurrence | undefined>;
  listOccurrences(filter: ListOccurrencesFilter): Promise<ScheduleOccurrence[]>;
  claimDueOccurrences(input: ClaimDueOccurrencesInput): Promise<ScheduleOccurrence[]>;
  completeOccurrence(input: { occurrenceId: string; workerId: string; fencingToken: number; now: string; executionReference?: ScheduleOccurrence["executionReference"] }): Promise<boolean>;
  failOccurrence(input: { occurrenceId: string; workerId?: string; fencingToken?: number; now: string; failureCode: string; lastError: string; retryAtUtc?: string; deadLetter?: boolean }): Promise<boolean>;
  markOccurrenceStatus(input: { occurrenceId: string; tenantId: string; workspaceId: string; status: ScheduleOccurrenceStatus; now: string; reason?: string }): Promise<ScheduleOccurrence | undefined>;
  rescheduleOccurrence(input: { occurrenceId: string; tenantId: string; workspaceId: string; dueAtUtc: string; localDateTime: string; timezone: string; now: string }): Promise<ScheduleOccurrence>;
  releaseExpiredLeases(now: string): Promise<number>;
  markMissed(input: { tenantId?: string; workspaceId?: string; now: string; olderThanUtc: string; policy: "manual_review" | "skip" }): Promise<number>;

  createConflicts(inputs: readonly Omit<ScheduleConflict, "createdAt">[]): Promise<ScheduleConflict[]>;
  listConflicts(filter: { tenantId: string; workspaceId: string; scheduleId?: string; occurrenceId?: string; severity?: ScheduleConflict["severity"]; unresolvedOnly?: boolean }): Promise<ScheduleConflict[]>;
  resolveConflicts(input: { tenantId: string; workspaceId: string; scheduleId?: string; occurrenceId?: string; now: string }): Promise<number>;

  createDeadLetter(input: Omit<ScheduleDeadLetter, "createdAt">): Promise<ScheduleDeadLetter>;
  listDeadLetters(filter: { tenantId: string; workspaceId: string; unresolvedOnly?: boolean }): Promise<ScheduleDeadLetter[]>;
  reprocessDeadLetter(input: { id: string; tenantId: string; workspaceId: string; actorUserId: string; now: string }): Promise<ScheduleDeadLetter | undefined>;

  appendEvent(input: Omit<ScheduleEvent, "createdAt">): Promise<ScheduleEvent>;
  listEvents(filter: { tenantId: string; workspaceId: string; scheduleId?: string; occurrenceId?: string; limit?: number }): Promise<ScheduleEvent[]>;
  calendar(input: { tenantId: string; workspaceId: string; fromUtc: string; toUtc: string; providerId?: PublicationProvider; status?: ScheduleOccurrenceStatus }): Promise<CalendarEntry[]>;
  metrics(filter: { tenantId: string; workspaceId: string }): Promise<SchedulingMetrics>;
};
