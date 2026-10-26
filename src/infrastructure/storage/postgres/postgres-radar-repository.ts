import type { Pool } from "pg";
import type {
  RadarAiAnalysisLog,
  RadarAiAnalysisLogEntry,
  RadarConversationSnapshot,
  RadarDismissalLogEntry,
  RadarListFilter,
  RadarListItem,
  RadarRecentMessage,
  RadarRepositoryPort,
  RadarScope,
  RadarStats,
  SaveRadarEvaluationInput,
  UpsertRadarKeywordInput,
} from "../../../application/ports/radar-repository.port.js";
import {
  DEFAULT_RADAR_SETTINGS,
  type ConversationRiskScore,
  type RadarAiAnalysis,
  type RadarAiBlockedReason,
  type RadarAiStatus,
  type RadarKeywordCategory,
  type RadarRiskLevel,
  type RadarSettings,
  type RadarSignals,
} from "../../../domain/radar/radar.model.js";
import type { RadarKeywordOverride } from "../../../domain/radar/radar-keywords.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type RiskRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  team_id: string | null;
  agent_id: string | null;
  contact_id: string | null;
  score: number;
  level: RadarRiskLevel;
  reasons: string[] | null;
  signals: RadarSignals | null;
  has_keyword_trigger: boolean;
  has_cancellation: boolean;
  has_legal_threat: boolean;
  has_manager_request: boolean;
  has_complaint: boolean;
  has_urgency: boolean;
  waiting_minutes: number;
  message_count: number;
  inbound_count: number;
  transfer_count: number;
  reopen_count: number;
  conversation_context: string | null;
  last_evaluated_message_id: string | null;
  score_changed_at: Date;
  ai_analysis: RadarAiAnalysis | null;
  ai_analyzed_at: Date | null;
  ai_analyzed_score: number | null;
  ai_status: RadarAiStatus;
  ai_blocked_reason: RadarAiBlockedReason | null;
  ai_last_attempt_at: Date | null;
  ai_credit_transaction_id: string | null;
  ai_pending_since: Date | null;
  ai_trigger_id: string | null;
  ai_cooldown_until: Date | null;
  is_dismissed: boolean;
  dismissed_at: Date | null;
  dismissed_by: string | null;
  dismissed_note: string | null;
  created_at: Date;
  updated_at: Date;
};

type ListRow = RiskRow & {
  contact_name: string | null;
  contact_phone: string | null;
  agent_name: string | null;
  team_name: string | null;
  live_agent_id: string | null;
  live_team_id: string | null;
  conversation_status: string | null;
  last_message_at: Date | null;
  live_waiting_minutes: number;
};

/** Última resposta do atendimento e, a partir dela, as mensagens do cliente ainda sem resposta.
 * Mensagem outbound que ainda não saiu (`queued`) ou falhou não conta como resposta. */
const UNANSWERED_LATERALS = `
  left join lateral (
    select max(m.created_at) as last_outbound_at
    from inbox_messages m
    where m.conversation_id = conv.id and m.direction = 'outbound' and m.status not in ('queued', 'failed')
  ) lo on true
  left join lateral (
    select count(*)::int as unanswered_count, min(m.created_at) as oldest_unanswered_at
    from inbox_messages m
    where m.conversation_id = conv.id and m.direction = 'inbound' and (lo.last_outbound_at is null or m.created_at > lo.last_outbound_at)
  ) un on true`;

/** Agente/equipe/contato vêm SEMPRE da conversa ao vivo (não do snapshot gravado na última
 * avaliação) — é o que mantém o escopo correto depois de uma transferência. */
const LIST_SELECT = `
  select crs.*,
         ct.name as contact_name,
         ct.phone_normalized as contact_phone,
         u.name as agent_name,
         t.name as team_name,
         conv.assigned_user_id as live_agent_id,
         conv.current_team_id as live_team_id,
         conv.status as conversation_status,
         conv.last_message_at,
         case when un.oldest_unanswered_at is null then 0
              else greatest(0, floor(extract(epoch from (now() - un.oldest_unanswered_at)) / 60))::int end as live_waiting_minutes
  from conversation_risk_scores crs
  join inbox_conversations conv on conv.id = crs.conversation_id
  left join inbox_contacts ct on ct.id = conv.contact_id
  left join users u on u.id = conv.assigned_user_id
  left join teams t on t.id = conv.current_team_id
  ${UNANSWERED_LATERALS}`;

/** Filtros fixos de toda leitura do Radar: grupo nunca aparece, conversa fundida (tombstone)
 * nunca aparece, equipe com Radar desligado nunca aparece, e só conversas ativadas por keyword. */
const BASE_VISIBILITY = `
  and conv.chat_type <> 'group'
  and lower(conv.external_chat_id) not like '%@g.us'
  and conv.merge_status is null
  and coalesce(t.radar_enabled, true) = true
  and crs.has_keyword_trigger = true`;

function buildScopeWhere(scope: RadarScope, filter: Pick<RadarListFilter, "teamId" | "agentId"> = {}): { sql: string; params: unknown[] } {
  const params: unknown[] = [scope.tenantId, scope.workspaceId];
  let sql = `crs.tenant_id = $1 and crs.workspace_id = $2 and conv.tenant_id = $1 and conv.workspace_id = $2 ${BASE_VISIBILITY}`;

  if (scope.teamIds !== undefined || scope.agentId !== undefined) {
    const clauses: string[] = [];
    if (scope.teamIds && scope.teamIds.length > 0) {
      params.push([...scope.teamIds]);
      clauses.push(`conv.current_team_id = any($${params.length}::text[])`);
    }
    if (scope.agentId) {
      params.push(scope.agentId);
      clauses.push(`conv.assigned_user_id = $${params.length}`);
    }
    // Escopo restrito sem nenhuma equipe nem agente = nada visível, nunca "tudo".
    sql += clauses.length > 0 ? ` and (${clauses.join(" or ")})` : " and false";
  }

  if (filter.teamId) {
    params.push(filter.teamId);
    sql += ` and conv.current_team_id = $${params.length}`;
  }
  if (filter.agentId) {
    params.push(filter.agentId);
    sql += ` and conv.assigned_user_id = $${params.length}`;
  }
  return { sql, params };
}

export class PostgresRadarRepository implements RadarRepositoryPort {
  constructor(private readonly pool: Pool) {}

  // --- Configuração ---------------------------------------------------------------------------

  async getSettings(workspaceId: string): Promise<RadarSettings> {
    const result = await this.pool.query<{ radar_enabled: boolean; ai_analysis_enabled: boolean; ai_trigger_threshold: number; ai_cooldown_minutes: number; sla_minutes: number }>(
      `select radar_enabled, ai_analysis_enabled, ai_trigger_threshold, ai_cooldown_minutes, sla_minutes from radar_settings where workspace_id = $1`,
      [workspaceId],
    );
    const row = result.rows[0];
    if (!row) return { ...DEFAULT_RADAR_SETTINGS };
    return {
      radarEnabled: row.radar_enabled,
      aiAnalysisEnabled: row.ai_analysis_enabled,
      aiTriggerThreshold: row.ai_trigger_threshold,
      aiCooldownMinutes: row.ai_cooldown_minutes,
      slaMinutes: row.sla_minutes,
    };
  }

  /** Toda escrita de configuração confere que o workspace (e a equipe, se houver) é DESTE tenant
   * — `workspaceId` vem do corpo da requisição, nunca é confiado sozinho. */
  private async assertOwned(input: { tenantId: string; workspaceId: string; teamId?: string }): Promise<void> {
    const workspace = await this.pool.query(`select 1 from workspaces where id = $1 and tenant_id = $2`, [input.workspaceId, input.tenantId]);
    if ((workspace.rowCount ?? 0) === 0) throw new Error(`RADAR_WORKSPACE_NOT_FOUND: workspace "${input.workspaceId}" não existe.`);
    if (!input.teamId) return;
    const team = await this.pool.query(`select 1 from teams where id = $1 and tenant_id = $2 and workspace_id = $3`, [input.teamId, input.tenantId, input.workspaceId]);
    if ((team.rowCount ?? 0) === 0) throw new Error(`RADAR_TEAM_NOT_FOUND: equipe "${input.teamId}" não existe.`);
  }

  async upsertSettings(input: { tenantId: string; workspaceId: string; patch: Partial<RadarSettings> }): Promise<RadarSettings> {
    await this.assertOwned(input);
    const merged: RadarSettings = { ...(await this.getSettings(input.workspaceId)), ...input.patch };
    await this.pool.query(
      `insert into radar_settings (workspace_id, tenant_id, radar_enabled, ai_analysis_enabled, ai_trigger_threshold, ai_cooldown_minutes, sla_minutes)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (workspace_id) do update set
         radar_enabled = excluded.radar_enabled,
         ai_analysis_enabled = excluded.ai_analysis_enabled,
         ai_trigger_threshold = excluded.ai_trigger_threshold,
         ai_cooldown_minutes = excluded.ai_cooldown_minutes,
         sla_minutes = excluded.sla_minutes,
         updated_at = now()`,
      [input.workspaceId, input.tenantId, merged.radarEnabled, merged.aiAnalysisEnabled, merged.aiTriggerThreshold, merged.aiCooldownMinutes, merged.slaMinutes],
    );
    return merged;
  }

  async setTeamRadarEnabled(input: { tenantId: string; workspaceId: string; teamId: string; enabled: boolean }): Promise<boolean> {
    const result = await this.pool.query(`update teams set radar_enabled = $4, updated_at = now() where id = $1 and tenant_id = $2 and workspace_id = $3`, [
      input.teamId,
      input.tenantId,
      input.workspaceId,
      input.enabled,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async listTeamFlags(input: { tenantId: string; workspaceId: string }): Promise<{ teamId: string; teamName: string; radarEnabled: boolean }[]> {
    const result = await this.pool.query<{ id: string; name: string; radar_enabled: boolean }>(
      `select id, name, radar_enabled from teams where tenant_id = $1 and workspace_id = $2 order by name`,
      [input.tenantId, input.workspaceId],
    );
    return result.rows.map((row) => ({ teamId: row.id, teamName: row.name, radarEnabled: row.radar_enabled }));
  }

  // --- Keywords -------------------------------------------------------------------------------

  async listKeywordOverrides(input: { tenantId: string; workspaceId: string }): Promise<RadarKeywordOverride[]> {
    const result = await this.pool.query<KeywordRow>(`select * from radar_keywords where tenant_id = $1 and workspace_id = $2 order by keyword, team_id nulls first`, [
      input.tenantId,
      input.workspaceId,
    ]);
    return result.rows.map(toKeywordOverride);
  }

  async upsertKeywordOverride(input: UpsertRadarKeywordInput): Promise<RadarKeywordOverride> {
    await this.assertOwned(input);
    const result = await this.pool.query<KeywordRow>(
      `insert into radar_keywords (id, tenant_id, workspace_id, team_id, keyword, category, weight, enabled)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (workspace_id, coalesce(team_id, ''), keyword) do update set
         category = excluded.category,
         weight = excluded.weight,
         enabled = excluded.enabled,
         updated_at = now()
       returning *`,
      [newId("rkw"), input.tenantId, input.workspaceId, input.teamId ?? null, input.keyword, input.category, input.weight ?? null, input.enabled],
    );
    return toKeywordOverride(result.rows[0]);
  }

  async deleteKeywordOverride(input: { tenantId: string; workspaceId: string; id: string }): Promise<boolean> {
    const result = await this.pool.query(`delete from radar_keywords where id = $1 and tenant_id = $2 and workspace_id = $3`, [input.id, input.tenantId, input.workspaceId]);
    return (result.rowCount ?? 0) > 0;
  }

  // --- Camada 1 -------------------------------------------------------------------------------

  async loadConversationSnapshot(conversationId: string): Promise<RadarConversationSnapshot | undefined> {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      chat_type: string;
      external_chat_id: string;
      contact_id: string | null;
      assigned_user_id: string | null;
      current_team_id: string | null;
      team_radar_enabled: boolean;
      message_count: number;
      inbound_count: number;
      unanswered_count: number;
      oldest_unanswered_at: Date | null;
      transfer_count: number;
      reopen_count: number;
    }>(
      `select conv.id, conv.tenant_id, conv.workspace_id, conv.chat_type, conv.external_chat_id, conv.contact_id, conv.assigned_user_id, conv.current_team_id,
              coalesce(t.radar_enabled, true) as team_radar_enabled,
              coalesce(mc.message_count, 0) as message_count,
              coalesce(mc.inbound_count, 0) as inbound_count,
              coalesce(un.unanswered_count, 0) as unanswered_count,
              un.oldest_unanswered_at,
              coalesce(ev.transfer_count, 0) as transfer_count,
              coalesce(ev.reopen_count, 0) as reopen_count
       from inbox_conversations conv
       left join teams t on t.id = conv.current_team_id
       left join lateral (
         select count(*)::int as message_count, (count(*) filter (where m.direction = 'inbound'))::int as inbound_count
         from inbox_messages m where m.conversation_id = conv.id
       ) mc on true
       ${UNANSWERED_LATERALS}
       left join lateral (
         select (count(*) filter (where e.type = 'transferred'))::int as transfer_count,
                (count(*) filter (where e.type = 'status_changed' and e.from_status = 'resolved' and e.to_status in ('open', 'pending')))::int as reopen_count
         from inbox_conversation_events e where e.conversation_id = conv.id
       ) ev on true
       where conv.id = $1`,
      [conversationId],
    );
    const row = result.rows[0];
    if (!row) return undefined;

    const context = await this.pool.query<{ body: string }>(
      `select body from inbox_messages
       where conversation_id = $1 and direction = 'inbound' and body is not null and body <> ''
       order by created_at desc
       limit 5`,
      [conversationId],
    );
    const recentInboundContext = context.rows.length > 0 ? context.rows.reverse().map((message) => message.body.trim()).filter(Boolean).join(" | ").slice(0, 600) : undefined;

    return {
      conversationId: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      chatType: row.chat_type,
      externalChatId: row.external_chat_id,
      contactId: row.contact_id ?? undefined,
      agentId: row.assigned_user_id ?? undefined,
      teamId: row.current_team_id ?? undefined,
      teamRadarEnabled: row.team_radar_enabled,
      messageCount: row.message_count,
      inboundCount: row.inbound_count,
      unansweredInboundCount: row.unanswered_count,
      oldestUnansweredInboundAt: row.oldest_unanswered_at?.toISOString(),
      transferCount: row.transfer_count,
      reopenCount: row.reopen_count,
      recentInboundContext,
    };
  }

  async listRecentMessages(conversationId: string, limit: number): Promise<RadarRecentMessage[]> {
    const result = await this.pool.query<{ direction: "inbound" | "outbound"; body: string; created_at: Date }>(
      `select direction, body, created_at from inbox_messages
       where conversation_id = $1 and body is not null and body <> '' and status <> 'failed'
       order by created_at desc
       limit $2`,
      [conversationId, limit],
    );
    return result.rows.map((row) => ({ direction: row.direction, body: row.body, createdAt: row.created_at.toISOString() }));
  }

  async getByConversationId(conversationId: string): Promise<ConversationRiskScore | undefined> {
    const result = await this.pool.query<RiskRow>(`select * from conversation_risk_scores where conversation_id = $1`, [conversationId]);
    return result.rows[0] ? toRisk(result.rows[0]) : undefined;
  }

  async saveEvaluation(input: SaveRadarEvaluationInput): Promise<ConversationRiskScore> {
    const { signals } = input;
    const result = await this.pool.query<RiskRow>(
      `insert into conversation_risk_scores
         (id, tenant_id, workspace_id, conversation_id, team_id, agent_id, contact_id,
          score, level, reasons, signals,
          has_keyword_trigger, has_cancellation, has_legal_threat, has_manager_request, has_complaint, has_urgency,
          waiting_minutes, message_count, inbound_count, transfer_count, reopen_count,
          conversation_context, last_evaluated_message_id, score_changed_at, created_at, updated_at)
       values
         ($1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10::jsonb, $11::jsonb,
          $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22,
          $23, $24, $25::timestamptz, $25::timestamptz, $25::timestamptz)
       on conflict (conversation_id) do update set
         team_id = excluded.team_id,
         agent_id = excluded.agent_id,
         contact_id = excluded.contact_id,
         score = excluded.score,
         level = excluded.level,
         reasons = excluded.reasons,
         signals = excluded.signals,
         has_keyword_trigger = excluded.has_keyword_trigger,
         has_cancellation = excluded.has_cancellation,
         has_legal_threat = excluded.has_legal_threat,
         has_manager_request = excluded.has_manager_request,
         has_complaint = excluded.has_complaint,
         has_urgency = excluded.has_urgency,
         waiting_minutes = excluded.waiting_minutes,
         message_count = excluded.message_count,
         inbound_count = excluded.inbound_count,
         transfer_count = excluded.transfer_count,
         reopen_count = excluded.reopen_count,
         conversation_context = coalesce(excluded.conversation_context, conversation_risk_scores.conversation_context),
         last_evaluated_message_id = excluded.last_evaluated_message_id,
         score_changed_at = case when $26::boolean then excluded.score_changed_at else conversation_risk_scores.score_changed_at end,
         is_dismissed = case when excluded.score > conversation_risk_scores.score then false else conversation_risk_scores.is_dismissed end,
         dismissed_at = case when excluded.score > conversation_risk_scores.score then null else conversation_risk_scores.dismissed_at end,
         dismissed_by = case when excluded.score > conversation_risk_scores.score then null else conversation_risk_scores.dismissed_by end,
         dismissed_note = case when excluded.score > conversation_risk_scores.score then null else conversation_risk_scores.dismissed_note end,
         updated_at = excluded.updated_at
       returning *`,
      [
        newId("risk"),
        input.tenantId,
        input.workspaceId,
        input.conversationId,
        input.teamId ?? null,
        input.agentId ?? null,
        input.contactId ?? null,
        input.score,
        input.level,
        JSON.stringify(input.reasons),
        JSON.stringify(signals),
        signals.hasKeywordTrigger,
        signals.hasCancellation,
        signals.hasLegalThreat,
        signals.hasManagerRequest,
        signals.hasComplaint,
        signals.hasUrgency,
        input.waitingMinutes,
        input.messageCount,
        input.inboundCount,
        input.transferCount,
        input.reopenCount,
        input.conversationContext ?? null,
        input.lastEvaluatedMessageId ?? null,
        input.now,
        input.scoreChanged,
      ],
    );
    return toRisk(result.rows[0]);
  }

  // --- Camada 2 -------------------------------------------------------------------------------

  async tryClaimAiAnalysis(input: { conversationId: string; triggerId: string; now: string; stalePendingBefore: string; cooldownUntil: string }): Promise<ConversationRiskScore | undefined> {
    // Um único UPDATE condicional = a reserva inteira. Livre quando não há análise em voo e o
    // cooldown passou; uma análise em voo só pode ser tomada depois de abandonada (lease vencido),
    // caso em que o cooldown armado por ela mesma é ignorado.
    const result = await this.pool.query<RiskRow>(
      `update conversation_risk_scores
       set ai_status = 'PENDING', ai_pending_since = $3::timestamptz, ai_trigger_id = $2, ai_last_attempt_at = $3::timestamptz,
           ai_cooldown_until = $5::timestamptz, updated_at = $3::timestamptz
       where conversation_id = $1
         and (
           (ai_pending_since is null and (ai_cooldown_until is null or ai_cooldown_until <= $3::timestamptz))
           or (ai_pending_since is not null and ai_pending_since < $4::timestamptz)
         )
       returning *`,
      [input.conversationId, input.triggerId, input.now, input.stalePendingBefore, input.cooldownUntil],
    );
    return result.rows[0] ? toRisk(result.rows[0]) : undefined;
  }

  async completeAiAnalysis(input: { conversationId: string; triggerId: string; analysis: RadarAiAnalysis; analyzedAt: string; analyzedScore: number; creditTransactionId: string }): Promise<ConversationRiskScore | undefined> {
    const result = await this.pool.query<RiskRow>(
      `update conversation_risk_scores
       set ai_analysis = $3::jsonb, ai_analyzed_at = $4, ai_analyzed_score = $5, ai_status = 'ANALYZED', ai_blocked_reason = null,
           ai_credit_transaction_id = $6, ai_pending_since = null, updated_at = $4
       where conversation_id = $1 and ai_trigger_id = $2
       returning *`,
      [input.conversationId, input.triggerId, JSON.stringify(input.analysis), input.analyzedAt, input.analyzedScore, input.creditTransactionId],
    );
    return result.rows[0] ? toRisk(result.rows[0]) : undefined;
  }

  async blockAiAnalysis(input: { conversationId: string; triggerId: string; reason: RadarAiBlockedReason; now: string }): Promise<ConversationRiskScore | undefined> {
    // `ai_analysis`/`ai_analyzed_at` ficam intocados de propósito: o último diagnóstico continua lá.
    const result = await this.pool.query<RiskRow>(
      `update conversation_risk_scores
       set ai_status = 'BLOCKED_NO_CREDITS', ai_blocked_reason = $3, ai_last_attempt_at = $4, ai_pending_since = null, ai_cooldown_until = null, updated_at = $4
       where conversation_id = $1 and ai_trigger_id = $2
       returning *`,
      [input.conversationId, input.triggerId, input.reason, input.now],
    );
    return result.rows[0] ? toRisk(result.rows[0]) : undefined;
  }

  async failAiAnalysis(input: { conversationId: string; triggerId: string; now: string; retryAfter: string }): Promise<ConversationRiskScore | undefined> {
    const result = await this.pool.query<RiskRow>(
      `update conversation_risk_scores
       set ai_status = 'FAILED_PROVIDER', ai_blocked_reason = null, ai_last_attempt_at = $3, ai_pending_since = null, ai_cooldown_until = $4, updated_at = $3
       where conversation_id = $1 and ai_trigger_id = $2
       returning *`,
      [input.conversationId, input.triggerId, input.now, input.retryAfter],
    );
    return result.rows[0] ? toRisk(result.rows[0]) : undefined;
  }

  async recordAiAnalysisLog(entry: RadarAiAnalysisLogEntry): Promise<void> {
    await this.pool.query(
      `insert into radar_ai_analysis_logs
         (id, tenant_id, workspace_id, conversation_id, trigger_id, trigger_source, trigger_reason, idempotency_key, score, level, status,
          credit_transaction_id, credits_reserved, credits_consumed, provider, model, input_tokens, output_tokens, estimated_cost_usd,
          error_category, requested_by_user_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       on conflict do nothing`,
      [
        newId("radarlog"),
        entry.tenantId,
        entry.workspaceId,
        entry.conversationId,
        entry.triggerId,
        entry.triggerSource,
        entry.triggerReason ?? null,
        entry.idempotencyKey,
        entry.score,
        entry.level,
        entry.status,
        entry.creditTransactionId ?? null,
        entry.creditsReserved,
        entry.creditsConsumed,
        entry.provider ?? null,
        entry.model ?? null,
        entry.inputTokens ?? null,
        entry.outputTokens ?? null,
        entry.estimatedCostUsd ?? null,
        entry.errorCategory ?? null,
        entry.requestedByUserId ?? null,
        entry.now,
      ],
    );
  }

  async listAiAnalysisLogs(input: { tenantId: string; workspaceId: string; conversationId: string; limit: number }): Promise<RadarAiAnalysisLog[]> {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      conversation_id: string;
      feature: string;
      trigger_id: string;
      trigger_source: "auto" | "manual";
      trigger_reason: string | null;
      idempotency_key: string;
      score: number;
      level: RadarRiskLevel;
      status: RadarAiAnalysisLog["status"];
      credit_transaction_id: string | null;
      credits_reserved: number;
      credits_consumed: number;
      provider: string | null;
      model: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      estimated_cost_usd: string | null;
      error_category: string | null;
      requested_by_user_id: string | null;
      created_at: Date;
    }>(
      `select * from radar_ai_analysis_logs
       where tenant_id = $1 and workspace_id = $2 and conversation_id = $3
       order by created_at desc
       limit $4`,
      [input.tenantId, input.workspaceId, input.conversationId, input.limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      feature: row.feature,
      triggerId: row.trigger_id,
      triggerSource: row.trigger_source,
      triggerReason: row.trigger_reason ?? undefined,
      idempotencyKey: row.idempotency_key,
      score: row.score,
      level: row.level,
      status: row.status,
      creditTransactionId: row.credit_transaction_id ?? undefined,
      creditsReserved: row.credits_reserved,
      creditsConsumed: row.credits_consumed,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      estimatedCostUsd: row.estimated_cost_usd === null ? undefined : Number(row.estimated_cost_usd),
      errorCategory: row.error_category ?? undefined,
      requestedByUserId: row.requested_by_user_id ?? undefined,
      createdAt: row.created_at.toISOString(),
    }));
  }

  // --- Leitura --------------------------------------------------------------------------------

  async list(scope: RadarScope, filter: RadarListFilter): Promise<RadarListItem[]> {
    const { sql, params } = buildScopeWhere(scope, filter);
    let where = sql;
    where += filter.dismissed ? " and crs.is_dismissed = true" : " and crs.is_dismissed = false and crs.score > 0";
    if (filter.level) {
      params.push(filter.level);
      where += ` and crs.level = $${params.length}`;
    }
    if (filter.minScore !== undefined) {
      params.push(filter.minScore);
      where += ` and crs.score >= $${params.length}`;
    }
    params.push(filter.limit ?? 50, filter.offset ?? 0);
    const result = await this.pool.query<ListRow>(
      `${LIST_SELECT}
       where ${where}
       order by ${filter.dismissed ? "crs.dismissed_at desc nulls last" : "crs.score desc, crs.updated_at desc"}
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return result.rows.map(toListItem);
  }

  async getDetail(scope: RadarScope, conversationId: string): Promise<RadarListItem | undefined> {
    const { sql, params } = buildScopeWhere(scope);
    params.push(conversationId);
    const result = await this.pool.query<ListRow>(`${LIST_SELECT} where ${sql} and crs.conversation_id = $${params.length} limit 1`, params);
    return result.rows[0] ? toListItem(result.rows[0]) : undefined;
  }

  async stats(scope: RadarScope, filter: Pick<RadarListFilter, "teamId" | "agentId">): Promise<RadarStats> {
    const { sql, params } = buildScopeWhere(scope, filter);
    const from = `
      from conversation_risk_scores crs
      join inbox_conversations conv on conv.id = crs.conversation_id
      left join teams t on t.id = conv.current_team_id
      where ${sql} and crs.is_dismissed = false and crs.score > 0`;

    const [overview, backlog] = await Promise.all([
      this.pool.query<{
        total: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        sla_breached: number;
        with_cancellation: number;
        with_legal_threat: number;
        avg_score: number | null;
        ai_blocked: number;
      }>(
        `select count(*)::int as total,
                (count(*) filter (where crs.level = 'critical'))::int as critical,
                (count(*) filter (where crs.level = 'high'))::int as high,
                (count(*) filter (where crs.level = 'medium'))::int as medium,
                (count(*) filter (where crs.level = 'low'))::int as low,
                (count(*) filter (where (crs.signals->>'slaBreached')::boolean = true))::int as sla_breached,
                (count(*) filter (where crs.has_cancellation))::int as with_cancellation,
                (count(*) filter (where crs.has_legal_threat))::int as with_legal_threat,
                round(avg(crs.score))::int as avg_score,
                (count(*) filter (where crs.ai_status = 'BLOCKED_NO_CREDITS'))::int as ai_blocked
         ${from}`,
        params,
      ),
      this.pool.query<{ team_id: string; team_name: string | null; count: number; avg_score: number | null }>(
        `select conv.current_team_id as team_id, t.name as team_name, count(*)::int as count, round(avg(crs.score))::int as avg_score
         ${from} and conv.current_team_id is not null
         group by conv.current_team_id, t.name
         order by count desc
         limit 10`,
        params,
      ),
    ]);

    const row = overview.rows[0];
    return {
      totalActive: row?.total ?? 0,
      critical: row?.critical ?? 0,
      high: row?.high ?? 0,
      medium: row?.medium ?? 0,
      low: row?.low ?? 0,
      slaBreached: row?.sla_breached ?? 0,
      withCancellation: row?.with_cancellation ?? 0,
      withLegalThreat: row?.with_legal_threat ?? 0,
      avgScore: row?.avg_score ?? 0,
      aiBlockedNoCredits: row?.ai_blocked ?? 0,
      backlogByTeam: backlog.rows.map((team) => ({ teamId: team.team_id, teamName: team.team_name ?? "Sem equipe", count: team.count, avgScore: team.avg_score ?? 0 })),
    };
  }

  // --- Arquivar / reativar --------------------------------------------------------------------

  async dismiss(input: { tenantId: string; workspaceId: string; conversationId: string; userId: string; note?: string; now: string }): Promise<ConversationRiskScore | undefined> {
    const result = await this.pool.query<RiskRow>(
      `update conversation_risk_scores
       set is_dismissed = true, dismissed_at = $4, dismissed_by = $5, dismissed_note = $6, updated_at = $4
       where conversation_id = $1 and tenant_id = $2 and workspace_id = $3
       returning *`,
      [input.conversationId, input.tenantId, input.workspaceId, input.now, input.userId, input.note ?? null],
    );
    if (!result.rows[0]) return undefined;
    await this.insertDismissalLog({ ...input, action: "dismissed" });
    return toRisk(result.rows[0]);
  }

  async reactivate(input: { tenantId: string; workspaceId: string; conversationId: string; userId: string; now: string }): Promise<ConversationRiskScore | undefined> {
    const result = await this.pool.query<RiskRow>(
      `update conversation_risk_scores
       set is_dismissed = false, dismissed_at = null, dismissed_by = null, dismissed_note = null, updated_at = $4
       where conversation_id = $1 and tenant_id = $2 and workspace_id = $3
       returning *`,
      [input.conversationId, input.tenantId, input.workspaceId, input.now],
    );
    if (!result.rows[0]) return undefined;
    await this.insertDismissalLog({ ...input, action: "reactivated" });
    return toRisk(result.rows[0]);
  }

  async listDismissalLog(input: { tenantId: string; workspaceId: string; conversationId: string }): Promise<RadarDismissalLogEntry[]> {
    const result = await this.pool.query<{ id: string; conversation_id: string; action: "dismissed" | "reactivated"; user_id: string | null; note: string | null; created_at: Date }>(
      `select id, conversation_id, action, user_id, note, created_at from radar_dismissal_log
       where tenant_id = $1 and workspace_id = $2 and conversation_id = $3
       order by created_at desc
       limit 50`,
      [input.tenantId, input.workspaceId, input.conversationId],
    );
    return result.rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, action: row.action, userId: row.user_id ?? undefined, note: row.note ?? undefined, createdAt: row.created_at.toISOString() }));
  }

  private async insertDismissalLog(input: { tenantId: string; workspaceId: string; conversationId: string; userId: string; note?: string; now: string; action: "dismissed" | "reactivated" }): Promise<void> {
    await this.pool.query(
      `insert into radar_dismissal_log (id, tenant_id, workspace_id, conversation_id, action, user_id, note, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId("radardismiss"), input.tenantId, input.workspaceId, input.conversationId, input.action, input.userId, input.note ?? null, input.now],
    );
  }
}

type KeywordRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  team_id: string | null;
  keyword: string;
  category: RadarKeywordCategory;
  weight: number | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

function toKeywordOverride(row: KeywordRow): RadarKeywordOverride {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    teamId: row.team_id ?? undefined,
    keyword: row.keyword,
    category: row.category,
    weight: row.weight ?? undefined,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toRisk(row: RiskRow): ConversationRiskScore {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    teamId: row.team_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    score: row.score,
    level: row.level,
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    signals: (row.signals ?? {}) as RadarSignals,
    hasKeywordTrigger: row.has_keyword_trigger,
    hasCancellation: row.has_cancellation,
    hasLegalThreat: row.has_legal_threat,
    hasManagerRequest: row.has_manager_request,
    hasComplaint: row.has_complaint,
    hasUrgency: row.has_urgency,
    waitingMinutes: row.waiting_minutes,
    messageCount: row.message_count,
    inboundCount: row.inbound_count,
    transferCount: row.transfer_count,
    reopenCount: row.reopen_count,
    conversationContext: row.conversation_context ?? undefined,
    lastEvaluatedMessageId: row.last_evaluated_message_id ?? undefined,
    scoreChangedAt: row.score_changed_at.toISOString(),
    aiAnalysis: row.ai_analysis ?? undefined,
    aiAnalyzedAt: row.ai_analyzed_at?.toISOString(),
    aiAnalyzedScore: row.ai_analyzed_score ?? undefined,
    aiStatus: row.ai_status,
    aiBlockedReason: row.ai_blocked_reason ?? undefined,
    aiLastAttemptAt: row.ai_last_attempt_at?.toISOString(),
    aiCreditTransactionId: row.ai_credit_transaction_id ?? undefined,
    aiPendingSince: row.ai_pending_since?.toISOString(),
    aiTriggerId: row.ai_trigger_id ?? undefined,
    aiCooldownUntil: row.ai_cooldown_until?.toISOString(),
    isDismissed: row.is_dismissed,
    dismissedAt: row.dismissed_at?.toISOString(),
    dismissedBy: row.dismissed_by ?? undefined,
    dismissedNote: row.dismissed_note ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toListItem(row: ListRow): RadarListItem {
  return {
    ...toRisk(row),
    agentId: row.live_agent_id ?? undefined,
    teamId: row.live_team_id ?? undefined,
    contactName: row.contact_name ?? undefined,
    contactPhone: row.contact_phone ?? undefined,
    agentName: row.agent_name ?? undefined,
    teamName: row.team_name ?? undefined,
    conversationStatus: row.conversation_status ?? undefined,
    lastMessageAt: row.last_message_at?.toISOString(),
    liveWaitingMinutes: row.live_waiting_minutes,
  };
}
