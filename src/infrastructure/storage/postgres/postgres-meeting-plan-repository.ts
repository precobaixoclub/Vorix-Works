import type { Pool } from "pg";
import type { MeetingPlanEvent, MeetingPlanRepositoryPort, RetentionNoticeCandidate, WindowClosedRecording } from "../../../application/ports/meeting-plan-repository.port.js";
import type { MeetingPlanCode, MeetingPlanEventKind, MeetingPlanOrTrial, MeetingPlanStatus, MeetingPlanSubscription } from "../../../domain/meetings/meeting-plans.model.js";

type Row = {
  tenant_id: string; plan_code: string; status: string; current_period_start: Date; current_period_end: Date;
  cancel_at_period_end: boolean; pending_plan_code: string | null; trial_started_at: Date | null; canceled_at: Date | null;
  ended_at: Date | null; export_until: Date | null; payment_failed_at: Date | null; export_closed_at: Date | null;
  created_at: Date; updated_at: Date;
};

const iso = (value: Date | null) => (value ? value.toISOString() : undefined);

function toDomain(row: Row): MeetingPlanSubscription {
  const optional = {
    pendingPlanCode: (row.pending_plan_code ?? undefined) as MeetingPlanCode | undefined,
    trialStartedAt: iso(row.trial_started_at), canceledAt: iso(row.canceled_at), endedAt: iso(row.ended_at),
    exportUntil: iso(row.export_until), paymentFailedAt: iso(row.payment_failed_at), exportClosedAt: iso(row.export_closed_at),
  };
  return {
    tenantId: row.tenant_id, planCode: row.plan_code as MeetingPlanOrTrial, status: row.status as MeetingPlanStatus,
    currentPeriodStart: row.current_period_start.toISOString(), currentPeriodEnd: row.current_period_end.toISOString(),
    cancelAtPeriodEnd: row.cancel_at_period_end,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  } as MeetingPlanSubscription;
}

const VALUES = (s: MeetingPlanSubscription) => [
  s.tenantId, s.planCode, s.status, s.currentPeriodStart, s.currentPeriodEnd, s.cancelAtPeriodEnd, s.pendingPlanCode ?? null,
  s.trialStartedAt ?? null, s.canceledAt ?? null, s.endedAt ?? null, s.exportUntil ?? null, s.paymentFailedAt ?? null,
  s.exportClosedAt ?? null, s.createdAt, s.updatedAt,
];

/** Adapter Postgres — `db/migrations/0198_meeting_plans.sql`. */
export class PostgresMeetingPlanRepository implements MeetingPlanRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async get(tenantId: string): Promise<MeetingPlanSubscription | undefined> {
    const result = await this.pool.query<Row>("select * from meeting_plan_subscriptions where tenant_id = $1", [tenantId]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async save(next: MeetingPlanSubscription, expectedUpdatedAt: string | undefined): Promise<boolean> {
    if (expectedUpdatedAt === undefined) {
      const result = await this.pool.query(
        `insert into meeting_plan_subscriptions (tenant_id, plan_code, status, current_period_start, current_period_end, cancel_at_period_end,
           pending_plan_code, trial_started_at, canceled_at, ended_at, export_until, payment_failed_at, export_closed_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict (tenant_id) do nothing`,
        VALUES(next),
      );
      return (result.rowCount ?? 0) > 0;
    }
    const result = await this.pool.query(
      `update meeting_plan_subscriptions set plan_code = $2, status = $3, current_period_start = $4, current_period_end = $5,
         cancel_at_period_end = $6, pending_plan_code = $7, trial_started_at = $8, canceled_at = $9, ended_at = $10,
         export_until = $11, payment_failed_at = $12, export_closed_at = $13, updated_at = $14
       where tenant_id = $1 and updated_at = $15::timestamptz`,
      [...VALUES(next).filter((_, index) => index !== 13), expectedUpdatedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async appendEvents(events: readonly MeetingPlanEvent[]): Promise<void> {
    for (const event of events) {
      await this.pool.query(
        `insert into meeting_plan_events (id, tenant_id, kind, plan_code, status, details, actor_user_id, occurred_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [event.id, event.tenantId, event.kind, event.planCode, event.status, JSON.stringify(event.details), event.actorUserId ?? null, event.occurredAt],
      );
    }
  }

  async listEvents(tenantId: string, limit: number): Promise<MeetingPlanEvent[]> {
    const result = await this.pool.query<{ id: string; tenant_id: string; kind: string; plan_code: string; status: string; details: Record<string, unknown>; actor_user_id: string | null; occurred_at: Date }>(
      "select * from meeting_plan_events where tenant_id = $1 order by occurred_at desc limit $2",
      [tenantId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id, tenantId: row.tenant_id, kind: row.kind as MeetingPlanEventKind, planCode: row.plan_code, status: row.status,
      details: row.details, ...(row.actor_user_id ? { actorUserId: row.actor_user_id } : {}), occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async listDue(now: Date, limit: number): Promise<MeetingPlanSubscription[]> {
    const result = await this.pool.query<Row>(
      `select * from meeting_plan_subscriptions
       where (status in ('trial', 'active') and current_period_end <= $1)
          or (status = 'past_due' and payment_failed_at + interval '7 days' <= $1)
       order by current_period_end limit $2`,
      [now, limit],
    );
    return result.rows.map(toDomain);
  }

  async listExportWindowDue(now: Date, limit: number): Promise<MeetingPlanSubscription[]> {
    const result = await this.pool.query<Row>(
      `select * from meeting_plan_subscriptions
       where status in ('canceled', 'expired') and export_closed_at is null and export_until <= $1
       order by export_until limit $2`,
      [now, limit],
    );
    return result.rows.map(toDomain);
  }

  async usedSeconds(tenantId: string, from: string, to: string): Promise<number> {
    const result = await this.pool.query<{ seconds: string | null }>(
      `select coalesce(sum(duration_seconds), 0) as seconds from meeting_recordings
       where tenant_id = $1 and kind = 'original' and status in ('available', 'purged')
         and created_at >= $2::timestamptz and created_at < $3::timestamptz`,
      [tenantId, from, to],
    );
    return Math.ceil(Number(result.rows[0]?.seconds ?? 0));
  }

  async listRetentionNoticeCandidates(input: { now: Date; horizonDays: number; defaultRetentionDays: number; limit: number }): Promise<RetentionNoticeCandidate[]> {
    const result = await this.pool.query<{
      id: string; tenant_id: string; workspace_id: string; meeting_id: string; title: string; owner_user_id: string | null;
      created_at: Date; retention_days: number; export_until: Date | null; sent: number[] | null;
    }>(
      `select r.id, r.tenant_id, r.workspace_id, r.meeting_id, m.title, m.owner_user_id, r.created_at, x.retention_days,
              case when p.status in ('canceled', 'expired') then p.export_until end as export_until,
              (select array_agg(n.days_before) from meeting_retention_notices n where n.recording_id = r.id) as sent
       from meeting_recordings r
       join meetings m on m.id = r.meeting_id
       join meeting_plan_subscriptions p on p.tenant_id = r.tenant_id
       cross join lateral (
         select coalesce((select (se.limits->>'meetingRetentionDays')::int from solution_entitlements se
                           where se.tenant_id = r.tenant_id and se.solution_key = 'meetings' and se.limits ? 'meetingRetentionDays'), $3) as retention_days
       ) x
       where r.status = 'available' and r.kind = 'original' and m.deleted_at is null and p.export_closed_at is null
         and least(r.created_at + x.retention_days * interval '1 day',
                   case when p.status in ('canceled', 'expired') then p.export_until else 'infinity'::timestamptz end)
             <= $1::timestamptz + $2 * interval '1 day'
       order by r.created_at limit $4`,
      [input.now, input.horizonDays, input.defaultRetentionDays, input.limit],
    );
    return result.rows.map((row) => ({
      recordingId: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, meetingId: row.meeting_id, meetingTitle: row.title,
      ...(row.owner_user_id ? { ownerUserId: row.owner_user_id } : {}), recordedAt: row.created_at.toISOString(), retentionDays: row.retention_days,
      ...(row.export_until ? { exportUntil: row.export_until.toISOString() } : {}), sentNotices: row.sent ?? [],
    }));
  }

  async markRetentionNotice(input: { recordingId: string; tenantId: string; daysBefore: number }): Promise<boolean> {
    const result = await this.pool.query(
      "insert into meeting_retention_notices (recording_id, days_before, tenant_id) values ($1, $2, $3) on conflict do nothing",
      [input.recordingId, input.daysBefore, input.tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listRecordingsOfTenant(tenantId: string, limit: number): Promise<WindowClosedRecording[]> {
    const result = await this.pool.query<{ id: string; tenant_id: string; workspace_id: string; meeting_id: string; storage_key: string; bytes: string }>(
      "select id, tenant_id, workspace_id, meeting_id, storage_key, bytes from meeting_recordings where tenant_id = $1 and status = 'available' order by created_at limit $2",
      [tenantId, limit],
    );
    return result.rows.map((row) => ({ recordingId: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, meetingId: row.meeting_id, storageKey: row.storage_key, bytes: Number(row.bytes) }));
  }
}
