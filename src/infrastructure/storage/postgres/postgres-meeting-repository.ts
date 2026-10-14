import type { Pool, PoolClient } from "pg";
import type {
  MeetingDashboard,
  MeetingListFilter,
  MeetingRepositoryPort,
  NewMeeting,
  RecordingAdmission,
} from "../../../application/ports/meeting-repository.port.js";
import {
  ACTIVE_RECORDING_STATUSES,
  canTransitionMeeting,
  isTerminalMeetingStatus,
  meetingUsagePeriod,
  type Meeting,
  type MeetingAnalysis,
  type MeetingDetail,
  type MeetingListItem,
  type MeetingParticipant,
  type MeetingRecording,
  type MeetingStatus,
  type MeetingTranscriptSegment,
  type MeetingTranscriptSummary,
} from "../../../domain/meetings/meeting.model.js";

type MeetingRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  owner_user_id: string;
  owner_name?: string | null;
  created_by_user_id: string;
  title: string;
  description: string | null;
  source: Meeting["source"];
  status: MeetingStatus;
  calendar_event_id: string | null;
  meeting_url: string | null;
  scheduled_start_at: Date | null;
  scheduled_end_at: Date | null;
  timezone: string;
  auto_record: boolean;
  bot_account_id: string | null;
  bot_joined_at: Date | null;
  recording_started_at: Date | null;
  recording_ended_at: Date | null;
  duration_seconds: number | null;
  failure_code: string | null;
  failure_message: string | null;
  status_changed_at: Date;
  created_at: Date;
  updated_at: Date;
};

type RecordingRow = {
  id: string;
  meeting_id: string;
  kind: MeetingRecording["kind"];
  storage_key: string;
  mime_type: string;
  bytes: string;
  duration_seconds: string | null;
  checksum_sha256: string;
  original_file_name: string | null;
  status: MeetingRecording["status"];
  purged_at: Date | null;
  created_at: Date;
};

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const iso = (value: Date | null | undefined) => (value ? value.toISOString() : undefined);
const ACTIVE = ACTIVE_RECORDING_STATUSES as readonly string[];

export class PostgresMeetingRepository implements MeetingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async create(meeting: NewMeeting): Promise<MeetingDetail> {
    await this.tx(async (client) => {
      await client.query(
        `insert into meetings (id, tenant_id, workspace_id, owner_user_id, created_by_user_id, title, description, source, status,
           calendar_event_id, meeting_url, scheduled_start_at, scheduled_end_at, timezone, auto_record)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          meeting.id, meeting.tenantId, meeting.workspaceId, meeting.ownerUserId, meeting.createdByUserId, meeting.title, meeting.description ?? null,
          meeting.source, meeting.status, meeting.calendarEventId ?? null, meeting.meetingUrl ?? null, meeting.scheduledStartAt ?? null,
          meeting.scheduledEndAt ?? null, meeting.timezone, meeting.autoRecord,
        ],
      );
      for (const participant of meeting.participants) {
        await client.query(
          `insert into meeting_participants (id, meeting_id, tenant_id, name, email, role, user_id, contact_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [newId("mpart"), meeting.id, meeting.tenantId, participant.name ?? null, participant.email ?? null, participant.role, participant.userId ?? null, participant.contactId ?? null],
        );
      }
    });
    return (await this.getDetail({ tenantId: meeting.tenantId, workspaceId: meeting.workspaceId, meetingId: meeting.id }))!;
  }

  async list(filter: MeetingListFilter): Promise<{ items: MeetingListItem[]; total: number }> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const where: string[] = ["m.tenant_id = $1", "m.workspace_id = $2", "m.deleted_at is null"];
    const add = (sql: (n: string) => string, value: unknown) => {
      params.push(value);
      where.push(sql(`$${params.length}`));
    };
    if (filter.visibleToUserId) {
      add((n) => `(m.owner_user_id = ${n} or m.created_by_user_id = ${n} or exists (select 1 from meeting_participants vp where vp.meeting_id = m.id and vp.user_id = ${n}))`, filter.visibleToUserId);
    }
    if (filter.ownerUserId) add((n) => `m.owner_user_id = ${n}`, filter.ownerUserId);
    if (filter.status) add((n) => `m.status = ${n}`, filter.status);
    if (filter.source) add((n) => `m.source = ${n}`, filter.source);
    if (filter.from) add((n) => `coalesce(m.scheduled_start_at, m.created_at) >= ${n}`, filter.from);
    if (filter.to) add((n) => `coalesce(m.scheduled_start_at, m.created_at) < ${n}`, filter.to);
    if (filter.hasRecording !== undefined) where.push(filter.hasRecording ? "r.n > 0" : "r.n = 0");
    if (filter.hasTranscript !== undefined) where.push(filter.hasTranscript ? "t.status = 'completed'" : "(t.status is null or t.status <> 'completed')");
    if (filter.query?.trim()) {
      const q = filter.query.trim();
      params.push(q);
      const qn = `$${params.length}`;
      params.push(`%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      const like = `$${params.length}`;
      where.push(
        `(m.title ilike ${like} or to_tsvector('simple', m.title) @@ plainto_tsquery('simple', ${qn})
          or exists (select 1 from meeting_transcript_segments s where s.meeting_id = m.id and to_tsvector('simple', s.text) @@ plainto_tsquery('simple', ${qn})))`,
      );
    }
    params.push(filter.limit, filter.offset);
    const result = await this.pool.query<MeetingRow & { participant_count: string; participants: { name: string | null; email: string | null }[]; rec_n: string; rec_bytes: string; rec_duration: string | null; transcript_status: string | null; has_analysis: boolean; total: string }>(
      `select m.*,
         (select u.name from users u where u.id = m.owner_user_id) as owner_name,
         (select count(*) from meeting_participants pc where pc.meeting_id = m.id) as participant_count,
         coalesce((select json_agg(json_build_object('name', p.name, 'email', p.email))
                   from (select name, email from meeting_participants p where p.meeting_id = m.id order by p.created_at limit 5) p), '[]'::json) as participants,
         r.n as rec_n, r.bytes as rec_bytes, r.duration as rec_duration,
         t.status as transcript_status,
         exists (select 1 from meeting_analyses a where a.meeting_id = m.id and a.status = 'completed') as has_analysis,
         count(*) over () as total
       from meetings m
       left join lateral (select count(*) as n, coalesce(sum(bytes), 0) as bytes, max(duration_seconds) as duration
                          from meeting_recordings rr where rr.meeting_id = m.id and rr.status = 'available') r on true
       left join meeting_transcripts t on t.meeting_id = m.id
       where ${where.join(" and ")}
       order by coalesce(m.scheduled_start_at, m.created_at) desc, m.id desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return {
      total: Number(result.rows[0]?.total ?? 0),
      items: result.rows.map((row) => ({
        ...toMeeting(row),
        participantCount: Number(row.participant_count),
        participants: row.participants.map((participant) => ({ ...(participant.name ? { name: participant.name } : {}), ...(participant.email ? { email: participant.email } : {}) })),
        hasRecording: Number(row.rec_n) > 0,
        recordingBytes: Number(row.rec_bytes),
        ...(row.rec_duration !== null ? { recordingDurationSeconds: Number(row.rec_duration) } : {}),
        ...(row.transcript_status ? { transcriptStatus: row.transcript_status as MeetingListItem["transcriptStatus"] } : {}),
        hasAnalysis: row.has_analysis,
      })),
    };
  }

  async getDetail(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingDetail | undefined> {
    const meeting = await this.pool.query<MeetingRow>(
      `select m.*, (select u.name from users u where u.id = m.owner_user_id) as owner_name
       from meetings m where m.id = $1 and m.tenant_id = $2 and m.workspace_id = $3 and m.deleted_at is null`,
      [input.meetingId, input.tenantId, input.workspaceId],
    );
    const row = meeting.rows[0];
    if (!row) return undefined;
    const [participants, recordings, transcript, analyses] = await Promise.all([
      this.pool.query<{ id: string; name: string | null; email: string | null; role: MeetingParticipant["role"]; user_id: string | null; contact_id: string | null }>(
        `select * from meeting_participants where meeting_id = $1 order by created_at, id`,
        [row.id],
      ),
      this.pool.query<RecordingRow>(`select * from meeting_recordings where meeting_id = $1 order by created_at`, [row.id]),
      this.pool.query(`select * from meeting_transcripts where meeting_id = $1`, [row.id]),
      this.listAnalyses(input),
    ]);
    const t = transcript.rows[0] as Record<string, unknown> | undefined;
    return {
      ...toMeeting(row),
      participants: participants.rows.map((participant) => ({
        id: participant.id,
        role: participant.role,
        ...(participant.name ? { name: participant.name } : {}),
        ...(participant.email ? { email: participant.email } : {}),
        ...(participant.user_id ? { userId: participant.user_id } : {}),
        ...(participant.contact_id ? { contactId: participant.contact_id } : {}),
      })),
      recordings: recordings.rows.map(toRecording),
      ...(t ? { transcript: toTranscriptSummary(t) } : {}),
      ...(analyses[0] ? { latestAnalysis: analyses[0] } : {}),
    };
  }

  async update(input: { tenantId: string; workspaceId: string; meetingId: string; patch: { title?: string; description?: string | null } }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [input.meetingId, input.tenantId, input.workspaceId];
    if (input.patch.title !== undefined) {
      params.push(input.patch.title);
      sets.push(`title = $${params.length}`);
    }
    if (input.patch.description !== undefined) {
      params.push(input.patch.description);
      sets.push(`description = $${params.length}`);
    }
    if (sets.length === 0) return;
    await this.pool.query(`update meetings set ${sets.join(", ")}, updated_at = now() where id = $1 and tenant_id = $2 and workspace_id = $3 and deleted_at is null`, params);
  }

  async softDelete(input: { tenantId: string; workspaceId: string; meetingId: string; actorUserId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `update meetings set deleted_at = now(), deleted_by_user_id = $4, updated_at = now()
       where id = $1 and tenant_id = $2 and workspace_id = $3 and deleted_at is null and status not in (${ACTIVE.map((status) => `'${status}'`).join(", ")})`,
      [input.meetingId, input.tenantId, input.workspaceId, input.actorUserId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async transition(input: { tenantId: string; meetingId: string; to: MeetingStatus; failureCode?: string; failureMessage?: string }): Promise<{ ok: boolean; from?: MeetingStatus }> {
    return this.tx(async (client) => {
      const current = await client.query<{ status: MeetingStatus }>(`select status from meetings where id = $1 and tenant_id = $2 for update`, [input.meetingId, input.tenantId]);
      const from = current.rows[0]?.status;
      if (!from) return { ok: false };
      // Estado terminal protegido: nenhuma fonte externa rebaixa uma reunião concluída/falha/cancelada.
      if (isTerminalMeetingStatus(from) && from !== input.to) return { ok: false, from };
      if (!canTransitionMeeting(from, input.to)) return { ok: false, from };
      await client.query(
        `update meetings set status = $3, status_changed_at = now(), updated_at = now(),
           failure_code = coalesce($4, failure_code), failure_message = coalesce($5, failure_message)
         where id = $1 and tenant_id = $2`,
        [input.meetingId, input.tenantId, input.to, input.failureCode ?? null, input.failureMessage ?? null],
      );
      return { ok: true, from };
    });
  }

  async addRecording(recording: Omit<MeetingRecording, "status" | "purgedAt" | "createdAt"> & { tenantId: string; workspaceId: string }): Promise<MeetingRecording> {
    const result = await this.pool.query<RecordingRow>(
      `insert into meeting_recordings (id, meeting_id, tenant_id, workspace_id, kind, storage_key, mime_type, bytes, duration_seconds, checksum_sha256, original_file_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [
        recording.id, recording.meetingId, recording.tenantId, recording.workspaceId, recording.kind, recording.storageKey, recording.mimeType,
        recording.bytes, recording.durationSeconds ?? null, recording.checksumSha256, recording.originalFileName ?? null,
      ],
    );
    return toRecording(result.rows[0]!);
  }

  async getRecording(input: { tenantId: string; workspaceId: string; meetingId: string; recordingId: string }): Promise<MeetingRecording | undefined> {
    const result = await this.pool.query<RecordingRow>(
      `select r.* from meeting_recordings r join meetings m on m.id = r.meeting_id
       where r.id = $1 and r.meeting_id = $2 and r.tenant_id = $3 and r.workspace_id = $4 and m.deleted_at is null`,
      [input.recordingId, input.meetingId, input.tenantId, input.workspaceId],
    );
    return result.rows[0] ? toRecording(result.rows[0]) : undefined;
  }

  async enqueueTranscription(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<{ jobId: string }> {
    return this.tx(async (client) => {
      await client.query(
        `insert into meeting_transcripts (id, meeting_id, tenant_id, status) values ($1, $2, $3, 'queued')
         on conflict (meeting_id) do update set status = 'queued', last_error = null, updated_at = now() where meeting_transcripts.status = 'failed'`,
        [newId("mtrans"), input.meetingId, input.tenantId],
      );
      const key = `transcribe:${input.meetingId}`;
      await client.query(
        `insert into meeting_jobs (id, tenant_id, workspace_id, meeting_id, kind, idempotency_key) values ($1, $2, $3, $4, 'transcribe', $5)
         on conflict (idempotency_key) do nothing`,
        [newId("mjob"), input.tenantId, input.workspaceId, input.meetingId, key],
      );
      const job = await client.query<{ id: string }>(`select id from meeting_jobs where idempotency_key = $1`, [key]);
      return { jobId: job.rows[0]!.id };
    });
  }

  async getTranscriptSegments(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingTranscriptSegment[]> {
    const result = await this.pool.query<{ seq: number; start_ms: number; end_ms: number; speaker: string | null; text: string }>(
      `select s.seq, s.start_ms, s.end_ms, s.speaker, s.text from meeting_transcript_segments s
       join meetings m on m.id = s.meeting_id
       where s.meeting_id = $1 and s.tenant_id = $2 and m.workspace_id = $3 and m.deleted_at is null order by s.seq`,
      [input.meetingId, input.tenantId, input.workspaceId],
    );
    return result.rows.map((row) => ({ seq: row.seq, startMs: row.start_ms, endMs: row.end_ms, ...(row.speaker ? { speaker: row.speaker } : {}), text: row.text }));
  }

  async listAnalyses(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingAnalysis[]> {
    const result = await this.pool.query<{ id: string; status: MeetingAnalysis["status"]; result: MeetingAnalysis["result"] | null; credits_charged: number; model: string | null; error: string | null; created_at: Date }>(
      `select * from meeting_analyses where meeting_id = $1 and tenant_id = $2 and workspace_id = $3 order by created_at desc, id desc`,
      [input.meetingId, input.tenantId, input.workspaceId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      ...(row.result ? { result: row.result } : {}),
      creditsCharged: row.credits_charged,
      ...(row.model ? { model: row.model } : {}),
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.created_at.toISOString(),
    }));
  }

  async admitRecording(input: { tenantId: string; workspaceId: string; meetingId: string; maxConcurrentRecordings: number; now: Date }): Promise<RecordingAdmission> {
    return this.tx(async (client) => {
      // Serializa admissões do MESMO tenant (duas requisições/workers simultâneos nunca passam juntos
      // pelo limite). Lock transacional: liberado no commit/rollback, nada fica preso.
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`vorix:meetings:admission:${input.tenantId}`]);
      const meeting = await client.query<{ status: MeetingStatus }>(
        `select status from meetings where id = $1 and tenant_id = $2 and workspace_id = $3 and deleted_at is null for update`,
        [input.meetingId, input.tenantId, input.workspaceId],
      );
      const status = meeting.rows[0]?.status;
      if (!status || status !== "scheduled") return { ok: false, reason: "INVALID_STATE", status: status ?? "cancelled" };

      const active = await client.query<{ n: string }>(
        `select count(*) as n from meetings where tenant_id = $1 and deleted_at is null and status in (${ACTIVE.map((value) => `'${value}'`).join(", ")})`,
        [input.tenantId],
      );
      const activeRecordings = Number(active.rows[0]!.n);
      if (activeRecordings >= input.maxConcurrentRecordings) {
        return { ok: false, reason: "CONCURRENCY_LIMIT_REACHED", activeRecordings, limit: input.maxConcurrentRecordings };
      }

      // Reserva atômica: SKIP LOCKED garante que dois admissores simultâneos (de tenants diferentes)
      // nunca peguem a mesma conta; o índice único em current_meeting_id é a segunda barreira.
      const bot = await client.query<{ id: string }>(
        `update recorder_bot_accounts set status = 'busy', current_meeting_id = $1, current_tenant_id = $2, last_used_at = $3, updated_at = now()
         where id = (select id from recorder_bot_accounts where status = 'active' and current_meeting_id is null
                     order by last_used_at nulls first, id for update skip locked limit 1)
         returning id`,
        [input.meetingId, input.tenantId, input.now],
      );
      const botAccountId = bot.rows[0]?.id;
      if (!botAccountId) return { ok: false, reason: "NO_BOT_AVAILABLE", activeRecordings };

      await client.query(
        `update meetings set status = 'queued', bot_account_id = $3, status_changed_at = now(), updated_at = now(), failure_code = null, failure_message = null
         where id = $1 and tenant_id = $2`,
        [input.meetingId, input.tenantId, botAccountId],
      );
      const jobId = newId("mjob");
      await client.query(
        `insert into meeting_jobs (id, tenant_id, workspace_id, meeting_id, kind, idempotency_key) values ($1, $2, $3, $4, 'record', $5)`,
        [jobId, input.tenantId, input.workspaceId, input.meetingId, `record:${input.meetingId}:${jobId}`],
      );
      await client.query(
        `insert into meeting_usage_monthly (tenant_id, period, concurrent_peak) values ($1, $2, $3)
         on conflict (tenant_id, period) do update set concurrent_peak = greatest(meeting_usage_monthly.concurrent_peak, excluded.concurrent_peak), updated_at = now()`,
        [input.tenantId, meetingUsagePeriod(input.now), activeRecordings + 1],
      );
      return { ok: true, jobId, botAccountId, activeRecordings: activeRecordings + 1 };
    });
  }

  async releaseBot(input: { meetingId: string; healthy: boolean }): Promise<void> {
    await this.pool.query(
      `update recorder_bot_accounts set
         status = case when status = 'busy' then (case when $2 then 'active' else 'error' end) else status end,
         consecutive_failures = case when $2 then 0 else consecutive_failures + 1 end,
         current_meeting_id = null, current_tenant_id = null, updated_at = now()
       where current_meeting_id = $1`,
      [input.meetingId, input.healthy],
    );
  }

  async dashboard(input: { tenantId: string; workspaceId: string; visibleToUserId?: string; todayStart: Date; todayEnd: Date; weekStart: Date; weekEnd: Date }): Promise<MeetingDashboard> {
    const visibility = input.visibleToUserId
      ? `and (m.owner_user_id = $8 or m.created_by_user_id = $8 or exists (select 1 from meeting_participants vp where vp.meeting_id = m.id and vp.user_id = $8))`
      : "";
    const params: unknown[] = [input.tenantId, input.workspaceId, input.todayStart, input.todayEnd, input.weekStart, input.weekEnd, [...ACTIVE]];
    if (input.visibleToUserId) params.push(input.visibleToUserId);
    const result = await this.pool.query<Record<string, string>>(
      `select
         count(*) filter (where coalesce(m.scheduled_start_at, m.created_at) >= $3 and coalesce(m.scheduled_start_at, m.created_at) < $4) as today,
         count(*) filter (where coalesce(m.scheduled_start_at, m.created_at) >= $5 and coalesce(m.scheduled_start_at, m.created_at) < $6) as week,
         count(*) filter (where m.status = any($7::text[])) as recording_now,
         count(*) filter (where m.status in ('processing', 'transcribing', 'analyzing')) as processing,
         coalesce(sum((select coalesce(sum(r.duration_seconds), 0) from meeting_recordings r where r.meeting_id = m.id and r.status = 'available')), 0) as recorded_seconds,
         count(*) filter (where exists (select 1 from meeting_transcripts t where t.meeting_id = m.id and t.status = 'completed')) as transcripts
       from meetings m
       where m.tenant_id = $1 and m.workspace_id = $2 and m.deleted_at is null ${visibility}`,
      params,
    );
    const row = result.rows[0] ?? {};
    return {
      meetingsToday: Number(row.today ?? 0),
      meetingsThisWeek: Number(row.week ?? 0),
      recordingNow: Number(row.recording_now ?? 0),
      processing: Number(row.processing ?? 0),
      recordedSeconds: Math.round(Number(row.recorded_seconds ?? 0)),
      transcriptsAvailable: Number(row.transcripts ?? 0),
    };
  }

  async recordUsage(input: { tenantId: string; period: string; delta: Partial<{ recordingSeconds: number; meetingsRecorded: number; transcriptionSeconds: number; storageBytes: number; aiAnalyses: number; concurrentPeak: number }> }): Promise<void> {
    const d = input.delta;
    await this.pool.query(
      `insert into meeting_usage_monthly (tenant_id, period, recording_seconds, meetings_recorded, transcription_seconds, storage_bytes, ai_analyses, concurrent_peak)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, period) do update set
         recording_seconds = meeting_usage_monthly.recording_seconds + excluded.recording_seconds,
         meetings_recorded = meeting_usage_monthly.meetings_recorded + excluded.meetings_recorded,
         transcription_seconds = meeting_usage_monthly.transcription_seconds + excluded.transcription_seconds,
         storage_bytes = meeting_usage_monthly.storage_bytes + excluded.storage_bytes,
         ai_analyses = meeting_usage_monthly.ai_analyses + excluded.ai_analyses,
         concurrent_peak = greatest(meeting_usage_monthly.concurrent_peak, excluded.concurrent_peak),
         updated_at = now()`,
      [input.tenantId, input.period, d.recordingSeconds ?? 0, d.meetingsRecorded ?? 0, d.transcriptionSeconds ?? 0, d.storageBytes ?? 0, d.aiAnalyses ?? 0, d.concurrentPeak ?? 0],
    );
  }

  async storageBytesInUse(tenantId: string): Promise<number> {
    const result = await this.pool.query<{ bytes: string }>(`select coalesce(sum(bytes), 0) as bytes from meeting_recordings where tenant_id = $1 and status = 'available'`, [tenantId]);
    return Number(result.rows[0]?.bytes ?? 0);
  }

  async audit(input: { tenantId: string; workspaceId?: string; meetingId?: string; actorUserId?: string; action: string; details?: Record<string, unknown> }): Promise<void> {
    await this.pool.query(
      `insert into meeting_audit_log (id, tenant_id, workspace_id, meeting_id, actor_user_id, action, details) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [newId("maudit"), input.tenantId, input.workspaceId ?? null, input.meetingId ?? null, input.actorUserId ?? null, input.action, JSON.stringify(input.details ?? {})],
    );
  }
}

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    ...(row.owner_name ? { ownerName: row.owner_name } : {}),
    createdByUserId: row.created_by_user_id,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    source: row.source,
    status: row.status,
    ...(row.calendar_event_id ? { calendarEventId: row.calendar_event_id } : {}),
    ...(row.meeting_url ? { meetingUrl: row.meeting_url } : {}),
    ...(row.scheduled_start_at ? { scheduledStartAt: iso(row.scheduled_start_at) } : {}),
    ...(row.scheduled_end_at ? { scheduledEndAt: iso(row.scheduled_end_at) } : {}),
    timezone: row.timezone,
    autoRecord: row.auto_record,
    ...(row.bot_account_id ? { botAccountId: row.bot_account_id } : {}),
    ...(row.bot_joined_at ? { botJoinedAt: iso(row.bot_joined_at) } : {}),
    ...(row.recording_started_at ? { recordingStartedAt: iso(row.recording_started_at) } : {}),
    ...(row.recording_ended_at ? { recordingEndedAt: iso(row.recording_ended_at) } : {}),
    ...(row.duration_seconds !== null ? { durationSeconds: row.duration_seconds } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    statusChangedAt: row.status_changed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toRecording(row: RecordingRow): MeetingRecording {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    kind: row.kind,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    bytes: Number(row.bytes),
    ...(row.duration_seconds !== null ? { durationSeconds: Number(row.duration_seconds) } : {}),
    checksumSha256: row.checksum_sha256,
    ...(row.original_file_name ? { originalFileName: row.original_file_name } : {}),
    status: row.status,
    ...(row.purged_at ? { purgedAt: row.purged_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

function toTranscriptSummary(row: Record<string, unknown>): MeetingTranscriptSummary {
  return {
    id: String(row.id),
    status: row.status as MeetingTranscriptSummary["status"],
    ...(row.language ? { language: String(row.language) } : {}),
    ...(row.engine ? { engine: String(row.engine) } : {}),
    ...(row.model ? { model: String(row.model) } : {}),
    segmentCount: Number(row.segment_count ?? 0),
    ...(row.processing_ms !== null && row.processing_ms !== undefined ? { processingMs: Number(row.processing_ms) } : {}),
    attempts: Number(row.attempts ?? 0),
    ...(row.last_error ? { lastError: String(row.last_error) } : {}),
    ...(row.completed_at instanceof Date ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}
