import type { Pool } from "pg";
import type {
  MeetingClipRecord,
  MeetingCommentRecord,
  MeetingInsightsRecord,
  MeetingInsightsRepositoryPort,
  MeetingQuestionRecord,
  MeetingSearchHit,
  MeetingShareRecord,
  MeetingTenantSettings,
  MeetingUserPreferences,
} from "../../../application/ports/meeting-insights-repository.port.js";
import { isMeetingSummaryTemplate, type AutoRecordMode, type MeetingKeywordTracker } from "../../../domain/meetings/meeting-intelligence.js";

const DEFAULT_CONSENT = "Olá! Esta reunião está sendo gravada e transcrita pelo Vorix para registro e geração de resumo. Se não concordar, avise o organizador.";

type ShareRow = {
  id: string; tenant_id: string; workspace_id: string; meeting_id: string; include_transcript: boolean; include_recording: boolean;
  expires_at: Date | null; revoked_at: Date | null; created_by: string; view_count: number; last_viewed_at: Date | null; created_at: Date;
};

function toShare(row: ShareRow): MeetingShareRecord {
  return {
    id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, meetingId: row.meeting_id, includeTranscript: row.include_transcript, includeRecording: row.include_recording,
    ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}), ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
    createdBy: row.created_by, viewCount: row.view_count, ...(row.last_viewed_at ? { lastViewedAt: row.last_viewed_at.toISOString() } : {}), createdAt: row.created_at.toISOString(),
  };
}

/** Palavras significativas da pergunta → consulta "OU" para achar os trechos relevantes. */
function searchTerms(query: string): string[] {
  const stop = new Set(["como", "qual", "quais", "quando", "onde", "quem", "para", "pela", "pelo", "sobre", "isso", "esse", "essa", "esta", "este", "foram", "foi", "tem", "teve", "uma", "umas", "uns", "das", "dos", "que", "com", "sem", "mais", "menos", "muito", "nossa", "nosso", "reuniao", "reunião", "reunioes", "reuniões", "falou", "falaram", "disse", "disseram"]);
  return [...new Set(query.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !stop.has(word)))].slice(0, 12);
}

export class PostgresMeetingInsightsRepository implements MeetingInsightsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getInsights(input: { tenantId: string; meetingId: string }): Promise<MeetingInsightsRecord | undefined> {
    const result = await this.pool.query<{ meeting_id: string; summary_template: string; crm_contact_id: string | null; crm_deal_id: string | null; follow_up: MeetingInsightsRecord["followUp"] | null }>(
      "select * from meeting_insights where tenant_id = $1 and meeting_id = $2",
      [input.tenantId, input.meetingId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      meetingId: row.meeting_id,
      summaryTemplate: isMeetingSummaryTemplate(row.summary_template) ? row.summary_template : "general",
      ...(row.crm_contact_id ? { crmContactId: row.crm_contact_id } : {}),
      ...(row.crm_deal_id ? { crmDealId: row.crm_deal_id } : {}),
      ...(row.follow_up ? { followUp: row.follow_up } : {}),
    };
  }

  async upsertInsights(input: Parameters<MeetingInsightsRepositoryPort["upsertInsights"]>[0]): Promise<MeetingInsightsRecord> {
    const patch = input.patch;
    await this.pool.query(
      `insert into meeting_insights (meeting_id, tenant_id, workspace_id, summary_template, crm_contact_id, crm_deal_id, follow_up, follow_up_generated_at)
       values ($1, $2, $3, coalesce($4, (select p.default_template from meetings m join meeting_user_preferences p on p.tenant_id = m.tenant_id and p.user_id = m.owner_user_id where m.id = $1), 'general'), $5, $6, $7::jsonb, case when $7::jsonb is null then null else now() end)
       on conflict (meeting_id) do update set
         summary_template = coalesce($4, meeting_insights.summary_template),
         crm_contact_id = case when $8 then $5 else meeting_insights.crm_contact_id end,
         crm_deal_id = case when $9 then $6 else meeting_insights.crm_deal_id end,
         follow_up = coalesce($7::jsonb, meeting_insights.follow_up),
         follow_up_generated_at = case when $7::jsonb is null then meeting_insights.follow_up_generated_at else now() end,
         updated_at = now()`,
      [
        input.meetingId, input.tenantId, input.workspaceId, patch.summaryTemplate ?? null, patch.crmContactId ?? null, patch.crmDealId ?? null,
        patch.followUp ? JSON.stringify(patch.followUp) : null, patch.crmContactId !== undefined, patch.crmDealId !== undefined,
      ],
    );
    return (await this.getInsights({ tenantId: input.tenantId, meetingId: input.meetingId }))!;
  }

  async listSpeakerNames(input: { tenantId: string; meetingId: string }): Promise<Map<string, string>> {
    const result = await this.pool.query<{ speaker_key: string; display_name: string }>("select speaker_key, display_name from meeting_speaker_names where tenant_id = $1 and meeting_id = $2", [input.tenantId, input.meetingId]);
    return new Map(result.rows.map((row) => [row.speaker_key, row.display_name]));
  }

  async setSpeakerName(input: { tenantId: string; meetingId: string; speakerKey: string; displayName: string | null; userId: string }): Promise<void> {
    if (!input.displayName) {
      await this.pool.query("delete from meeting_speaker_names where tenant_id = $1 and meeting_id = $2 and speaker_key = $3", [input.tenantId, input.meetingId, input.speakerKey]);
      return;
    }
    await this.pool.query(
      `insert into meeting_speaker_names (meeting_id, tenant_id, speaker_key, display_name, updated_by) values ($1, $2, $3, $4, $5)
       on conflict (meeting_id, speaker_key) do update set display_name = excluded.display_name, updated_by = excluded.updated_by, updated_at = now()`,
      [input.meetingId, input.tenantId, input.speakerKey, input.displayName, input.userId],
    );
  }

  async saveQuestion(input: Parameters<MeetingInsightsRepositoryPort["saveQuestion"]>[0]): Promise<MeetingQuestionRecord> {
    const result = await this.pool.query<{ created_at: Date }>(
      `insert into meeting_questions (id, tenant_id, workspace_id, meeting_id, user_id, question, answer, credits_charged) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) returning created_at`,
      [input.id, input.tenantId, input.workspaceId, input.meetingId ?? null, input.userId, input.question, JSON.stringify(input.answer), input.creditsCharged],
    );
    return { id: input.id, ...(input.meetingId ? { meetingId: input.meetingId } : {}), userId: input.userId, question: input.question, answer: input.answer, creditsCharged: input.creditsCharged, createdAt: result.rows[0]!.created_at.toISOString() };
  }

  async listQuestions(input: { tenantId: string; meetingId?: string; userId: string; limit: number }): Promise<MeetingQuestionRecord[]> {
    const result = await this.pool.query<{ id: string; meeting_id: string | null; user_id: string; question: string; answer: MeetingQuestionRecord["answer"]; credits_charged: number; created_at: Date }>(
      input.meetingId
        ? "select * from meeting_questions where tenant_id = $1 and meeting_id = $2 order by created_at desc limit $3"
        : "select * from meeting_questions where tenant_id = $1 and meeting_id is null and user_id = $2 order by created_at desc limit $3",
      [input.tenantId, input.meetingId ?? input.userId, input.limit],
    );
    return result.rows.map((row) => ({ id: row.id, ...(row.meeting_id ? { meetingId: row.meeting_id } : {}), userId: row.user_id, question: row.question, answer: row.answer, creditsCharged: row.credits_charged, createdAt: row.created_at.toISOString() }));
  }

  async searchSegments(input: { tenantId: string; workspaceId: string; visibleToUserId?: string; query: string; limit: number }): Promise<MeetingSearchHit[]> {
    const terms = searchTerms(input.query);
    if (!terms.length) return [];
    const tsquery = terms.map((term) => term.replace(/'/g, "")).join(" | ");
    const params: unknown[] = [input.tenantId, input.workspaceId, tsquery, input.limit];
    let visibility = "";
    if (input.visibleToUserId) {
      params.push(input.visibleToUserId);
      visibility = `and (m.owner_user_id = $5 or m.created_by_user_id = $5 or exists (select 1 from meeting_participants vp where vp.meeting_id = m.id and vp.user_id = $5))`;
    }
    const hits = await this.pool.query<{ meeting_id: string; seq: number }>(
      `select s.meeting_id, s.seq
       from meeting_transcript_segments s join meetings m on m.id = s.meeting_id
       where s.tenant_id = $1 and m.workspace_id = $2 and m.deleted_at is null ${visibility}
         and to_tsvector('simple', s.text) @@ to_tsquery('simple', $3)
       order by ts_rank(to_tsvector('simple', s.text), to_tsquery('simple', $3)) desc, coalesce(m.scheduled_start_at, m.created_at) desc
       limit $4`,
      params,
    );
    if (!hits.rows.length) return [];
    // Contexto: o trecho encontrado + 2 antes e 2 depois.
    const result = await this.pool.query<{ meeting_id: string; title: string; scheduled_start_at: Date | null; seq: number; start_ms: number; end_ms: number; speaker: string | null; text: string }>(
      `with hit as (select * from unnest($2::text[], $3::int[]) as h(meeting_id, seq))
       select distinct s.meeting_id, m.title, m.scheduled_start_at, s.seq, s.start_ms, s.end_ms, coalesce(n.display_name, s.speaker) as speaker, s.text
       from hit join meeting_transcript_segments s on s.meeting_id = hit.meeting_id and s.seq between hit.seq - 2 and hit.seq + 2
       join meetings m on m.id = s.meeting_id
       left join meeting_speaker_names n on n.meeting_id = s.meeting_id and n.speaker_key = s.speaker
       where s.tenant_id = $1
       order by s.meeting_id, s.seq`,
      [input.tenantId, hits.rows.map((row) => row.meeting_id), hits.rows.map((row) => row.seq)],
    );
    return result.rows.map((row) => ({
      meetingId: row.meeting_id,
      title: row.title,
      ...(row.scheduled_start_at ? { scheduledStartAt: row.scheduled_start_at.toISOString() } : {}),
      segment: { seq: row.seq, startMs: row.start_ms, endMs: row.end_ms, ...(row.speaker ? { speaker: row.speaker } : {}), text: row.text },
    }));
  }

  async createShare(input: Parameters<MeetingInsightsRepositoryPort["createShare"]>[0]): Promise<MeetingShareRecord> {
    const result = await this.pool.query<ShareRow>(
      `insert into meeting_shares (id, tenant_id, workspace_id, meeting_id, token_hash, include_transcript, include_recording, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [input.id, input.tenantId, input.workspaceId, input.meetingId, input.tokenHash, input.includeTranscript, input.includeRecording, input.expiresAt ?? null, input.createdBy],
    );
    return toShare(result.rows[0]!);
  }

  async listShares(input: { tenantId: string; meetingId: string }): Promise<MeetingShareRecord[]> {
    const result = await this.pool.query<ShareRow>("select * from meeting_shares where tenant_id = $1 and meeting_id = $2 order by created_at desc", [input.tenantId, input.meetingId]);
    return result.rows.map(toShare);
  }

  async revokeShare(input: { tenantId: string; meetingId: string; shareId: string }): Promise<boolean> {
    const result = await this.pool.query("update meeting_shares set revoked_at = now() where tenant_id = $1 and meeting_id = $2 and id = $3 and revoked_at is null", [input.tenantId, input.meetingId, input.shareId]);
    return (result.rowCount ?? 0) > 0;
  }

  async consumeShareByTokenHash(input: { tokenHash: string; now: Date }): Promise<MeetingShareRecord | undefined> {
    const result = await this.pool.query<ShareRow>(
      `update meeting_shares s set view_count = view_count + 1, last_viewed_at = $2
       from meetings m
       where s.token_hash = $1 and s.revoked_at is null and (s.expires_at is null or s.expires_at > $2) and m.id = s.meeting_id and m.deleted_at is null
       returning s.*`,
      [input.tokenHash, input.now],
    );
    return result.rows[0] ? toShare(result.rows[0]) : undefined;
  }

  async listClips(input: { tenantId: string; meetingId: string }): Promise<MeetingClipRecord[]> {
    const result = await this.pool.query<{ id: string; meeting_id: string; start_ms: number; end_ms: number; title: string; note: string | null; created_by: string; created_at: Date }>(
      "select * from meeting_clips where tenant_id = $1 and meeting_id = $2 order by start_ms",
      [input.tenantId, input.meetingId],
    );
    return result.rows.map((row) => ({ id: row.id, meetingId: row.meeting_id, startMs: row.start_ms, endMs: row.end_ms, title: row.title, ...(row.note ? { note: row.note } : {}), createdBy: row.created_by, createdAt: row.created_at.toISOString() }));
  }

  async createClip(input: Parameters<MeetingInsightsRepositoryPort["createClip"]>[0]): Promise<MeetingClipRecord> {
    await this.pool.query(
      "insert into meeting_clips (id, tenant_id, workspace_id, meeting_id, start_ms, end_ms, title, note, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [input.id, input.tenantId, input.workspaceId, input.meetingId, input.startMs, input.endMs, input.title, input.note ?? null, input.createdBy, input.createdAt],
    );
    return { id: input.id, meetingId: input.meetingId, startMs: input.startMs, endMs: input.endMs, title: input.title, ...(input.note ? { note: input.note } : {}), createdBy: input.createdBy, createdAt: input.createdAt };
  }

  async deleteClip(input: { tenantId: string; meetingId: string; clipId: string }): Promise<boolean> {
    const result = await this.pool.query("delete from meeting_clips where tenant_id = $1 and meeting_id = $2 and id = $3", [input.tenantId, input.meetingId, input.clipId]);
    return (result.rowCount ?? 0) > 0;
  }

  async listComments(input: { tenantId: string; meetingId: string }): Promise<MeetingCommentRecord[]> {
    const result = await this.pool.query<{ id: string; meeting_id: string; at_ms: number | null; text: string; user_id: string; created_at: Date }>(
      "select * from meeting_comments where tenant_id = $1 and meeting_id = $2 order by created_at",
      [input.tenantId, input.meetingId],
    );
    return result.rows.map((row) => ({ id: row.id, meetingId: row.meeting_id, ...(row.at_ms !== null ? { atMs: row.at_ms } : {}), text: row.text, userId: row.user_id, createdAt: row.created_at.toISOString() }));
  }

  async createComment(input: Parameters<MeetingInsightsRepositoryPort["createComment"]>[0]): Promise<MeetingCommentRecord> {
    await this.pool.query(
      "insert into meeting_comments (id, tenant_id, workspace_id, meeting_id, at_ms, text, user_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [input.id, input.tenantId, input.workspaceId, input.meetingId, input.atMs ?? null, input.text, input.userId, input.createdAt],
    );
    return { id: input.id, meetingId: input.meetingId, ...(input.atMs !== undefined ? { atMs: input.atMs } : {}), text: input.text, userId: input.userId, createdAt: input.createdAt };
  }

  async deleteComment(input: { tenantId: string; meetingId: string; commentId: string; userId?: string }): Promise<boolean> {
    const result = await this.pool.query(
      `delete from meeting_comments where tenant_id = $1 and meeting_id = $2 and id = $3 ${input.userId ? "and user_id = $4" : ""}`,
      input.userId ? [input.tenantId, input.meetingId, input.commentId, input.userId] : [input.tenantId, input.meetingId, input.commentId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listKeywordTrackers(input: { tenantId: string; workspaceId: string }): Promise<MeetingKeywordTracker[]> {
    const result = await this.pool.query<{ id: string; label: string; terms: string[] }>("select id, label, terms from meeting_keyword_trackers where tenant_id = $1 and workspace_id = $2 order by lower(label)", [input.tenantId, input.workspaceId]);
    return result.rows.map((row) => ({ id: row.id, label: row.label, terms: row.terms ?? [] }));
  }

  async createKeywordTracker(input: Parameters<MeetingInsightsRepositoryPort["createKeywordTracker"]>[0]): Promise<MeetingKeywordTracker> {
    try {
      await this.pool.query("insert into meeting_keyword_trackers (id, tenant_id, workspace_id, label, terms) values ($1, $2, $3, $4, $5::jsonb)", [input.id, input.tenantId, input.workspaceId, input.label, JSON.stringify(input.terms)]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("MEETING_TRACKER_LABEL_TAKEN: já existe um grupo de palavras com este nome.");
      throw error;
    }
    return { id: input.id, label: input.label, terms: input.terms };
  }

  async updateKeywordTracker(input: { tenantId: string; workspaceId: string; trackerId: string; label?: string; terms?: string[] }): Promise<MeetingKeywordTracker | undefined> {
    try {
      const result = await this.pool.query<{ id: string; label: string; terms: string[] }>(
        `update meeting_keyword_trackers set label = coalesce($4, label), terms = coalesce($5::jsonb, terms) where tenant_id = $1 and workspace_id = $2 and id = $3 returning id, label, terms`,
        [input.tenantId, input.workspaceId, input.trackerId, input.label ?? null, input.terms ? JSON.stringify(input.terms) : null],
      );
      return result.rows[0] ? { id: result.rows[0].id, label: result.rows[0].label, terms: result.rows[0].terms } : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("MEETING_TRACKER_LABEL_TAKEN: já existe um grupo de palavras com este nome.");
      throw error;
    }
  }

  async deleteKeywordTracker(input: { tenantId: string; workspaceId: string; trackerId: string }): Promise<boolean> {
    const result = await this.pool.query("delete from meeting_keyword_trackers where tenant_id = $1 and workspace_id = $2 and id = $3", [input.tenantId, input.workspaceId, input.trackerId]);
    return (result.rowCount ?? 0) > 0;
  }

  async getUserPreferences(input: { tenantId: string; userId: string }): Promise<MeetingUserPreferences> {
    const result = await this.pool.query<{ auto_record_mode: AutoRecordMode; default_template: string }>("select auto_record_mode, default_template from meeting_user_preferences where tenant_id = $1 and user_id = $2", [input.tenantId, input.userId]);
    const row = result.rows[0];
    return { autoRecordMode: row?.auto_record_mode ?? "off", defaultTemplate: row && isMeetingSummaryTemplate(row.default_template) ? row.default_template : "general" };
  }

  async setUserPreferences(input: { tenantId: string; userId: string } & Partial<MeetingUserPreferences>): Promise<MeetingUserPreferences> {
    await this.pool.query(
      `insert into meeting_user_preferences (tenant_id, user_id, auto_record_mode, default_template) values ($1, $2, coalesce($3, 'off'), coalesce($4, 'general'))
       on conflict (tenant_id, user_id) do update set auto_record_mode = coalesce($3, meeting_user_preferences.auto_record_mode), default_template = coalesce($4, meeting_user_preferences.default_template), updated_at = now()`,
      [input.tenantId, input.userId, input.autoRecordMode ?? null, input.defaultTemplate ?? null],
    );
    return this.getUserPreferences(input);
  }

  async getTenantSettings(tenantId: string): Promise<MeetingTenantSettings> {
    const result = await this.pool.query<{ consent_notice_enabled: boolean; consent_message: string }>("select consent_notice_enabled, consent_message from meeting_tenant_settings where tenant_id = $1", [tenantId]);
    const row = result.rows[0];
    return { consentNoticeEnabled: row?.consent_notice_enabled ?? true, consentMessage: row?.consent_message ?? DEFAULT_CONSENT };
  }

  async setTenantSettings(input: { tenantId: string } & Partial<MeetingTenantSettings>): Promise<MeetingTenantSettings> {
    await this.pool.query(
      `insert into meeting_tenant_settings (tenant_id, consent_notice_enabled, consent_message) values ($1, coalesce($2, true), coalesce($3, $4))
       on conflict (tenant_id) do update set consent_notice_enabled = coalesce($2, meeting_tenant_settings.consent_notice_enabled), consent_message = coalesce($3, meeting_tenant_settings.consent_message), updated_at = now()`,
      [input.tenantId, input.consentNoticeEnabled ?? null, input.consentMessage ?? null, DEFAULT_CONSENT],
    );
    return this.getTenantSettings(input.tenantId);
  }

  async setActionItemCrmTask(input: { tenantId: string; meetingId: string; itemId: string; crmTaskId: string }): Promise<void> {
    await this.pool.query("update meeting_action_items set crm_task_id = $4 where tenant_id = $1 and meeting_id = $2 and id = $3", [input.tenantId, input.meetingId, input.itemId, input.crmTaskId]);
  }

  async actionItemCrmTasks(input: { tenantId: string; meetingId: string }): Promise<Map<string, string>> {
    const result = await this.pool.query<{ id: string; crm_task_id: string }>("select id, crm_task_id from meeting_action_items where tenant_id = $1 and meeting_id = $2 and crm_task_id is not null", [input.tenantId, input.meetingId]);
    return new Map(result.rows.map((row) => [row.id, row.crm_task_id]));
  }

  async usageForPeriod(input: { tenantId: string; period: string }) {
    const result = await this.pool.query<{ recording_seconds: string; transcription_seconds: string; ai_analyses: number; storage_bytes: string }>(
      "select recording_seconds, transcription_seconds, ai_analyses, storage_bytes from meeting_usage_monthly where tenant_id = $1 and period = $2",
      [input.tenantId, input.period],
    );
    const row = result.rows[0];
    return { recordingSeconds: Number(row?.recording_seconds ?? 0), transcriptionSeconds: Number(row?.transcription_seconds ?? 0), aiAnalyses: row?.ai_analyses ?? 0, storageBytes: Number(row?.storage_bytes ?? 0) };
  }

  async listNativeImportCandidates(input: { now: Date; limit: number }): Promise<{ tenantId: string; workspaceId: string; meetingId: string }[]> {
    const result = await this.pool.query<{ tenant_id: string; workspace_id: string; id: string }>(
      `select m.tenant_id, m.workspace_id, m.id
       from meetings m left join meeting_native_imports i on i.meeting_id = m.id
       where m.deleted_at is null and m.status = 'scheduled' and m.meeting_url like 'https://meet.google.com/%'
         and coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour') between $1::timestamptz - interval '48 hours' and $1::timestamptz - interval '10 minutes'
         and not exists (select 1 from meeting_transcripts t where t.meeting_id = m.id and t.status in ('running', 'completed'))
         and not exists (select 1 from meeting_recordings r where r.meeting_id = m.id)
         and (i.meeting_id is null or (i.status not in ('imported', 'not_eligible') and i.last_attempt_at < $1::timestamptz - interval '30 minutes' and i.attempts < 96))
       order by m.scheduled_start_at desc
       limit $2`,
      [input.now, input.limit],
    );
    return result.rows.map((row) => ({ tenantId: row.tenant_id, workspaceId: row.workspace_id, meetingId: row.id }));
  }

  async recordNativeImportAttempt(input: { tenantId: string; meetingId: string; status: string; error?: string }): Promise<void> {
    await this.pool.query(
      `insert into meeting_native_imports (meeting_id, tenant_id, attempts, status, last_error, last_attempt_at) values ($1, $2, 1, $3, $4, now())
       on conflict (meeting_id) do update set attempts = meeting_native_imports.attempts + 1, status = excluded.status, last_error = excluded.last_error, last_attempt_at = now()`,
      [input.meetingId, input.tenantId, input.status, input.error ?? null],
    );
  }

  async findExternalImports(input: { tenantId: string; provider: "zoom" | "google_meet"; externalIds: readonly string[] }): Promise<Map<string, string>> {
    if (!input.externalIds.length) return new Map();
    const result = await this.pool.query<{ external_id: string; meeting_id: string }>(
      "select i.external_id, i.meeting_id from meeting_external_imports i join meetings m on m.id = i.meeting_id where i.tenant_id = $1 and i.provider = $2 and i.external_id = any($3::text[]) and m.deleted_at is null",
      [input.tenantId, input.provider, [...input.externalIds]],
    );
    return new Map(result.rows.map((row) => [row.external_id, row.meeting_id]));
  }

  async reserveExternalImport(input: { tenantId: string; provider: "zoom" | "google_meet"; externalId: string; meetingId: string }): Promise<boolean> {
    const result = await this.pool.query("insert into meeting_external_imports (tenant_id, provider, external_id, meeting_id) values ($1, $2, $3, $4) on conflict (tenant_id, provider, external_id) do nothing", [input.tenantId, input.provider, input.externalId, input.meetingId]);
    return (result.rowCount ?? 0) > 0;
  }

  async releaseExternalImport(input: { tenantId: string; provider: "zoom" | "google_meet"; externalId: string }): Promise<void> {
    await this.pool.query("delete from meeting_external_imports where tenant_id = $1 and provider = $2 and external_id = $3", [input.tenantId, input.provider, input.externalId]);
  }

  async recordExternalImport(input: { tenantId: string; provider: "zoom" | "google_meet"; externalId: string; meetingId: string }): Promise<void> {
    await this.pool.query("insert into meeting_external_imports (tenant_id, provider, external_id, meeting_id) values ($1, $2, $3, $4) on conflict (tenant_id, provider, external_id) do update set meeting_id = excluded.meeting_id", [input.tenantId, input.provider, input.externalId, input.meetingId]);
  }

  async mediaKeys(input: { tenantId: string; meetingId: string }): Promise<string[]> {
    const result = await this.pool.query<{ storage_key: string }>("select storage_key from meeting_recordings where tenant_id = $1 and meeting_id = $2 and status <> 'purged'", [input.tenantId, input.meetingId]);
    return result.rows.map((row) => row.storage_key);
  }

  async purgeMeetingPermanently(input: { tenantId: string; workspaceId: string; meetingId: string }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("update meeting_jobs set status = 'cancelled' where tenant_id = $1 and meeting_id = $2 and status in ('queued', 'running')", [input.tenantId, input.meetingId]);
      await client.query("delete from meeting_questions where tenant_id = $1 and (meeting_id = $2 or answer::text like '%' || $2 || '%')", [input.tenantId, input.meetingId]);
      await client.query("delete from meeting_external_imports where tenant_id = $1 and meeting_id = $2", [input.tenantId, input.meetingId]);
      const deleted = await client.query("delete from meetings where tenant_id = $1 and workspace_id = $2 and id = $3", [input.tenantId, input.workspaceId, input.meetingId]);
      await client.query("commit");
      return (deleted.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

