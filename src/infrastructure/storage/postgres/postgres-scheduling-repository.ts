import type { Pool } from "pg";
import type {
  ClaimDueOccurrencesInput,
  CreatePublicationScheduleInput,
  ListOccurrencesFilter,
  ListSchedulesFilter,
  SchedulingRepositoryPort,
} from "../../../application/ports/scheduling-repository.port.js";
import type {
  CalendarEntry,
  PublicationSchedule,
  ScheduleConflict,
  ScheduleDeadLetter,
  ScheduleEvent,
  ScheduleOccurrence,
  ScheduleRule,
  SchedulingMetrics,
} from "../../../domain/scheduling/scheduling.model.js";

type ScheduleRow = {
  id: string; tenant_id: string; workspace_id: string; publication_plan_id: string; publication_candidate_id: string; provider_id: string; target_id: string;
  status: string; timezone: string; scheduled_at_utc: Date | null; scheduled_at_local: string | null; governance_policy_reference: string | null;
  credential_reference_id: string | null; campaign_id: string | null; content_checksum: string | null; missed_policy: string; allow_degraded_provider: boolean;
  max_attempts: number; created_by_user_id: string | null; created_at: Date; updated_at: Date; paused_at: Date | null; cancelled_at: Date | null; completed_at: Date | null; version: number;
};
type RuleRow = {
  id: string; schedule_id: string; tenant_id: string; workspace_id: string; frequency: string; start_at_local: string; start_at_utc: Date; timezone: string;
  interval: number; end_at_local: string | null; end_at_utc: Date | null; count: number | null; days_of_week: number[] | null; day_of_month: number | null; window_days: number; created_at: Date; updated_at: Date;
};
type OccurrenceRow = {
  id: string; schedule_id: string; occurrence_key: string; occurrence_number: number; tenant_id: string; workspace_id: string; publication_plan_id: string; publication_candidate_id: string; provider_id: string; target_id: string;
  status: string; due_at_utc: Date; local_date_time: string; timezone: string; idempotency_key: string; credential_reference_id: string | null; governance_policy_reference: string | null; campaign_id: string | null; content_checksum: string | null;
  claimed_by: string | null; claimed_at: Date | null; lease_until: Date | null; fencing_token: number; attempt_count: number; last_failure_code: string | null; last_error: string | null; execution_reference: ScheduleOccurrence["executionReference"] | null; audit_reference: ScheduleOccurrence["auditReference"] | null;
  created_at: Date; updated_at: Date; dispatched_at: Date | null; completed_at: Date | null; cancelled_at: Date | null; missed_at: Date | null;
};
type ConflictRow = {
  id: string; tenant_id: string; workspace_id: string; schedule_id: string; occurrence_id: string | null; severity: string; code: string; safe_message: string; conflicting_schedule_id: string | null; conflicting_occurrence_id: string | null; provider_id: string | null; target_id: string | null; conflict_window: ScheduleConflict["window"] | null; created_at: Date; resolved_at: Date | null;
};
type DeadLetterRow = {
  id: string; tenant_id: string; workspace_id: string; schedule_id: string; occurrence_id: string; failure_code: string; failure_category: string; attempt_count: number; last_error: string; next_action: string; created_at: Date; reprocessed_at: Date | null; reprocessed_by_user_id: string | null;
};
type EventRow = { id: string; tenant_id: string; workspace_id: string; schedule_id: string | null; occurrence_id: string | null; event_type: string; actor_user_id: string | null; payload: Record<string, unknown> | null; created_at: Date };

export class PostgresSchedulingRepository implements SchedulingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createSchedule(input: CreatePublicationScheduleInput): Promise<PublicationSchedule> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const scheduleRow = await client.query<ScheduleRow>(
        `insert into scheduling_publication_schedules (id, tenant_id, workspace_id, publication_plan_id, publication_candidate_id, provider_id, target_id, status, timezone, scheduled_at_utc, scheduled_at_local, governance_policy_reference, credential_reference_id, campaign_id, content_checksum, missed_policy, allow_degraded_provider, max_attempts, created_by_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
        [input.id, input.tenantId, input.workspaceId, input.publicationPlanId, input.publicationCandidateId, input.providerId, input.targetId, input.status, input.timezone, input.scheduledAtUtc ?? null, input.scheduledAtLocal ?? null, input.governancePolicyReference ?? null, input.credentialReferenceId ?? null, input.campaignId ?? null, input.contentChecksum ?? null, input.missedPolicy, input.allowDegradedProvider, input.maxAttempts, input.createdByUserId ?? null],
      );
      if (input.recurrence) {
        await client.query(
          `insert into scheduling_schedule_rules (id, schedule_id, tenant_id, workspace_id, frequency, start_at_local, start_at_utc, timezone, interval, end_at_local, end_at_utc, count, days_of_week, day_of_month, window_days)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [input.recurrence.id, input.recurrence.scheduleId, input.recurrence.tenantId, input.recurrence.workspaceId, input.recurrence.frequency, input.recurrence.startAtLocal, input.recurrence.startAtUtc, input.recurrence.timezone, input.recurrence.interval, input.recurrence.endAtLocal ?? null, input.recurrence.endAtUtc ?? null, input.recurrence.count ?? null, input.recurrence.daysOfWeek ? [...input.recurrence.daysOfWeek] : null, input.recurrence.dayOfMonth ?? null, input.recurrence.windowDays],
        );
      }
      await client.query("commit");
      const schedule = toSchedule(scheduleRow.rows[0], input.recurrence ? { ...input.recurrence, createdAt: scheduleRow.rows[0].created_at.toISOString(), updatedAt: scheduleRow.rows[0].updated_at.toISOString() } : undefined);
      return schedule;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSchedule(id: string): Promise<PublicationSchedule | undefined> {
    const result = await this.pool.query<ScheduleRow>("select * from scheduling_publication_schedules where id = $1", [id]);
    if (!result.rows[0]) return undefined;
    const rule = await this.pool.query<RuleRow>("select * from scheduling_schedule_rules where schedule_id = $1", [id]);
    return toSchedule(result.rows[0], rule.rows[0] ? toRule(rule.rows[0]) : undefined);
  }

  async listSchedules(filter: ListSchedulesFilter): Promise<PublicationSchedule[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }
    if (filter.providerId) { params.push(filter.providerId); conditions.push(`provider_id = $${params.length}`); }
    const result = await this.pool.query<ScheduleRow>(`select * from scheduling_publication_schedules where ${conditions.join(" and ")} order by coalesce(scheduled_at_utc, created_at), id`, params);
    const rules = await this.pool.query<RuleRow>("select * from scheduling_schedule_rules where schedule_id = any($1::text[])", [result.rows.map((row) => row.id)]);
    return result.rows.map((row) => toSchedule(row, rules.rows.find((rule) => rule.schedule_id === row.id) ? toRule(rules.rows.find((rule) => rule.schedule_id === row.id)!) : undefined));
  }

  async updateSchedule(input: Parameters<SchedulingRepositoryPort["updateSchedule"]>[0]): Promise<PublicationSchedule> {
    const schedule = await this.getSchedule(input.id);
    if (!schedule || schedule.tenantId !== input.tenantId || schedule.workspaceId !== input.workspaceId) throw new Error("SCHEDULE_NOT_FOUND: schedule não encontrado.");
    if (input.expectedVersion !== undefined && schedule.version !== input.expectedVersion) throw new Error("SCHEDULE_OPTIMISTIC_LOCK_CONFLICT: versão divergente.");
    const patch = { ...schedule, ...input.patch };
    const result = await this.pool.query<ScheduleRow>(
      `update scheduling_publication_schedules set status=$4, timezone=$5, scheduled_at_utc=$6, scheduled_at_local=$7, governance_policy_reference=$8, credential_reference_id=$9, missed_policy=$10, allow_degraded_provider=$11, max_attempts=$12, paused_at=$13, cancelled_at=$14, completed_at=$15, updated_at=now(), version=version+1
       where id=$1 and tenant_id=$2 and workspace_id=$3 returning *`,
      [input.id, input.tenantId, input.workspaceId, patch.status, patch.timezone, patch.scheduledAtUtc ?? null, patch.scheduledAtLocal ?? null, patch.governancePolicyReference ?? null, patch.credentialReferenceId ?? null, patch.missedPolicy, patch.allowDegradedProvider, patch.maxAttempts, patch.pausedAt ?? null, patch.cancelledAt ?? null, patch.completedAt ?? null],
    );
    return toSchedule(result.rows[0], schedule.recurrence);
  }

  async upsertOccurrences(inputs: readonly Omit<ScheduleOccurrence, "createdAt" | "updatedAt" | "fencingToken" | "attemptCount">[]): Promise<ScheduleOccurrence[]> {
    const output: ScheduleOccurrence[] = [];
    for (const input of inputs) {
      const result = await this.pool.query<OccurrenceRow>(
        `insert into scheduling_schedule_occurrences (id, schedule_id, occurrence_key, occurrence_number, tenant_id, workspace_id, publication_plan_id, publication_candidate_id, provider_id, target_id, status, due_at_utc, local_date_time, timezone, idempotency_key, credential_reference_id, governance_policy_reference, campaign_id, content_checksum, execution_reference, audit_reference)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key returning *`,
        [input.id, input.scheduleId, input.occurrenceKey, input.occurrenceNumber, input.tenantId, input.workspaceId, input.publicationPlanId, input.publicationCandidateId, input.providerId, input.targetId, input.status, input.dueAtUtc, input.localDateTime, input.timezone, input.idempotencyKey, input.credentialReferenceId ?? null, input.governancePolicyReference ?? null, input.campaignId ?? null, input.contentChecksum ?? null, input.executionReference ? JSON.stringify(input.executionReference) : null, input.auditReference ? JSON.stringify(input.auditReference) : null],
      );
      output.push(toOccurrence(result.rows[0]));
    }
    return output;
  }

  async getOccurrence(id: string): Promise<ScheduleOccurrence | undefined> {
    const result = await this.pool.query<OccurrenceRow>("select * from scheduling_schedule_occurrences where id = $1", [id]);
    return result.rows[0] ? toOccurrence(result.rows[0]) : undefined;
  }

  async listOccurrences(filter: ListOccurrencesFilter): Promise<ScheduleOccurrence[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    if (filter.scheduleId) { params.push(filter.scheduleId); conditions.push(`schedule_id = $${params.length}`); }
    if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }
    if (filter.providerId) { params.push(filter.providerId); conditions.push(`provider_id = $${params.length}`); }
    if (filter.dueFromUtc) { params.push(filter.dueFromUtc); conditions.push(`due_at_utc >= $${params.length}`); }
    if (filter.dueToUtc) { params.push(filter.dueToUtc); conditions.push(`due_at_utc <= $${params.length}`); }
    params.push(filter.limit ?? 500);
    const result = await this.pool.query<OccurrenceRow>(`select * from scheduling_schedule_occurrences where ${conditions.join(" and ")} order by due_at_utc, id limit $${params.length}`, params);
    return result.rows.map(toOccurrence);
  }

  async claimDueOccurrences(input: ClaimDueOccurrencesInput): Promise<ScheduleOccurrence[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const params: unknown[] = [input.now, input.limit];
      const tenantClause = input.tenantId ? `and o.tenant_id = $${params.push(input.tenantId)}` : "";
      const workspaceClause = input.workspaceId ? `and o.workspace_id = $${params.push(input.workspaceId)}` : "";
      const statusClause = input.includeMissed ? "o.status in ('pending','missed')" : "o.status = 'pending'";
      const selected = await client.query<OccurrenceRow>(
        `select o.* from scheduling_schedule_occurrences o
         join scheduling_publication_schedules s on s.id = o.schedule_id
         where ${statusClause}
           and o.due_at_utc <= $1
           and s.status not in ('paused','cancelled','failed')
           ${tenantClause}
           ${workspaceClause}
           and not exists (
             select 1 from scheduling_schedule_conflicts c
             where c.resolved_at is null and c.severity = 'blocking' and (c.occurrence_id = o.id or c.schedule_id = o.schedule_id)
           )
         order by o.due_at_utc, o.id
         limit $2
         for update of o skip locked`,
        params,
      );
      const claimed: ScheduleOccurrence[] = [];
      for (const row of selected.rows) {
        const updated = await client.query<OccurrenceRow>(
          `update scheduling_schedule_occurrences
           set status='claimed', claimed_by=$2, claimed_at=$3, lease_until=($3::timestamptz + ($4::text || ' milliseconds')::interval), fencing_token=fencing_token+1, attempt_count=attempt_count+1, updated_at=$3
           where id=$1 returning *`,
          [row.id, input.workerId, input.now, input.leaseMs],
        );
        const occurrence = toOccurrence(updated.rows[0]);
        await client.query("insert into scheduling_schedule_claims (occurrence_id, tenant_id, workspace_id, worker_id, claimed_at, lease_until, fencing_token) values ($1,$2,$3,$4,$5,$6,$7)", [occurrence.id, occurrence.tenantId, occurrence.workspaceId, input.workerId, occurrence.claimedAt, occurrence.leaseUntil, occurrence.fencingToken]);
        claimed.push(occurrence);
      }
      await client.query("commit");
      return claimed;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeOccurrence(input: Parameters<SchedulingRepositoryPort["completeOccurrence"]>[0]): Promise<boolean> {
    const result = await this.pool.query<OccurrenceRow>(
      `update scheduling_schedule_occurrences
       set status='dispatched', execution_reference=$5, dispatched_at=$4, claimed_by=null, claimed_at=null, lease_until=null, updated_at=$4
       where id=$1 and claimed_by=$2 and fencing_token=$3 and lease_until > $4 and status='claimed' returning *`,
      [input.occurrenceId, input.workerId, input.fencingToken, input.now, input.executionReference ? JSON.stringify(input.executionReference) : null],
    );
    return !!result.rows[0];
  }

  async failOccurrence(input: Parameters<SchedulingRepositoryPort["failOccurrence"]>[0]): Promise<boolean> {
    const status = input.deadLetter ? "dead_lettered" : input.retryAtUtc ? "pending" : "failed";
    const params: unknown[] = [input.occurrenceId, status, input.retryAtUtc ?? null, input.failureCode, input.lastError, input.now];
    const claim = input.workerId && input.fencingToken !== undefined ? "and claimed_by=$7 and fencing_token=$8 and lease_until > $6" : "";
    if (claim) params.push(input.workerId, input.fencingToken);
    const result = await this.pool.query<OccurrenceRow>(
      `update scheduling_schedule_occurrences set status=$2, due_at_utc=coalesce($3, due_at_utc), last_failure_code=$4, last_error=$5, claimed_by=null, claimed_at=null, lease_until=null, updated_at=$6 where id=$1 ${claim} returning *`,
      params,
    );
    return !!result.rows[0];
  }

  async markOccurrenceStatus(input: Parameters<SchedulingRepositoryPort["markOccurrenceStatus"]>[0]): Promise<ScheduleOccurrence | undefined> {
    const result = await this.pool.query<OccurrenceRow>(
      `update scheduling_schedule_occurrences
       set status=$4, cancelled_at=case when $4='cancelled' then $5::timestamptz else cancelled_at end, missed_at=case when $4='missed' then $5::timestamptz else missed_at end, updated_at=$5
       where id=$1 and tenant_id=$2 and workspace_id=$3 and status not in ('dispatched','completed','dead_lettered') returning *`,
      [input.occurrenceId, input.tenantId, input.workspaceId, input.status, input.now],
    );
    return result.rows[0] ? toOccurrence(result.rows[0]) : undefined;
  }

  async rescheduleOccurrence(input: Parameters<SchedulingRepositoryPort["rescheduleOccurrence"]>[0]): Promise<ScheduleOccurrence> {
    const result = await this.pool.query<OccurrenceRow>(
      "update scheduling_schedule_occurrences set due_at_utc=$4, local_date_time=$5, timezone=$6, status='pending', updated_at=$7 where id=$1 and tenant_id=$2 and workspace_id=$3 and status in ('pending','missed') returning *",
      [input.occurrenceId, input.tenantId, input.workspaceId, input.dueAtUtc, input.localDateTime, input.timezone, input.now],
    );
    if (!result.rows[0]) throw new Error("SCHEDULE_OCCURRENCE_ALREADY_CLAIMED: somente ocorrências pendentes ou em revisão podem ser reagendadas.");
    return toOccurrence(result.rows[0]);
  }

  async releaseExpiredLeases(now: string): Promise<number> {
    const result = await this.pool.query("update scheduling_schedule_occurrences set status='pending', claimed_by=null, claimed_at=null, lease_until=null, updated_at=$1 where status='claimed' and lease_until <= $1", [now]);
    return result.rowCount ?? 0;
  }

  async markMissed(input: Parameters<SchedulingRepositoryPort["markMissed"]>[0]): Promise<number> {
    const params: unknown[] = [input.now, input.olderThanUtc, input.policy === "skip" ? "cancelled" : "missed"];
    const tenantClause = input.tenantId ? `and tenant_id = $${params.push(input.tenantId)}` : "";
    const workspaceClause = input.workspaceId ? `and workspace_id = $${params.push(input.workspaceId)}` : "";
    const result = await this.pool.query(`update scheduling_schedule_occurrences set status=$3, missed_at=$1, updated_at=$1 where status='pending' and due_at_utc <= $2 ${tenantClause} ${workspaceClause}`, params);
    return result.rowCount ?? 0;
  }

  async createConflicts(inputs: readonly Omit<ScheduleConflict, "createdAt">[]): Promise<ScheduleConflict[]> {
    const created: ScheduleConflict[] = [];
    for (const input of inputs) {
      const result = await this.pool.query<ConflictRow>(
        "insert into scheduling_schedule_conflicts (id, tenant_id, workspace_id, schedule_id, occurrence_id, severity, code, safe_message, conflicting_schedule_id, conflicting_occurrence_id, provider_id, target_id, conflict_window) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *",
        [input.id, input.tenantId, input.workspaceId, input.scheduleId, input.occurrenceId ?? null, input.severity, input.code, input.safeMessage, input.conflictingScheduleId ?? null, input.conflictingOccurrenceId ?? null, input.providerId ?? null, input.targetId ?? null, input.window ? JSON.stringify(input.window) : null],
      );
      created.push(toConflict(result.rows[0]));
    }
    return created;
  }

  async listConflicts(filter: Parameters<SchedulingRepositoryPort["listConflicts"]>[0]): Promise<ScheduleConflict[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = ["tenant_id=$1", "workspace_id=$2"];
    if (filter.scheduleId) { params.push(filter.scheduleId); conditions.push(`schedule_id=$${params.length}`); }
    if (filter.occurrenceId) { params.push(filter.occurrenceId); conditions.push(`occurrence_id=$${params.length}`); }
    if (filter.severity) { params.push(filter.severity); conditions.push(`severity=$${params.length}`); }
    if (filter.unresolvedOnly) conditions.push("resolved_at is null");
    const result = await this.pool.query<ConflictRow>(`select * from scheduling_schedule_conflicts where ${conditions.join(" and ")} order by created_at, id`, params);
    return result.rows.map(toConflict);
  }

  async resolveConflicts(input: Parameters<SchedulingRepositoryPort["resolveConflicts"]>[0]): Promise<number> {
    const result = await this.pool.query("update scheduling_schedule_conflicts set resolved_at=$3 where tenant_id=$1 and workspace_id=$2 and ($4::text is null or schedule_id=$4) and ($5::text is null or occurrence_id=$5) and resolved_at is null", [input.tenantId, input.workspaceId, input.now, input.scheduleId ?? null, input.occurrenceId ?? null]);
    return result.rowCount ?? 0;
  }

  async createDeadLetter(input: Omit<ScheduleDeadLetter, "createdAt">): Promise<ScheduleDeadLetter> {
    const result = await this.pool.query<DeadLetterRow>("insert into scheduling_schedule_dead_letters (id, tenant_id, workspace_id, schedule_id, occurrence_id, failure_code, failure_category, attempt_count, last_error, next_action, reprocessed_at, reprocessed_by_user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *", [input.id, input.tenantId, input.workspaceId, input.scheduleId, input.occurrenceId, input.failureCode, input.failureCategory, input.attemptCount, input.lastError, input.nextAction, input.reprocessedAt ?? null, input.reprocessedByUserId ?? null]);
    return toDeadLetter(result.rows[0]);
  }

  async listDeadLetters(filter: Parameters<SchedulingRepositoryPort["listDeadLetters"]>[0]): Promise<ScheduleDeadLetter[]> {
    const result = await this.pool.query<DeadLetterRow>("select * from scheduling_schedule_dead_letters where tenant_id=$1 and workspace_id=$2 and ($3::boolean = false or reprocessed_at is null) order by created_at desc", [filter.tenantId, filter.workspaceId, filter.unresolvedOnly ?? false]);
    return result.rows.map(toDeadLetter);
  }

  async reprocessDeadLetter(input: Parameters<SchedulingRepositoryPort["reprocessDeadLetter"]>[0]): Promise<ScheduleDeadLetter | undefined> {
    const result = await this.pool.query<DeadLetterRow>("update scheduling_schedule_dead_letters set reprocessed_at=$4, reprocessed_by_user_id=$5 where id=$1 and tenant_id=$2 and workspace_id=$3 returning *", [input.id, input.tenantId, input.workspaceId, input.now, input.actorUserId]);
    if (result.rows[0]) await this.pool.query("update scheduling_schedule_occurrences set status='pending', last_failure_code=null, last_error=null, updated_at=$2 where id=$1 and status='dead_lettered'", [result.rows[0].occurrence_id, input.now]);
    return result.rows[0] ? toDeadLetter(result.rows[0]) : undefined;
  }

  async appendEvent(input: Omit<ScheduleEvent, "createdAt">): Promise<ScheduleEvent> {
    const result = await this.pool.query<EventRow>("insert into scheduling_schedule_events (id, tenant_id, workspace_id, schedule_id, occurrence_id, event_type, actor_user_id, payload) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *", [input.id, input.tenantId, input.workspaceId, input.scheduleId ?? null, input.occurrenceId ?? null, input.eventType, input.actorUserId ?? null, input.payload ? JSON.stringify(input.payload) : null]);
    return toEvent(result.rows[0]);
  }

  async listEvents(filter: Parameters<SchedulingRepositoryPort["listEvents"]>[0]): Promise<ScheduleEvent[]> {
    const result = await this.pool.query<EventRow>("select * from scheduling_schedule_events where tenant_id=$1 and workspace_id=$2 and ($3::text is null or schedule_id=$3) and ($4::text is null or occurrence_id=$4) order by created_at desc limit $5", [filter.tenantId, filter.workspaceId, filter.scheduleId ?? null, filter.occurrenceId ?? null, filter.limit ?? 200]);
    return result.rows.map(toEvent);
  }

  async calendar(input: Parameters<SchedulingRepositoryPort["calendar"]>[0]): Promise<CalendarEntry[]> {
    const occurrences = await this.listOccurrences({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: input.providerId, status: input.status, dueFromUtc: input.fromUtc, dueToUtc: input.toUtc, limit: 1000 });
    const schedules = await this.listSchedules({ tenantId: input.tenantId, workspaceId: input.workspaceId });
    const conflicts = await this.listConflicts({ tenantId: input.tenantId, workspaceId: input.workspaceId, unresolvedOnly: true });
    return occurrences.flatMap((occurrence) => {
      const schedule = schedules.find((item) => item.id === occurrence.scheduleId);
      if (!schedule) return [];
      return [{ occurrence, schedule, conflicts: conflicts.filter((conflict) => conflict.scheduleId === schedule.id || conflict.occurrenceId === occurrence.id) }];
    });
  }

  async metrics(filter: { tenantId: string; workspaceId: string }): Promise<SchedulingMetrics> {
    const result = await this.pool.query<{ key: string; count: string }>(
      `select 'schedules' key, count(*) count from scheduling_publication_schedules where tenant_id=$1 and workspace_id=$2
       union all select 'active', count(*) from scheduling_publication_schedules where tenant_id=$1 and workspace_id=$2 and status in ('scheduled','due','dispatching')
       union all select 'due', count(*) from scheduling_schedule_occurrences where tenant_id=$1 and workspace_id=$2 and status='pending'
       union all select 'dispatched', count(*) from scheduling_schedule_occurrences where tenant_id=$1 and workspace_id=$2 and status in ('dispatched','completed')
       union all select 'missed', count(*) from scheduling_schedule_occurrences where tenant_id=$1 and workspace_id=$2 and status='missed'
       union all select 'failed', count(*) from scheduling_schedule_occurrences where tenant_id=$1 and workspace_id=$2 and status in ('failed','dead_lettered')
       union all select 'conflicts', count(*) from scheduling_schedule_conflicts where tenant_id=$1 and workspace_id=$2
       union all select 'dead_letters', count(*) from scheduling_schedule_dead_letters where tenant_id=$1 and workspace_id=$2
       union all select 'policy_denials', count(*) from scheduling_schedule_events where tenant_id=$1 and workspace_id=$2 and event_type='schedule.policy_denied'
       union all select 'credential_failures', count(*) from scheduling_schedule_events where tenant_id=$1 and workspace_id=$2 and event_type='schedule.credential_invalid'`,
      [filter.tenantId, filter.workspaceId],
    );
    const count = (key: string) => Number(result.rows.find((row) => row.key === key)?.count ?? 0);
    return {
      schedulesCreatedTotal: count("schedules"),
      schedulesActiveTotal: count("active"),
      scheduleOccurrencesDueTotal: count("due"),
      scheduleOccurrencesDispatchedTotal: count("dispatched"),
      scheduleOccurrencesMissedTotal: count("missed"),
      scheduleOccurrencesFailedTotal: count("failed"),
      scheduleConflictsTotal: count("conflicts"),
      scheduleDeadLettersTotal: count("dead_letters"),
      schedulePolicyDenialsTotal: count("policy_denials"),
      scheduleCredentialFailuresTotal: count("credential_failures"),
    };
  }
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}
function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
function toRule(row: RuleRow): ScheduleRule {
  return { id: row.id, scheduleId: row.schedule_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, frequency: row.frequency as never, startAtLocal: row.start_at_local, startAtUtc: requiredIso(row.start_at_utc), timezone: row.timezone, interval: row.interval, endAtLocal: row.end_at_local ?? undefined, endAtUtc: iso(row.end_at_utc), count: row.count ?? undefined, daysOfWeek: row.days_of_week ?? undefined, dayOfMonth: row.day_of_month ?? undefined, windowDays: row.window_days, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}
function toSchedule(row: ScheduleRow, recurrence?: ScheduleRule): PublicationSchedule {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, publicationPlanId: row.publication_plan_id, publicationCandidateId: row.publication_candidate_id, providerId: row.provider_id as never, targetId: row.target_id, status: row.status as never, timezone: row.timezone, scheduledAtUtc: iso(row.scheduled_at_utc), scheduledAtLocal: row.scheduled_at_local ?? undefined, recurrence, governancePolicyReference: row.governance_policy_reference ?? undefined, credentialReferenceId: row.credential_reference_id ?? undefined, campaignId: row.campaign_id ?? undefined, contentChecksum: row.content_checksum ?? undefined, missedPolicy: row.missed_policy as never, allowDegradedProvider: row.allow_degraded_provider, maxAttempts: row.max_attempts, createdByUserId: row.created_by_user_id ?? undefined, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at), pausedAt: iso(row.paused_at), cancelledAt: iso(row.cancelled_at), completedAt: iso(row.completed_at), version: row.version };
}
function toOccurrence(row: OccurrenceRow): ScheduleOccurrence {
  return { id: row.id, scheduleId: row.schedule_id, occurrenceKey: row.occurrence_key, occurrenceNumber: row.occurrence_number, tenantId: row.tenant_id, workspaceId: row.workspace_id, publicationPlanId: row.publication_plan_id, publicationCandidateId: row.publication_candidate_id, providerId: row.provider_id as never, targetId: row.target_id, status: row.status as never, dueAtUtc: requiredIso(row.due_at_utc), localDateTime: row.local_date_time, timezone: row.timezone, idempotencyKey: row.idempotency_key, credentialReferenceId: row.credential_reference_id ?? undefined, governancePolicyReference: row.governance_policy_reference ?? undefined, campaignId: row.campaign_id ?? undefined, contentChecksum: row.content_checksum ?? undefined, claimedBy: row.claimed_by ?? undefined, claimedAt: iso(row.claimed_at), leaseUntil: iso(row.lease_until), fencingToken: row.fencing_token, attemptCount: row.attempt_count, lastFailureCode: row.last_failure_code ?? undefined, lastError: row.last_error ?? undefined, executionReference: row.execution_reference ?? undefined, auditReference: row.audit_reference ?? undefined, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at), dispatchedAt: iso(row.dispatched_at), completedAt: iso(row.completed_at), cancelledAt: iso(row.cancelled_at), missedAt: iso(row.missed_at) };
}
function toConflict(row: ConflictRow): ScheduleConflict {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, scheduleId: row.schedule_id, occurrenceId: row.occurrence_id ?? undefined, severity: row.severity as never, code: row.code, safeMessage: row.safe_message, conflictingScheduleId: row.conflicting_schedule_id ?? undefined, conflictingOccurrenceId: row.conflicting_occurrence_id ?? undefined, providerId: row.provider_id as never ?? undefined, targetId: row.target_id ?? undefined, window: row.conflict_window ?? undefined, createdAt: requiredIso(row.created_at), resolvedAt: iso(row.resolved_at) };
}
function toDeadLetter(row: DeadLetterRow): ScheduleDeadLetter {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, scheduleId: row.schedule_id, occurrenceId: row.occurrence_id, failureCode: row.failure_code, failureCategory: row.failure_category as never, attemptCount: row.attempt_count, lastError: row.last_error, nextAction: row.next_action as never, createdAt: requiredIso(row.created_at), reprocessedAt: iso(row.reprocessed_at), reprocessedByUserId: row.reprocessed_by_user_id ?? undefined };
}
function toEvent(row: EventRow): ScheduleEvent {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, scheduleId: row.schedule_id ?? undefined, occurrenceId: row.occurrence_id ?? undefined, eventType: row.event_type, actorUserId: row.actor_user_id ?? undefined, payload: row.payload ?? undefined, createdAt: requiredIso(row.created_at) };
}
