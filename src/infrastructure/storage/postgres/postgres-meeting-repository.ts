import type { Pool, PoolClient } from "pg";
import type {
  MeetingDashboard,
  MeetingListFilter,
  MeetingRepositoryPort,
  NewMeeting,
  RecordingAdmission,
  RecorderAccountListFilter,
  RecorderAccountWithContext,
  RecorderJobContext,
  RecorderProvisioningSession,
  SkippedRecorderAccount,
  RecorderRunUpdate,
} from "../../../application/ports/meeting-repository.port.js";
import {
  ACTIVE_RECORDING_STATUSES,
  type AutoRecordWindow,
  type MeetingActionItem,
  type MeetingActionItemType,
  type MeetingJob,
  type MeetingJobKind,
  type TranscriptionResult,
  canTransitionMeeting,
  isTerminalMeetingStatus,
  meetingUsagePeriod,
  type Meeting,
  type MeetingAnalysis,
  type MeetingDetail,
  type MeetingListItem,
  type MeetingParticipant,
  type MeetingRecording,
  type RecorderBotAccount,
  type RecorderBotStatus,
  type RecorderRun,
  type MeetingStatus,
  type MeetingTranscriptSegment,
  type MeetingTranscriptSummary,
  type HumanJoinIdentitySource,
  normalizeGoogleEmail,
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
  join_before_minutes?: number | null;
  join_grace_minutes?: number | null;
  auto_record_outcome?: string | null;
  bot_account_id: string | null;
  bot_joined_at: Date | null;
  recording_started_at: Date | null;
  recording_ended_at: Date | null;
  duration_seconds: number | null;
  failure_code: string | null;
  failure_message: string | null;
  human_join_account_email?: string | null;
  human_join_identity_source?: HumanJoinIdentitySource | null;
  excluded_recorder_emails?: string[] | null;
  capture_strategy?: Meeting["captureStrategy"] | null;
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
  video_codec: string | null;
  audio_codec: string | null;
  width: number | null;
  height: number | null;
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
           calendar_event_id, meeting_url, scheduled_start_at, scheduled_end_at, timezone, auto_record, join_before_minutes, join_grace_minutes,
           human_join_account_email, human_join_identity_source, excluded_recorder_emails, capture_strategy)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::text[],$21)`,
        [
          meeting.id, meeting.tenantId, meeting.workspaceId, meeting.ownerUserId, meeting.createdByUserId, meeting.title, meeting.description ?? null,
          meeting.source, meeting.status, meeting.calendarEventId ?? null, meeting.meetingUrl ?? null, meeting.scheduledStartAt ?? null,
          meeting.scheduledEndAt ?? null, meeting.timezone, meeting.autoRecord, meeting.joinBeforeMinutes ?? null, meeting.joinGraceMinutes ?? null,
          normalizeGoogleEmail(meeting.humanJoinAccountEmail) ?? null, meeting.humanJoinIdentitySource ?? null,
          meeting.excludedRecorderEmails ?? [], meeting.captureStrategy ?? "vorix_recorder",
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
      `select m.*, coalesce(m.meeting_url, (select ce.meet_link from calendar_events ce where ce.id = m.calendar_event_id)) as meeting_url,
         (select u.name from users u where u.id = m.owner_user_id) as owner_name
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
      ...(analyses.find((analysis) => analysis.status === "completed") ? { lastCompletedAnalysis: analyses.find((analysis) => analysis.status === "completed") } : {}),
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
      `insert into meeting_recordings (id, meeting_id, tenant_id, workspace_id, kind, storage_key, mime_type, bytes, duration_seconds,
         video_codec, audio_codec, width, height, checksum_sha256, original_file_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [
        recording.id, recording.meetingId, recording.tenantId, recording.workspaceId, recording.kind, recording.storageKey, recording.mimeType,
        recording.bytes, recording.durationSeconds ?? null, recording.videoCodec ?? null, recording.audioCodec ?? null,
        recording.width ?? null, recording.height ?? null, recording.checksumSha256, recording.originalFileName ?? null,
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

  async enqueueTranscription(input: { tenantId: string; workspaceId: string; meetingId: string; recordingId: string }): Promise<{ jobId: string; alreadyActive: boolean }> {
    return this.tx(async (client) => {
      const active = await client.query<{ id: string }>(`select id from meeting_jobs where recording_id = $1 and kind = 'transcribe' and status in ('queued', 'running')`, [input.recordingId]);
      if (active.rows[0]) return { jobId: active.rows[0].id, alreadyActive: true };
      await client.query(
        `insert into meeting_transcripts (id, meeting_id, tenant_id, status, recording_id) values ($1, $2, $3, 'queued', $4)
         on conflict (meeting_id) do update set status = 'queued', last_error = null, recording_id = excluded.recording_id, updated_at = now()`,
        [newId("mtrans"), input.meetingId, input.tenantId, input.recordingId],
      );
      const jobId = newId("mjob");
      // O índice único parcial (gravação, operação, ativo) é a barreira final contra duplicidade.
      const inserted = await client.query<{ id: string }>(
        `insert into meeting_jobs (id, tenant_id, workspace_id, meeting_id, recording_id, kind, idempotency_key) values ($1, $2, $3, $4, $5, 'transcribe', $6)
         on conflict do nothing returning id`,
        [jobId, input.tenantId, input.workspaceId, input.meetingId, input.recordingId, `transcribe:${input.recordingId}:${jobId}`],
      );
      if (!inserted.rows[0]) {
        const existing = await client.query<{ id: string }>(`select id from meeting_jobs where recording_id = $1 and kind = 'transcribe' and status in ('queued', 'running')`, [input.recordingId]);
        return { jobId: existing.rows[0]!.id, alreadyActive: true };
      }
      return { jobId, alreadyActive: false };
    });
  }

  async enqueueAnalysis(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<{ jobId: string; alreadyActive: boolean }> {
    const jobId = newId("mjob");
    const inserted = await this.pool.query<{ id: string }>(
      `insert into meeting_jobs (id, tenant_id, workspace_id, meeting_id, kind, idempotency_key, max_attempts) values ($1, $2, $3, $4, 'analyze', $5, 3)
       on conflict do nothing returning id`,
      [jobId, input.tenantId, input.workspaceId, input.meetingId, `analyze:${input.meetingId}:${jobId}`],
    );
    if (inserted.rows[0]) return { jobId, alreadyActive: false };
    const existing = await this.pool.query<{ id: string }>(`select id from meeting_jobs where meeting_id = $1 and kind = 'analyze' and status in ('queued', 'running')`, [input.meetingId]);
    return { jobId: existing.rows[0]!.id, alreadyActive: true };
  }

  async latestRecording(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingRecording | undefined> {
    const result = await this.pool.query<RecordingRow>(
      `select * from meeting_recordings where meeting_id = $1 and tenant_id = $2 and workspace_id = $3 and status = 'available' order by created_at desc limit 1`,
      [input.meetingId, input.tenantId, input.workspaceId],
    );
    return result.rows[0] ? toRecording(result.rows[0]) : undefined;
  }

  async getTranscriptSegments(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingTranscriptSegment[]> {
    const result = await this.pool.query<{ seq: number; start_ms: number; end_ms: number; speaker: string | null; text: string; confidence: string | null }>(
      `select s.seq, s.start_ms, s.end_ms, s.speaker, s.text, s.confidence from meeting_transcript_segments s
       join meetings m on m.id = s.meeting_id
       where s.meeting_id = $1 and s.tenant_id = $2 and m.workspace_id = $3 and m.deleted_at is null order by s.seq`,
      [input.meetingId, input.tenantId, input.workspaceId],
    );
    return result.rows.map((row) => ({ seq: row.seq, startMs: row.start_ms, endMs: row.end_ms, ...(row.speaker ? { speaker: row.speaker } : {}), text: row.text, ...(row.confidence !== null ? { confidence: Number(row.confidence) } : {}) }));
  }

  async listAnalyses(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<MeetingAnalysis[]> {
    const result = await this.pool.query<{ id: string; status: MeetingAnalysis["status"]; result: MeetingAnalysis["result"] | null; credits_charged: number; model: string | null; error: string | null; created_at: Date }>(
      `select * from meeting_analyses where meeting_id = $1 and tenant_id = $2 and workspace_id = $3 order by created_at desc, id desc`,
      [input.meetingId, input.tenantId, input.workspaceId],
    );
    const items = result.rows.length
      ? await this.pool.query<ActionItemRow>(`select * from meeting_action_items where meeting_id = $1 and tenant_id = $2 order by type, source_timestamp_ms nulls last, created_at`, [input.meetingId, input.tenantId])
      : { rows: [] as ActionItemRow[] };
    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      ...(row.result ? { result: row.result } : {}),
      actionItems: items.rows.filter((item) => item.analysis_id === row.id).map(toActionItem),
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
      const meeting = await client.query<{ status: MeetingStatus; human_join_identity_source: string | null; human_join_account_email: string | null; excluded_recorder_emails: string[] | null; owner_user_id: string }>(
        `select status, human_join_identity_source, human_join_account_email, excluded_recorder_emails, owner_user_id from meetings where id = $1 and tenant_id = $2 and workspace_id = $3 and deleted_at is null for update`,
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

      // Identidade humana: a autoridade é o que está NO BANCO agora (não o que a tela mandou). Sem
      // identidade conhecida não há como garantir que o gravador não seja a conta da pessoa.
      if (!["explicit", "connected_account_confirmed"].includes(meeting.rows[0]!.human_join_identity_source ?? "")) return { ok: false, reason: "HUMAN_IDENTITY_REQUIRED", activeRecordings };
      const ownExcluded = [...new Set([meeting.rows[0]!.human_join_account_email, ...(meeting.rows[0]!.excluded_recorder_emails ?? [])].map((email) => normalizeGoogleEmail(email)).filter((email): email is string => Boolean(email)))];
      if (ownExcluded.length === 0) return { ok: false, reason: "HUMAN_IDENTITY_REQUIRED", activeRecordings };
      // Contas que são a identidade humana de OUTRA reunião ativa do tenant também ficam de fora
      // (a pessoa pode estar logada com ela em outra reunião neste momento).
      const others = await client.query<{ email: string }>(
        `select distinct lower(e) as email from meetings m, unnest(m.excluded_recorder_emails) as e
         where m.tenant_id = $1 and m.id <> $2 and m.deleted_at is null and m.status = any($3::text[])
           and m.human_join_identity_source in ('explicit','connected_account_confirmed')`,
        [input.tenantId, input.meetingId, [...ACTIVE]],
      );
      const excluded = [...new Set([...ownExcluded, ...others.rows.map((row) => row.email)])];

      // Contas do PRÓPRIO tenant, saudáveis e livres, que seriam elegíveis se não fossem identidade
      // humana — viram auditoria RECORDER_ACCOUNT_SKIPPED_IDENTITY_CONFLICT (só o id).
      const skippedRows = await client.query<{ id: string }>(
        `select id from recorder_bot_accounts
         where tenant_id = $1 and ownership_type = 'customer_managed' and removed_at is null and status = 'active'
           and current_meeting_id is null and (encrypted_session_state is not null or credential_secret_ref is not null)
           and (workspace_id is null or workspace_id = $3)
           and lower(google_email) = any($2::text[]) order by id`,
        [input.tenantId, excluded, input.workspaceId],
      );
      const skipped: SkippedRecorderAccount[] = skippedRows.rows.map((row) => ({ accountId: row.id, reason: "IDENTITY_CONFLICT" }));

      // Reserva atômica: só contas do PRÓPRIO tenant, com o filtro de identidade DENTRO do SQL da
      // reserva. SKIP LOCKED garante que duas admissões simultâneas nunca peguem a mesma conta; o
      // índice único em current_meeting_id é a segunda barreira.
      const bot = await client.query<{ id: string }>(
        `update recorder_bot_accounts set status = 'busy', current_meeting_id = $1, current_tenant_id = $2, last_used_at = $3, last_error = null, updated_at = now()
         where id = (select id from recorder_bot_accounts
                     where tenant_id = $2 and ownership_type = 'customer_managed' and removed_at is null
                       and status = 'active' and current_meeting_id is null
                       and (workspace_id is null or workspace_id = $5)
                       and (encrypted_session_state is not null or credential_secret_ref is not null)
                       and lower(google_email) <> all($4::text[])
                     order by last_used_at nulls first, id for update skip locked limit 1)
         returning id`,
        [input.meetingId, input.tenantId, input.now, excluded, input.workspaceId],
      );
      const botAccountId = bot.rows[0]?.id;
      if (!botAccountId) {
        // Motivo PRECISO — cada um pede uma ação diferente do cliente.
        const stats = await client.query<Record<string, string>>(
          `select count(*) as connected,
             count(*) filter (where status in ('active','busy') and (encrypted_session_state is not null or credential_secret_ref is not null)) as healthy,
             count(*) filter (where status = 'busy') as busy,
             count(*) filter (where status in ('reauth_required','invalid_session','error')) as invalid,
             count(*) filter (where status in ('active','busy') and (encrypted_session_state is not null or credential_secret_ref is not null)
                                and lower(google_email) <> all($2::text[])) as eligible_by_own
           from recorder_bot_accounts where tenant_id = $1 and ownership_type = 'customer_managed' and removed_at is null
             and (workspace_id is null or workspace_id = $3)`,
          [input.tenantId, ownExcluded, input.workspaceId],
        );
        const row = stats.rows[0] ?? {};
        const healthy = Number(row.healthy ?? 0);
        // Conflito PERMANENTE: nenhuma conta saudável (livre ou ocupada) serve para esta reunião.
        if (healthy > 0 && Number(row.eligible_by_own ?? 0) === 0) {
          return { ok: false, reason: "RECORDER_ACCOUNT_IDENTITY_CONFLICT", activeRecordings, skipped };
        }
        if (healthy === 0 && Number(row.invalid ?? 0) > 0) {
          return { ok: false, reason: "INVALID_RECORDER_SESSION", activeRecordings, invalidAccounts: Number(row.invalid) };
        }
        return { ok: false, reason: "NO_RECORDER_ACCOUNT_AVAILABLE", activeRecordings, connectedAccounts: Number(row.connected ?? 0), busyAccounts: Number(row.busy ?? 0) };
      }

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
      await client.query(
        `insert into meeting_audit_log (id, tenant_id, workspace_id, meeting_id, actor_user_id, action, details)
         values ($1,$2,$3,$4,$5,'RECORDER_RESERVED',$6::jsonb)`,
        [newId("maudit"), input.tenantId, input.workspaceId, input.meetingId, meeting.rows[0]!.owner_user_id, JSON.stringify({ recorderAccountId: botAccountId })],
      );
      return { ok: true, jobId, botAccountId, activeRecordings: activeRecordings + 1, skipped };
    });
  }

  async releaseBot(input: { meetingId: string; healthy: boolean; invalidSession?: boolean; reauthRequired?: boolean; lastError?: string }): Promise<void> {
    await this.pool.query(
      `with released as (update recorder_bot_accounts set
         status = case when status = 'busy' then (case when $3 then (case when $6 then 'reauth_required' else 'invalid_session' end) when $2 then 'active' else 'error' end) else status end,
         consecutive_failures = case when $2 then 0 else consecutive_failures + 1 end,
         current_meeting_id = null, current_recording_id = null, current_tenant_id = null,
         last_error = $4, updated_at = now()
       where current_meeting_id = $1 returning id)
       insert into meeting_audit_log (id, tenant_id, workspace_id, meeting_id, actor_user_id, action, details)
       select $5 || ':' || r.id || ':' || a.action, m.tenant_id, m.workspace_id, m.id, m.owner_user_id,
         a.action, jsonb_build_object('recorderAccountId', r.id)
       from released r join meetings m on m.id = $1
       cross join lateral (select 'RECORDER_RELEASED' as action
         union all select 'RECORDER_HEALTH_FAILED' where $3::boolean
         union all select 'RECORDER_REAUTH_REQUIRED' where $3::boolean and $6::boolean) a`,
      [input.meetingId, input.healthy, input.invalidSession ?? false, input.lastError?.slice(0, 2000) ?? null, newId("maudit"), input.reauthRequired ?? input.invalidSession ?? false],
    );
  }

  async getRecorderJobContext(input: { tenantId: string; workspaceId: string; meetingId: string; jobId: string }): Promise<RecorderJobContext | undefined> {
    const meeting = await this.getDetail({ tenantId: input.tenantId, workspaceId: input.workspaceId, meetingId: input.meetingId });
    if (!meeting?.botAccountId) return undefined;
    const result = await this.pool.query<RecorderBotRow>(
      `select b.* from recorder_bot_accounts b
       join meeting_jobs j on j.meeting_id = b.current_meeting_id
       where b.id = $1 and b.current_meeting_id = $2 and b.current_tenant_id = $3
         and j.id = $4 and j.kind = 'record' and j.status = 'running'`,
      [meeting.botAccountId, input.meetingId, input.tenantId, input.jobId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return { meeting, bot: { ...toRecorderBot(row), ...(row.encrypted_session_state ? { encryptedSessionState: row.encrypted_session_state } : {}) } };
  }

  async createRecorderRun(input: Omit<RecorderRun, "startedAt" | "heartbeatAt">): Promise<RecorderRun> {
    return this.tx(async (client) => {
      const result = await client.query<RecorderRunRow>(
        `insert into meeting_recorder_runs
           (id, tenant_id, workspace_id, meeting_id, recording_id, job_id, bot_account_id, worker_id, state,
            browser_pid, ffmpeg_pid, virtual_display, audio_sink, temp_dir, actual_joined_at, ended_at,
            error_code, error_message, ffmpeg_exit_code, browser_exit_reason, bytes_produced, duration_seconds, metrics)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)
         on conflict (job_id) do update set worker_id = excluded.worker_id, heartbeat_at = now(), updated_at = now()
         returning *`,
        [input.id, input.tenantId, input.workspaceId, input.meetingId, input.recordingId ?? null, input.jobId,
          input.botAccountId, input.workerId, input.state, input.browserPid ?? null, input.ffmpegPid ?? null,
          input.display ?? null, input.audioSink ?? null, input.tempDir ?? null, input.actualJoinedAt ?? null,
          input.endedAt ?? null, input.errorCode ?? null, input.errorMessage ?? null, input.ffmpegExitCode ?? null,
          input.browserExitReason ?? null, input.bytesProduced ?? null, input.durationSeconds ?? null,
          JSON.stringify(input.metrics ?? {})],
      );
      await client.query(
        `update recorder_bot_accounts set current_recording_id = $2, updated_at = now()
         where id = $1 and current_meeting_id = $3 and status = 'busy'`,
        [input.botAccountId, input.recordingId ?? input.id, input.meetingId],
      );
      await client.query(
        `update meetings set status = 'starting', status_changed_at = now(), updated_at = now()
         where id = $1 and tenant_id = $2 and status = 'queued'`,
        [input.meetingId, input.tenantId],
      );
      return toRecorderRun(result.rows[0]!);
    });
  }

  async updateRecorderRun(input: { runId: string; workerId: string; patch: RecorderRunUpdate }): Promise<boolean> {
    return this.tx(async (client) => {
      const p = input.patch;
      const result = await client.query<RecorderRunRow>(
        `update meeting_recorder_runs set
           state = coalesce($3, state), recording_id = coalesce($4, recording_id),
           browser_pid = coalesce($5, browser_pid), ffmpeg_pid = coalesce($6, ffmpeg_pid),
           virtual_display = coalesce($7, virtual_display), audio_sink = coalesce($8, audio_sink),
           temp_dir = coalesce($9, temp_dir), actual_joined_at = coalesce($10, actual_joined_at),
           ended_at = coalesce($11, ended_at), error_code = coalesce($12, error_code),
           error_message = coalesce($13, error_message), ffmpeg_exit_code = coalesce($14, ffmpeg_exit_code),
           browser_exit_reason = coalesce($15, browser_exit_reason), bytes_produced = coalesce($16, bytes_produced),
           duration_seconds = coalesce($17, duration_seconds), metrics = metrics || coalesce($18::jsonb, '{}'::jsonb),
           heartbeat_at = now(), updated_at = now()
         where id = $1 and worker_id = $2 returning *`,
        [input.runId, input.workerId, p.state ?? null, p.recordingId ?? null, p.browserPid ?? null,
          p.ffmpegPid ?? null, p.display ?? null, p.audioSink ?? null, p.tempDir ?? null,
          p.actualJoinedAt ?? null, p.endedAt ?? null, p.errorCode ?? null, p.errorMessage?.slice(0, 2000) ?? null,
          p.ffmpegExitCode ?? null, p.browserExitReason ?? null, p.bytesProduced ?? null,
          p.durationSeconds ?? null, p.metrics ? JSON.stringify(p.metrics) : null],
      );
      const run = result.rows[0];
      if (!run) return false;
      if (p.state) {
        const meetingState = p.state === "completed" ? "processing" : p.state === "cancelled" ? "cancelled" : p.state === "failed" ? "failed" : p.state;
        await client.query(
          `update meetings set status = $3, status_changed_at = now(), updated_at = now(),
             bot_joined_at = case when $3 = 'recording' then coalesce(bot_joined_at, $4::timestamptz, now()) else bot_joined_at end,
             recording_started_at = case when $3 = 'recording' then coalesce(recording_started_at, $4::timestamptz, now()) else recording_started_at end,
             recording_ended_at = case when $3 in ('processing','failed','cancelled') then coalesce(recording_ended_at, $5::timestamptz, now()) else recording_ended_at end,
             failure_code = case when $3 = 'failed' then $6 else failure_code end,
             failure_message = case when $3 = 'failed' then $7 else failure_message end
           where id = $1 and tenant_id = $2 and deleted_at is null`,
          [run.meeting_id, run.tenant_id, meetingState, p.actualJoinedAt ?? null, p.endedAt ?? null, p.errorCode ?? null, p.errorMessage?.slice(0, 2000) ?? null],
        );
        await client.query(
          `insert into meeting_recorder_events (id, run_id, meeting_id, recording_id, state, details)
           values ($1,$2,$3,$4,$5,$6::jsonb)`,
          [newId("mrevt"), run.id, run.meeting_id, p.recordingId ?? run.recording_id, p.state, JSON.stringify(p.metrics ?? {})],
        );
      }
      return true;
    });
  }

  async heartbeatRecorderRun(input: { runId: string; workerId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `update meeting_recorder_runs set heartbeat_at = now(), updated_at = now()
       where id = $1 and worker_id = $2 and state in ('starting','waiting_admission','recording','processing')`,
      [input.runId, input.workerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async requestRecordingStop(input: { tenantId: string; workspaceId: string; meetingId: string; actorUserId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `update meeting_jobs j set cancel_requested_at = now(), cancel_requested_by = $4, updated_at = now()
       from meetings m where j.meeting_id = m.id and j.meeting_id = $1 and j.tenant_id = $2
         and j.workspace_id = $3 and j.kind = 'record' and j.status in ('queued','running')
         and m.deleted_at is null and m.status in ('queued','starting','waiting_admission','recording')`,
      [input.meetingId, input.tenantId, input.workspaceId, input.actorUserId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async isRecordingStopRequested(input: { jobId: string }): Promise<boolean> {
    const result = await this.pool.query<{ requested: boolean }>(
      `select cancel_requested_at is not null as requested from meeting_jobs where id = $1`, [input.jobId],
    );
    return result.rows[0]?.requested ?? true;
  }

  async recoverOrphanRecorderRuns(input: { staleBefore: Date }): Promise<number> {
    return this.tx(async (client) => {
      const runs = await client.query<RecorderRunRow>(
        `select * from meeting_recorder_runs where state in ('starting','waiting_admission','recording','processing')
         and heartbeat_at < $1 for update skip locked`, [input.staleBefore],
      );
      for (const run of runs.rows) {
        await client.query(
          `update meeting_recorder_runs set state = 'failed', ended_at = now(), error_code = 'RECORDER_INTERRUPTED',
             error_message = 'Recorder perdeu o heartbeat.', updated_at = now() where id = $1`, [run.id],
        );
        await client.query(
          `update meetings set status = 'failed', failure_code = 'RECORDER_INTERRUPTED',
             failure_message = 'O processo de gravacao foi interrompido.', recording_ended_at = now(), status_changed_at = now(), updated_at = now()
           where id = $1 and tenant_id = $2 and status in ('queued','starting','waiting_admission','recording')`,
          [run.meeting_id, run.tenant_id],
        );
        await client.query(
          `update meeting_jobs set status = 'failed', last_error = 'recorder interrompido (heartbeat expirado)', locked_by = null,
             locked_until = null, updated_at = now() where id = $1 and status = 'running'`, [run.job_id],
        );
        await client.query(
          `update recorder_bot_accounts set status = 'error', current_meeting_id = null, current_recording_id = null,
             current_tenant_id = null, last_error = 'recorder interrompido', consecutive_failures = consecutive_failures + 1, updated_at = now()
           where id = $1 and current_meeting_id = $2`, [run.bot_account_id, run.meeting_id],
        );
        await client.query(
          `insert into meeting_audit_log (id, tenant_id, workspace_id, meeting_id, actor_user_id, action, details)
           select $1, tenant_id, workspace_id, id, owner_user_id, 'RECORDER_RELEASED',
             jsonb_build_object('recorderAccountId', $3::text, 'reason','RECORDER_INTERRUPTED') from meetings where id = $2`,
          [newId("maudit"), run.meeting_id, run.bot_account_id],
        );
      }
      return runs.rowCount ?? 0;
    });
  }

  async listRecorderBots(): Promise<RecorderBotAccount[]> {
    const result = await this.pool.query<RecorderBotRow>(`select * from recorder_bot_accounts where removed_at is null order by label, id`);
    return result.rows.map(toRecorderBot);
  }

  async listRecorderAccounts(filter: RecorderAccountListFilter): Promise<RecorderAccountWithContext[]> {
    const params: unknown[] = [];
    const conditions = [filter.includeRemoved ? "true" : "b.removed_at is null"];
    if (filter.tenantId) {
      params.push(filter.tenantId);
      conditions.push(`b.tenant_id = $${params.length} and b.ownership_type = 'customer_managed'`);
    }
    if (filter.workspaceId) {
      params.push(filter.workspaceId);
      conditions.push(`(b.workspace_id is null or b.workspace_id = $${params.length})`);
    }
    const result = await this.pool.query<RecorderBotRow & { current_meeting_title: string | null; workspace_name: string | null }>(
      `select b.*, m.title as current_meeting_title, w.name as workspace_name
       from recorder_bot_accounts b
       left join meetings m on m.id = b.current_meeting_id and m.tenant_id = b.current_tenant_id
       left join workspaces w on w.id = b.workspace_id
       where ${conditions.join(" and ")}
       order by b.tenant_id nulls first, b.label, b.id`,
      params,
    );
    return result.rows.map((row) => ({
      ...toRecorderBot(row),
      ...(row.current_meeting_title ? { currentMeetingTitle: row.current_meeting_title } : {}),
      ...(row.workspace_name ? { workspaceName: row.workspace_name } : {}),
    }));
  }

  async getRecorderAccount(input: { accountId: string; tenantId?: string }): Promise<RecorderBotAccount | undefined> {
    const result = await this.pool.query<RecorderBotRow>(
      `select * from recorder_bot_accounts where id = $1 and removed_at is null and ($2::text is null or (tenant_id = $2 and ownership_type = 'customer_managed'))`,
      [input.accountId, input.tenantId ?? null],
    );
    return result.rows[0] ? toRecorderBot(result.rows[0]) : undefined;
  }

  async createRecorderAccount(input: { id: string; tenantId: string; workspaceId?: string; createdByUserId: string; label: string; googleEmail: string; displayName: string }): Promise<{ ok: true; account: RecorderBotAccount } | { ok: false; reason: "DUPLICATE_EMAIL" }> {
    try {
      const result = await this.pool.query<RecorderBotRow>(
        `insert into recorder_bot_accounts (id, ownership_type, tenant_id, workspace_id, created_by_user_id, label, google_email, display_name, status)
         values ($1, 'customer_managed', $2, $3, $4, $5, $6, $7, 'disabled') returning *`,
        [input.id, input.tenantId, input.workspaceId ?? null, input.createdByUserId, input.label, input.googleEmail.trim().toLowerCase(), input.displayName],
      );
      return { ok: true, account: toRecorderBot(result.rows[0]!) };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, reason: "DUPLICATE_EMAIL" };
      throw error;
    }
  }

  async saveRecorderAccountSession(input: { accountId: string; tenantId: string; provisioningSessionId: string; workerId: string; encryptedSessionState?: string; status: RecorderBotStatus; health: Record<string, unknown>; checkedAt: Date; googleEmail?: string; lastError?: string }): Promise<RecorderBotAccount | undefined> {
    return this.tx(async (client) => {
      await client.query(`select id from recorder_bot_accounts where id = $1 and tenant_id = $2 for update`, [input.accountId, input.tenantId]);
      const session = await client.query<ProvisioningRow>(
        `select * from recorder_provisioning_sessions where id = $1 and tenant_id = $2 and recorder_account_id = $3
           and worker_id = $4 and status = 'live' and expires_at > now() for update`,
        [input.provisioningSessionId, input.tenantId, input.accountId, input.workerId],
      );
      const provisioning = session.rows[0];
      if (!provisioning || (input.status === "active" && !input.encryptedSessionState)) return undefined;
      const result = await client.query<RecorderBotRow>(
        `update recorder_bot_accounts set encrypted_session_state = case when $3 = 'active' then $2 else encrypted_session_state end,
           session_updated_at = case when $3 = 'active' then now() else session_updated_at end, status = $3, health = $4::jsonb,
           last_health_check_at = $5, google_email = coalesce($6, google_email), last_error = $7,
           consecutive_failures = 0, updated_at = now()
         where id = $1 and tenant_id = $8 and removed_at is null and status <> 'busy' and current_meeting_id is null returning *`,
        [input.accountId, input.status === "active" ? input.encryptedSessionState : null, input.status, JSON.stringify(input.health), input.checkedAt, input.status === "active" ? input.googleEmail?.trim().toLowerCase() ?? null : null, input.lastError?.slice(0, 2000) ?? null, input.tenantId],
      );
      if (!result.rows[0]) return undefined;
      if (input.status === "active") await client.query(`update recorder_provisioning_sessions set status = 'completed', completed_at = now(), updated_at = now() where id = $1`, [input.provisioningSessionId]);
      const action = input.status === "active" ? (provisioning.reconnect ? "RECORDER_RECONNECTED" : "RECORDER_CONNECTED") : "RECORDER_HEALTH_FAILED";
      const actions = input.status === "reauth_required" ? [action, "RECORDER_REAUTH_REQUIRED"] : [action];
      for (const event of actions) await client.query(
        `insert into meeting_audit_log (id, tenant_id, workspace_id, actor_user_id, action, details) values ($1,$2,$3,$4,$5,$6::jsonb)`,
        [newId("maudit"), input.tenantId, provisioning.workspace_id, provisioning.created_by_user_id, event, JSON.stringify({ recorderAccountId: input.accountId, sessionId: provisioning.id })],
      );
      return toRecorderBot(result.rows[0]);
    });
  }

  async removeRecorderAccount(input: { tenantId: string; accountId: string; actorUserId: string }): Promise<"removed" | "busy" | "not_found"> {
    return this.tx(async (client) => {
      const current = await client.query<{ status: string; current_meeting_id: string | null }>(
        `select status, current_meeting_id from recorder_bot_accounts where id = $1 and tenant_id = $2 and ownership_type = 'customer_managed' and removed_at is null for update`,
        [input.accountId, input.tenantId],
      );
      const row = current.rows[0];
      if (!row) return "not_found";
      if (row.status === "busy" || row.current_meeting_id) return "busy";
      // A sessão cifrada é APAGADA (não só escondida); o e-mail fica só para a auditoria.
      await client.query(
        `update recorder_bot_accounts set removed_at = now(), status = 'disabled', encrypted_session_state = null, credential_secret_ref = null,
           session_updated_at = now(), updated_at = now() where id = $1`,
        [input.accountId],
      );
      await client.query(
        `update recorder_provisioning_sessions set status = 'cancelled', completed_at = now(), updated_at = now() where recorder_account_id = $1 and status in ('pending','starting','live')`,
        [input.accountId],
      );
      return "removed";
    });
  }

  async setRecorderAccountEnabled(input: { tenantId: string; accountId: string; enabled: boolean }): Promise<RecorderBotAccount | "busy" | undefined> {
    return this.tx(async (client) => {
      const current = await client.query<RecorderBotRow>(
      `select * from recorder_bot_accounts where id = $1 and tenant_id = $2 and ownership_type = 'customer_managed'
         and removed_at is null for update`, [input.accountId, input.tenantId],
      );
      if (!current.rows[0]) return undefined;
      if (current.rows[0].status === "busy" || current.rows[0].current_meeting_id) return "busy";
      if (!input.enabled) await client.query(
      `update recorder_provisioning_sessions set status = 'cancelled', completed_at = now(), updated_at = now()
       where recorder_account_id = $1 and status in ('pending','starting','live')`, [input.accountId],
      );
    // Desativar = fora da seleção. Reativar = `disabled` + teste pendente: só o teste devolve `active`.
      const result = await client.query<RecorderBotRow>(
      `update recorder_bot_accounts set status = 'disabled',
         health = case when $3 then jsonb_build_object('status', 'pending', 'requestedAt', now()) else jsonb_build_object('status','disabled') end, updated_at = now()
       where id = $1 and tenant_id = $2 and removed_at is null and status <> 'busy' returning *`,
      [input.accountId, input.tenantId, input.enabled],
      );
      return result.rows[0] ? toRecorderBot(result.rows[0]) : "busy";
    });
  }

  async countActiveRecordings(tenantId: string): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      `select count(*) as n from meetings where tenant_id = $1 and deleted_at is null and status = any($2::text[])`, [tenantId, [...ACTIVE]],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async setHumanJoinIdentity(input: { tenantId: string; workspaceId: string; meetingId: string; humanJoinAccountEmail: string | null; source: HumanJoinIdentitySource | null; excludedRecorderEmails: string[] }): Promise<boolean> {
    const result = await this.pool.query(
      `update meetings set human_join_account_email = $4, human_join_identity_source = $5, excluded_recorder_emails = $6::text[], updated_at = now()
       where id = $1 and tenant_id = $2 and workspace_id = $3 and deleted_at is null and status = 'scheduled'`,
      [input.meetingId, input.tenantId, input.workspaceId, normalizeGoogleEmail(input.humanJoinAccountEmail) ?? null, input.source, input.excludedRecorderEmails],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async knownHumanGoogleEmails(input: { tenantId: string; userId: string }): Promise<{ connected: string[]; recentExplicit: string[] }> {
    const result = await this.pool.query<{ email: string; kind: "connected" | "explicit" }>(
      `select distinct lower(google_email) as email, 'connected' as kind from calendar_connections
         where tenant_id = $1 and user_id = $2 and google_email is not null
       union
       select distinct lower(human_join_account_email), 'explicit' from meetings where tenant_id = $1 and created_by_user_id = $2
         and human_join_identity_source = 'explicit' and human_join_account_email is not null and created_at > now() - interval '180 days'`,
      [input.tenantId, input.userId],
    );
    const pick = (kind: string) => [...new Set(result.rows.filter((row) => row.kind === kind).map((row) => row.email))].sort();
    return { connected: pick("connected"), recentExplicit: pick("explicit") };
  }

  async createProvisioningSession(input: { id: string; tenantId: string; workspaceId: string; recorderAccountId: string; createdByUserId: string; viewerTokenHash: string; expiresAt: Date }): Promise<RecorderProvisioningSession> {
    return this.tx(async (client) => {
      const account = await client.query<{ encrypted_session_state: string | null }>(
        `select encrypted_session_state from recorder_bot_accounts where id = $1 and tenant_id = $2
           and ownership_type = 'customer_managed' and removed_at is null and status <> 'busy'
           and current_meeting_id is null and (workspace_id is null or workspace_id = $3) for update`,
        [input.recorderAccountId, input.tenantId, input.workspaceId],
      );
      if (!account.rows[0]) throw new Error("RECORDER_ACCOUNT_UNAVAILABLE");
      const reconnect = Boolean(account.rows[0].encrypted_session_state);
      await client.query(
        `update recorder_bot_accounts set status = case when encrypted_session_state is null then 'disabled' else 'reauth_required' end,
           health = jsonb_build_object('status','provisioning'), updated_at = now() where id = $1`, [input.recorderAccountId],
      );
      // Uma sessão aberta por conta: a anterior (aba esquecida) é cancelada.
      await client.query(
        `update recorder_provisioning_sessions set status = 'cancelled', completed_at = now(), updated_at = now() where recorder_account_id = $1 and status in ('pending','starting','live')`,
        [input.recorderAccountId],
      );
      const result = await client.query<ProvisioningRow>(
        `insert into recorder_provisioning_sessions (id, tenant_id, workspace_id, recorder_account_id, created_by_user_id, viewer_token_hash, expires_at, reconnect)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [input.id, input.tenantId, input.workspaceId, input.recorderAccountId, input.createdByUserId, input.viewerTokenHash, input.expiresAt, reconnect],
      );
      return toProvisioning(result.rows[0]!);
    });
  }

  async getProvisioningSession(input: { sessionId: string; tenantId?: string }): Promise<RecorderProvisioningSession | undefined> {
    const result = await this.pool.query<ProvisioningRow>(
      `select * from recorder_provisioning_sessions where id = $1 and ($2::text is null or tenant_id = $2)`, [input.sessionId, input.tenantId ?? null],
    );
    return result.rows[0] ? toProvisioning(result.rows[0]) : undefined;
  }

  async findProvisioningSessionByViewerHash(viewerTokenHash: string): Promise<RecorderProvisioningSession | undefined> {
    const result = await this.pool.query<ProvisioningRow>(`select * from recorder_provisioning_sessions where viewer_token_hash = $1`, [viewerTokenHash]);
    return result.rows[0] ? toProvisioning(result.rows[0]) : undefined;
  }

  async consumeProvisioningViewer(input: { sessionId: string; viewerTokenHash: string; tenantId: string; userId: string; now: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `update recorder_provisioning_sessions set viewer_consumed_at = $5, updated_at = now()
       where id = $1 and viewer_token_hash = $2 and tenant_id = $3 and created_by_user_id = $4
         and single_use = true and viewer_consumed_at is null and expires_at > $5
         and status in ('pending','starting','live')`,
      [input.sessionId, input.viewerTokenHash, input.tenantId, input.userId, input.now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimProvisioningSession(input: { workerId: string; workerEndpoint: string; now: Date }): Promise<(RecorderProvisioningSession & { expectedGoogleEmail: string }) | undefined> {
    const result = await this.pool.query<ProvisioningRow & { google_email: string }>(
      `update recorder_provisioning_sessions s set status = 'starting', worker_id = $1, worker_endpoint = $2, updated_at = now()
       from recorder_bot_accounts b
       where s.id = (select id from recorder_provisioning_sessions where status = 'pending' and expires_at > $3
                     order by created_at for update skip locked limit 1)
         and s.status = 'pending' and b.id = s.recorder_account_id and b.tenant_id = s.tenant_id and b.removed_at is null
         and b.current_meeting_id is null and b.status <> 'busy'
       returning s.*, b.google_email`,
      [input.workerId, input.workerEndpoint, input.now],
    );
    const row = result.rows[0];
    return row ? { ...toProvisioning(row), expectedGoogleEmail: row.google_email } : undefined;
  }

  async updateProvisioningSession(input: { sessionId: string; status: RecorderProvisioningSession["status"]; workerId?: string; errorCode?: string; errorMessage?: string }): Promise<boolean> {
    const result = await this.pool.query(
      `update recorder_provisioning_sessions set status = $2, error_code = coalesce($4, error_code), error_message = coalesce($5, error_message),
         completed_at = case when $2 in ('completed','failed','expired','cancelled') then coalesce(completed_at, now()) else completed_at end, updated_at = now()
       where id = $1 and ($3::text is null or worker_id = $3) and status not in ('completed','failed','expired','cancelled')`,
      [input.sessionId, input.status, input.workerId ?? null, input.errorCode ?? null, input.errorMessage?.slice(0, 500) ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async expireProvisioningSessions(now: Date): Promise<number> {
    const result = await this.pool.query(
      `update recorder_provisioning_sessions set status = 'expired', completed_at = now(), updated_at = now()
       where status in ('pending','starting','live') and expires_at <= $1`, [now],
    );
    return result.rowCount ?? 0;
  }

  async getRecorderBotSession(botId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ encrypted_session_state: string | null }>(
      `select encrypted_session_state from recorder_bot_accounts where id = $1 and status <> 'busy' and removed_at is null`, [botId],
    );
    return result.rows[0]?.encrypted_session_state ?? undefined;
  }

  /** Pool interno (`vorix_managed`, preparado) — fallback administrativo, fora da seleção comercial. */
  async upsertRecorderBot(input: { id: string; label: string; googleEmail: string; displayName: string; encryptedSessionState?: string; status: RecorderBotStatus }): Promise<RecorderBotAccount> {
    const result = await this.pool.query<RecorderBotRow>(
      `insert into recorder_bot_accounts (id, label, google_email, display_name, encrypted_session_state, status, session_updated_at)
       values ($1,$2,$3,$4,$5,$6,case when $5::text is null then null else now() end)
       on conflict (id) do update set label = excluded.label, google_email = excluded.google_email,
         display_name = excluded.display_name,
         encrypted_session_state = coalesce(excluded.encrypted_session_state, recorder_bot_accounts.encrypted_session_state),
         session_updated_at = case when excluded.encrypted_session_state is null then recorder_bot_accounts.session_updated_at else now() end,
         status = excluded.status, last_error = null, updated_at = now()
       where recorder_bot_accounts.ownership_type = 'vorix_managed' and recorder_bot_accounts.status <> 'busy'
         and recorder_bot_accounts.current_meeting_id is null
       returning *`,
      [input.id, input.label, input.googleEmail.toLowerCase(), input.displayName, input.encryptedSessionState ?? null, input.status],
    );
    if (!result.rows[0]) throw new Error("RECORDER_BOT_BUSY_OR_CUSTOMER_MANAGED");
    return toRecorderBot(result.rows[0]);
  }

  async updateRecorderBotStatus(input: { botId: string; status: RecorderBotStatus; health?: Record<string, unknown>; lastError?: string; checkedAt?: Date; expectedHealth?: { requestedAt?: string } }): Promise<RecorderBotAccount | undefined> {
    const result = await this.pool.query<RecorderBotRow>(
      `update recorder_bot_accounts set status = $2, health = coalesce($3::jsonb, health), last_error = $4,
         last_health_check_at = coalesce($5, last_health_check_at), updated_at = now()
       where id = $1 and removed_at is null and (status <> 'busy' or $2 = 'busy')
         and (not $6::boolean or (health->>'status' = 'pending' and ($7::text is null or health->>'requestedAt' = $7)))
         and not exists (select 1 from recorder_provisioning_sessions s where s.recorder_account_id = $1 and s.status in ('pending','starting','live')) returning *`,
      [input.botId, input.status, input.health ? JSON.stringify(input.health) : null, input.lastError?.slice(0, 2000) ?? null, input.checkedAt ?? null, Boolean(input.expectedHealth), input.expectedHealth?.requestedAt ?? null],
    );
    return result.rows[0] ? toRecorderBot(result.rows[0]) : undefined;
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

  async recordUsage(input: Parameters<MeetingRepositoryPort["recordUsage"]>[0]): Promise<void> {
    const d = input.delta;
    await this.pool.query(
      `insert into meeting_usage_monthly (tenant_id, period, recording_seconds, meetings_recorded, transcription_seconds, storage_bytes, ai_analyses, concurrent_peak,
         bot_wait_seconds, admission_wait_seconds, capture_failures, browser_failures, ffmpeg_failures, bytes_recorded)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (tenant_id, period) do update set
         recording_seconds = meeting_usage_monthly.recording_seconds + excluded.recording_seconds,
         meetings_recorded = meeting_usage_monthly.meetings_recorded + excluded.meetings_recorded,
         transcription_seconds = meeting_usage_monthly.transcription_seconds + excluded.transcription_seconds,
         storage_bytes = meeting_usage_monthly.storage_bytes + excluded.storage_bytes,
         ai_analyses = meeting_usage_monthly.ai_analyses + excluded.ai_analyses,
         concurrent_peak = greatest(meeting_usage_monthly.concurrent_peak, excluded.concurrent_peak),
         bot_wait_seconds = meeting_usage_monthly.bot_wait_seconds + excluded.bot_wait_seconds,
         admission_wait_seconds = meeting_usage_monthly.admission_wait_seconds + excluded.admission_wait_seconds,
         capture_failures = meeting_usage_monthly.capture_failures + excluded.capture_failures,
         browser_failures = meeting_usage_monthly.browser_failures + excluded.browser_failures,
         ffmpeg_failures = meeting_usage_monthly.ffmpeg_failures + excluded.ffmpeg_failures,
         bytes_recorded = meeting_usage_monthly.bytes_recorded + excluded.bytes_recorded,
         updated_at = now()`,
      [input.tenantId, input.period, d.recordingSeconds ?? 0, d.meetingsRecorded ?? 0, d.transcriptionSeconds ?? 0,
        d.storageBytes ?? 0, d.aiAnalyses ?? 0, d.concurrentPeak ?? 0, d.botWaitSeconds ?? 0,
        d.admissionWaitSeconds ?? 0, d.captureFailures ?? 0, d.browserFailures ?? 0,
        d.ffmpegFailures ?? 0, d.bytesRecorded ?? 0],
    );
  }

  // ── Fila ──────────────────────────────────────────────────────────────────────────────────

  async claimJob(input: { kinds: readonly MeetingJobKind[]; workerId: string; leaseMs: number }): Promise<MeetingJob | undefined> {
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await this.pool.query<JobRow>(
        `update meeting_jobs j set status = 'running', locked_by = $2, claimed_at = now(), heartbeat_at = now(),
           locked_until = now() + ($3::int * interval '1 millisecond'), attempts = j.attempts + 1, updated_at = now()
         where j.id = (
           select id from meeting_jobs
           where kind = any($1::text[])
             and ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now()))
           order by run_at, created_at
           for update skip locked
           limit 1)
         returning j.*`,
        [input.kinds, input.workerId, input.leaseMs],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      // Lease expirado de um worker que morreu já na última tentativa: não roda de novo, falha.
      if (row.attempts > row.max_attempts) {
        await this.pool.query(`update meeting_jobs set status = 'failed', last_error = coalesce(last_error, 'tentativas esgotadas (worker interrompido)'), locked_by = null, locked_until = null, updated_at = now() where id = $1`, [row.id]);
        continue;
      }
      return toJob(row);
    }
    return undefined;
  }

  async heartbeatJob(input: { jobId: string; workerId: string; leaseMs: number }): Promise<boolean> {
    const result = await this.pool.query(
      `update meeting_jobs set heartbeat_at = now(), locked_until = now() + ($3::int * interval '1 millisecond'), updated_at = now()
       where id = $1 and locked_by = $2 and status = 'running'`,
      [input.jobId, input.workerId, input.leaseMs],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async completeJob(input: { jobId: string; workerId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `update meeting_jobs set status = 'completed', locked_until = null, last_error = null, updated_at = now() where id = $1 and locked_by = $2 and status = 'running'`,
      [input.jobId, input.workerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async cancelJob(input: { jobId: string; workerId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `update meeting_jobs set status = 'cancelled', locked_by = null, locked_until = null, updated_at = now()
       where id = $1 and locked_by = $2 and status = 'running'`, [input.jobId, input.workerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async failJob(input: { jobId: string; workerId: string; error: string; retryDelayMs: number; final?: boolean }): Promise<{ finalFailure: boolean }> {
    const result = await this.pool.query<{ status: string }>(
      `update meeting_jobs set
         status = case when $5 or attempts >= max_attempts then 'failed' else 'queued' end,
         run_at = case when $5 or attempts >= max_attempts then run_at else now() + ($4::int * interval '1 millisecond') end,
         last_error = $3, locked_by = null, locked_until = null, updated_at = now()
       where id = $1 and locked_by = $2 and status = 'running' returning status`,
      [input.jobId, input.workerId, input.error.slice(0, 2000), input.retryDelayMs, input.final ?? false],
    );
    return { finalFailure: result.rows[0]?.status === "failed" };
  }

  async reopenForReprocessing(input: { tenantId: string; meetingId: string; status: "processing" | "analyzing" }): Promise<void> {
    await this.pool.query(
      `update meetings set status = $3, failure_code = null, failure_message = null, status_changed_at = now(), updated_at = now()
       where id = $1 and tenant_id = $2 and deleted_at is null and status in ('processing', 'transcribing', 'analyzing', 'completed', 'failed')`,
      [input.meetingId, input.tenantId, input.status],
    );
  }

  // ── Transcrição ───────────────────────────────────────────────────────────────────────────

  async getRecordingById(input: { tenantId: string; recordingId: string }): Promise<MeetingRecording | undefined> {
    const result = await this.pool.query<RecordingRow>(`select * from meeting_recordings where id = $1 and tenant_id = $2`, [input.recordingId, input.tenantId]);
    return result.rows[0] ? toRecording(result.rows[0]) : undefined;
  }

  async startTranscript(input: { tenantId: string; meetingId: string; recordingId: string }): Promise<void> {
    await this.pool.query(
      `update meeting_transcripts set status = 'running', attempts = attempts + 1, recording_id = $3, updated_at = now() where meeting_id = $1 and tenant_id = $2`,
      [input.meetingId, input.tenantId, input.recordingId],
    );
    await this.pool.query(
      `update meetings set status = 'transcribing', status_changed_at = now(), updated_at = now() where id = $1 and tenant_id = $2 and status in ('processing', 'transcribing', 'analyzing', 'completed')`,
      [input.meetingId, input.tenantId],
    );
  }

  async saveTranscript(input: { tenantId: string; meetingId: string; recordingId: string; result: TranscriptionResult }): Promise<{ transcriptId: string }> {
    return this.tx(async (client) => {
      const transcript = await client.query<{ id: string }>(`select id from meeting_transcripts where meeting_id = $1 and tenant_id = $2 for update`, [input.meetingId, input.tenantId]);
      const transcriptId = transcript.rows[0]?.id ?? newId("mtrans");
      if (!transcript.rows[0]) {
        await client.query(`insert into meeting_transcripts (id, meeting_id, tenant_id, status, recording_id) values ($1, $2, $3, 'running', $4)`, [transcriptId, input.meetingId, input.tenantId, input.recordingId]);
      }
      // Retranscrever SUBSTITUI os segmentos — nunca acumula duplicados.
      await client.query(`delete from meeting_transcript_segments where transcript_id = $1`, [transcriptId]);
      const segments = input.result.segments;
      for (let start = 0; start < segments.length; start += 200) {
        const chunk = segments.slice(start, start + 200);
        const values: unknown[] = [];
        const rows = chunk.map((segment, index) => {
          values.push(newId("mseg"), transcriptId, input.meetingId, input.tenantId, start + index, Math.max(0, Math.round(segment.startMs)), Math.max(Math.round(segment.startMs), Math.round(segment.endMs)), segment.speaker ?? null, segment.text, segment.confidence ?? null);
          const b = values.length - 10;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
        });
        await client.query(`insert into meeting_transcript_segments (id, transcript_id, meeting_id, tenant_id, seq, start_ms, end_ms, speaker, text, confidence) values ${rows.join(",")}`, values);
      }
      await client.query(
        `update meeting_transcripts set status = 'completed', language = $2, engine = $3, model = $4, full_text = $5, segment_count = $6,
           processing_ms = $7, last_error = null, metadata = $8::jsonb, recording_id = $9, completed_at = now(), updated_at = now()
         where id = $1`,
        [transcriptId, input.result.language, input.result.engine, input.result.model, segments.map((segment) => segment.text.trim()).join(" "), segments.length, input.result.processingMs, JSON.stringify(input.result.metrics), input.recordingId],
      );
      return { transcriptId };
    });
  }

  async failTranscript(input: { tenantId: string; meetingId: string; error: string; final: boolean }): Promise<void> {
    await this.pool.query(
      `update meeting_transcripts set status = case when $3 then 'failed' else 'queued' end, last_error = $4, updated_at = now() where meeting_id = $1 and tenant_id = $2`,
      [input.meetingId, input.tenantId, input.final, input.error.slice(0, 2000)],
    );
  }

  async setRecordingDuration(input: { tenantId: string; recordingId: string; meetingId: string; durationSeconds: number }): Promise<void> {
    await this.pool.query(`update meeting_recordings set duration_seconds = $3 where id = $1 and tenant_id = $2`, [input.recordingId, input.tenantId, input.durationSeconds]);
    await this.pool.query(`update meetings set duration_seconds = $3, updated_at = now() where id = $1 and tenant_id = $2 and duration_seconds is null`, [input.meetingId, input.tenantId, Math.round(input.durationSeconds)]);
  }

  // ── Análise ───────────────────────────────────────────────────────────────────────────────

  async getTranscriptForAnalysis(input: { tenantId: string; meetingId: string }): Promise<{ transcriptId: string; status: string; segments: MeetingTranscriptSegment[] } | undefined> {
    const transcript = await this.pool.query<{ id: string; status: string; workspace_id: string }>(
      `select t.id, t.status, m.workspace_id from meeting_transcripts t join meetings m on m.id = t.meeting_id where t.meeting_id = $1 and t.tenant_id = $2 and m.deleted_at is null`,
      [input.meetingId, input.tenantId],
    );
    const row = transcript.rows[0];
    if (!row) return undefined;
    const segments = await this.getTranscriptSegments({ tenantId: input.tenantId, workspaceId: row.workspace_id, meetingId: input.meetingId });
    return { transcriptId: row.id, status: row.status, segments };
  }

  async operationCreditsCost(operationCode: string): Promise<number> {
    const result = await this.pool.query<{ credits_cost: number }>(`select credits_cost from ai_operation_types where code = $1`, [operationCode]);
    return result.rows[0]?.credits_cost ?? 0;
  }

  async saveAnalysis(input: Parameters<MeetingRepositoryPort["saveAnalysis"]>[0]): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        `insert into meeting_analyses (id, meeting_id, tenant_id, workspace_id, status, result, credits_charged, model, idempotency_key, requested_by_user_id, error, transcript_id, job_id)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13) on conflict (idempotency_key) do nothing`,
        [input.id, input.meetingId, input.tenantId, input.workspaceId, input.status, input.result ? JSON.stringify(input.result) : null, input.creditsCharged, input.model ?? null, input.idempotencyKey, input.requestedByUserId ?? null, input.error ?? null, input.transcriptId ?? null, input.jobId ?? null],
      );
      for (const item of input.items ?? []) {
        await client.query(
          `insert into meeting_action_items (id, meeting_id, analysis_id, tenant_id, workspace_id, type, description, assignee_name, due_date, source_timestamp_ms, confidence)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [newId("mitem"), input.meetingId, input.id, input.tenantId, input.workspaceId, item.type, item.description, item.assigneeName ?? null, item.dueDate ?? null, item.sourceTimestampMs ?? null, item.confidence ?? null],
        );
      }
    });
  }

  async decideActionItem(input: { tenantId: string; workspaceId: string; meetingId: string; itemId: string; status: "confirmed" | "dismissed"; actorUserId: string }): Promise<MeetingActionItem | undefined> {
    const result = await this.pool.query<ActionItemRow>(
      `update meeting_action_items set status = $5, decided_by_user_id = $6, decided_at = now()
       where id = $1 and meeting_id = $2 and tenant_id = $3 and workspace_id = $4 returning *`,
      [input.itemId, input.meetingId, input.tenantId, input.workspaceId, input.status, input.actorUserId],
    );
    return result.rows[0] ? toActionItem(result.rows[0]) : undefined;
  }

  // ── Retenção ──────────────────────────────────────────────────────────────────────────────

  async listExpiredRecordings(input: { now: Date; defaultRetentionDays: number; limit: number }): Promise<(MeetingRecording & { tenantId: string; workspaceId: string; retentionDays: number })[]> {
    const result = await this.pool.query<RecordingRow & { tenant_id: string; workspace_id: string; retention_days: number }>(
      `select r.*, r.tenant_id, r.workspace_id, x.retention_days from meeting_recordings r
       cross join lateral (
         select coalesce((select (se.limits->>'meetingRetentionDays')::int from solution_entitlements se
                           where se.tenant_id = r.tenant_id and se.solution_key = 'meetings' and se.limits ? 'meetingRetentionDays'), $2) as retention_days
       ) x
       where r.status = 'available' and r.created_at < $1::timestamptz - (x.retention_days * interval '1 day')
       order by r.created_at limit $3`,
      [input.now, input.defaultRetentionDays, input.limit],
    );
    return result.rows.map((row) => ({ ...toRecording(row), tenantId: row.tenant_id, workspaceId: row.workspace_id, retentionDays: row.retention_days }));
  }

  async markRecordingPurged(input: { recordingId: string }): Promise<boolean> {
    const result = await this.pool.query(`update meeting_recordings set status = 'purged', purged_at = now() where id = $1 and status = 'available'`, [input.recordingId]);
    return (result.rowCount ?? 0) > 0;
  }

  // ── Auto-gravação ─────────────────────────────────────────────────────────────────────────

  async listAutoRecordDue(input: { now: Date; defaults: AutoRecordWindow; limit: number }): Promise<Meeting[]> {
    const result = await this.pool.query<MeetingRow>(
      `select m.*, coalesce(m.meeting_url, (select ce.meet_link from calendar_events ce where ce.id = m.calendar_event_id)) as meeting_url
       from meetings m
       where m.auto_record and m.status = 'scheduled' and m.deleted_at is null and m.auto_record_evaluated_at is null
         and m.scheduled_start_at is not null
         and $1::timestamptz >= m.scheduled_start_at - (coalesce(m.join_before_minutes, $2) * interval '1 minute')
       order by m.scheduled_start_at limit $3`,
      [input.now, input.defaults.joinBeforeMinutes, input.limit],
    );
    return result.rows.map(toMeeting);
  }

  async markAutoRecordEvaluated(input: { meetingId: string; outcome: string }): Promise<boolean> {
    const result = await this.pool.query(
      `update meetings set auto_record_evaluated_at = now(), auto_record_outcome = $2, updated_at = now() where id = $1 and auto_record_evaluated_at is null`,
      [input.meetingId, input.outcome],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countOverlappingAutoRecordMeetings(input: { tenantId: string; startAt: string; endAt: string }): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      `select count(*) as n from meetings where tenant_id = $1 and auto_record and deleted_at is null
         and status not in ('failed','cancelled') and scheduled_start_at < $3::timestamptz
         and scheduled_end_at > $2::timestamptz`,
      [input.tenantId, input.startAt, input.endAt],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  // ── Vínculo com a Agenda ──────────────────────────────────────────────────────────────────

  async updateScheduleFromEvent(input: { tenantId: string; calendarEventId: string; title: string; scheduledStartAt: string; scheduledEndAt: string; meetingUrl?: string }): Promise<void> {
    await this.pool.query(
      `update meetings set title = $3, scheduled_start_at = $4, scheduled_end_at = $5, meeting_url = coalesce($6, meeting_url),
         auto_record_evaluated_at = null, auto_record_outcome = null, updated_at = now()
       where tenant_id = $1 and calendar_event_id = $2 and status = 'scheduled' and deleted_at is null`,
      [input.tenantId, input.calendarEventId, input.title, input.scheduledStartAt, input.scheduledEndAt, input.meetingUrl ?? null],
    );
  }

  async cancelForEvent(input: { tenantId: string; calendarEventId: string }): Promise<void> {
    await this.pool.query(
      `update meetings set status = 'cancelled', status_changed_at = now(), updated_at = now() where tenant_id = $1 and calendar_event_id = $2 and status = 'scheduled' and deleted_at is null`,
      [input.tenantId, input.calendarEventId],
    );
  }

  async meetingIdsForEvents(input: { tenantId: string; eventIds: readonly string[] }): Promise<Record<string, string>> {
    if (input.eventIds.length === 0) return {};
    const result = await this.pool.query<{ id: string; calendar_event_id: string }>(
      `select id, calendar_event_id from meetings where tenant_id = $1 and calendar_event_id = any($2::text[]) and deleted_at is null`,
      [input.tenantId, [...input.eventIds]],
    );
    return Object.fromEntries(result.rows.map((row) => [row.calendar_event_id, row.id]));
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
    ...(row.join_before_minutes !== null && row.join_before_minutes !== undefined ? { joinBeforeMinutes: row.join_before_minutes } : {}),
    ...(row.join_grace_minutes !== null && row.join_grace_minutes !== undefined ? { joinGraceMinutes: row.join_grace_minutes } : {}),
    ...(row.auto_record_outcome ? { autoRecordOutcome: row.auto_record_outcome } : {}),
    ...(row.bot_account_id ? { botAccountId: row.bot_account_id } : {}),
    ...(row.bot_joined_at ? { botJoinedAt: iso(row.bot_joined_at) } : {}),
    ...(row.recording_started_at ? { recordingStartedAt: iso(row.recording_started_at) } : {}),
    ...(row.recording_ended_at ? { recordingEndedAt: iso(row.recording_ended_at) } : {}),
    ...(row.duration_seconds !== null ? { durationSeconds: row.duration_seconds } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    ...(row.human_join_account_email ? { humanJoinAccountEmail: row.human_join_account_email } : {}),
    ...(row.human_join_identity_source ? { humanJoinIdentitySource: row.human_join_identity_source } : {}),
    excludedRecorderEmails: row.excluded_recorder_emails ?? [],
    captureStrategy: row.capture_strategy ?? "vorix_recorder",
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
    ...(row.video_codec ? { videoCodec: row.video_codec } : {}),
    ...(row.audio_codec ? { audioCodec: row.audio_codec } : {}),
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    checksumSha256: row.checksum_sha256,
    ...(row.original_file_name ? { originalFileName: row.original_file_name } : {}),
    status: row.status,
    ...(row.purged_at ? { purgedAt: row.purged_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

type RecorderBotRow = {
  id: string;
  ownership_type: RecorderBotAccount["ownershipType"];
  tenant_id: string | null;
  workspace_id: string | null;
  created_by_user_id: string | null;
  label: string;
  google_email: string;
  display_name: string;
  status: RecorderBotStatus;
  credential_secret_ref: string | null;
  encrypted_session_state: string | null;
  current_meeting_id: string | null;
  current_recording_id: string | null;
  current_tenant_id: string | null;
  last_used_at: Date | null;
  last_health_check_at: Date | null;
  last_error: string | null;
  health: Record<string, unknown>;
  consecutive_failures: number;
  created_at: Date;
  updated_at: Date;
};

type ProvisioningRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  recorder_account_id: string;
  created_by_user_id: string;
  single_use: boolean;
  reconnect: boolean;
  status: RecorderProvisioningSession["status"];
  worker_id: string | null;
  worker_endpoint: string | null;
  error_code: string | null;
  error_message: string | null;
  expires_at: Date;
  completed_at: Date | null;
  created_at: Date;
};

function toProvisioning(row: ProvisioningRow): RecorderProvisioningSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    recorderAccountId: row.recorder_account_id,
    createdByUserId: row.created_by_user_id,
    singleUse: row.single_use,
    reconnect: row.reconnect,
    status: row.status,
    ...(row.worker_id ? { workerId: row.worker_id } : {}),
    ...(row.worker_endpoint ? { workerEndpoint: row.worker_endpoint } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    expiresAt: row.expires_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

function toRecorderBot(row: RecorderBotRow): RecorderBotAccount {
  return {
    id: row.id,
    ownershipType: row.ownership_type ?? "vorix_managed",
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.created_by_user_id ? { createdByUserId: row.created_by_user_id } : {}),
    label: row.label,
    googleEmail: row.google_email,
    displayName: row.display_name,
    status: row.status,
    ...(row.credential_secret_ref ? { credentialSecretRef: row.credential_secret_ref } : {}),
    hasEncryptedSessionState: Boolean(row.encrypted_session_state),
    ...(row.current_meeting_id ? { currentMeetingId: row.current_meeting_id } : {}),
    ...(row.current_recording_id ? { currentRecordingId: row.current_recording_id } : {}),
    ...(row.current_tenant_id ? { currentTenantId: row.current_tenant_id } : {}),
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at.toISOString() } : {}),
    ...(row.last_health_check_at ? { lastHealthCheckAt: row.last_health_check_at.toISOString() } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    health: row.health ?? {},
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

type RecorderRunRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  meeting_id: string;
  recording_id: string | null;
  job_id: string;
  bot_account_id: string;
  worker_id: string;
  state: RecorderRun["state"];
  browser_pid: number | null;
  ffmpeg_pid: number | null;
  virtual_display: string | null;
  audio_sink: string | null;
  temp_dir: string | null;
  started_at: Date;
  heartbeat_at: Date | null;
  actual_joined_at: Date | null;
  ended_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  ffmpeg_exit_code: number | null;
  browser_exit_reason: string | null;
  bytes_produced: string | null;
  duration_seconds: string | null;
  metrics: Record<string, unknown>;
};

function toRecorderRun(row: RecorderRunRow): RecorderRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    meetingId: row.meeting_id,
    ...(row.recording_id ? { recordingId: row.recording_id } : {}),
    jobId: row.job_id,
    botAccountId: row.bot_account_id,
    workerId: row.worker_id,
    state: row.state,
    ...(row.browser_pid !== null ? { browserPid: row.browser_pid } : {}),
    ...(row.ffmpeg_pid !== null ? { ffmpegPid: row.ffmpeg_pid } : {}),
    ...(row.virtual_display ? { display: row.virtual_display } : {}),
    ...(row.audio_sink ? { audioSink: row.audio_sink } : {}),
    ...(row.temp_dir ? { tempDir: row.temp_dir } : {}),
    startedAt: row.started_at.toISOString(),
    ...(row.heartbeat_at ? { heartbeatAt: row.heartbeat_at.toISOString() } : {}),
    ...(row.actual_joined_at ? { actualJoinedAt: row.actual_joined_at.toISOString() } : {}),
    ...(row.ended_at ? { endedAt: row.ended_at.toISOString() } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.ffmpeg_exit_code !== null ? { ffmpegExitCode: row.ffmpeg_exit_code } : {}),
    ...(row.browser_exit_reason ? { browserExitReason: row.browser_exit_reason } : {}),
    ...(row.bytes_produced !== null ? { bytesProduced: Number(row.bytes_produced) } : {}),
    ...(row.duration_seconds !== null ? { durationSeconds: Number(row.duration_seconds) } : {}),
    metrics: row.metrics ?? {},
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

type JobRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  meeting_id: string;
  recording_id: string | null;
  kind: MeetingJobKind;
  attempts: number;
  max_attempts: number;
  locked_by: string;
  locked_until: Date;
};

function toJob(row: JobRow): MeetingJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    meetingId: row.meeting_id,
    ...(row.recording_id ? { recordingId: row.recording_id } : {}),
    kind: row.kind,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lockedBy: row.locked_by,
    lockedUntil: row.locked_until.toISOString(),
  };
}

type ActionItemRow = {
  id: string;
  analysis_id: string;
  type: MeetingActionItemType;
  description: string;
  assignee_name: string | null;
  due_date: string | null;
  source_timestamp_ms: number | null;
  confidence: string | null;
  status: MeetingActionItem["status"];
};

function toActionItem(row: ActionItemRow): MeetingActionItem {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    type: row.type,
    description: row.description,
    ...(row.assignee_name ? { assigneeName: row.assignee_name } : {}),
    ...(row.due_date ? { dueDate: row.due_date } : {}),
    ...(row.source_timestamp_ms !== null ? { sourceTimestampMs: row.source_timestamp_ms } : {}),
    ...(row.confidence !== null ? { confidence: Number(row.confidence) } : {}),
    status: row.status,
  };
}
