import type { Pool } from "pg";
import type {
  FindOrCreateInboxConversationInput,
  InboxConversationListFilter,
  InboxConversationListItem,
  InboxConversationRepositoryPort,
} from "../../../application/ports/inbox-conversation-repository.port.js";
import type { InboxAiPauseReason, InboxChatType, InboxConversation, InboxConversationStatus, InboxMediaStorageRef, InboxMessageDirection, InboxMessageType } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxconv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  connection_id: string;
  chat_type: string;
  external_chat_id: string;
  group_name: string | null;
  group_participant_count: number | null;
  group_metadata_updated_at: Date | null;
  contact_id: string | null;
  status: string;
  assigned_user_id: string | null;
  department_id: string | null;
  current_team_id: string | null;
  current_phase_id: string | null;
  is_pinned: boolean;
  pinned_at: Date | null;
  last_message_at: Date | null;
  unread_count: number;
  is_urgent: boolean;
  ai_enabled: boolean;
  ai_paused_reason: string | null;
  ai_processing_since: Date | null;
  automation_enabled: boolean;
  merge_status: string | null;
  merged_into_conversation_id: string | null;
  merged_at: Date | null;
  group_picture_storage_ref: InboxMediaStorageRef | null;
  group_picture_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export class PostgresInboxConversationRepository implements InboxConversationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findOrCreate(input: FindOrCreateInboxConversationInput): Promise<InboxConversation> {
    const id = idGenerator();
    // Idempotente por `(connection_id, external_chat_id)` — a identidade CANÔNICA do chat (grupo
    // ou peer), nunca mais o remetente de uma mensagem específica (ver migration 0115). Um grupo
    // já existente nunca ganha um `group_name`/`contact_id` diferente por reentrega: `coalesce`
    // preserva o que já tiver, só preenche se ainda estava vazio.
    const result = await this.pool.query<Row>(
      `insert into inbox_conversations (id, tenant_id, workspace_id, connection_id, chat_type, external_chat_id, group_name, contact_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (connection_id, external_chat_id) where merge_status is null do update set
         group_name = coalesce(inbox_conversations.group_name, excluded.group_name),
         contact_id = coalesce(inbox_conversations.contact_id, excluded.contact_id),
         updated_at = inbox_conversations.updated_at
       returning *`,
      [id, input.tenantId, input.workspaceId, input.connectionId, input.chatType, input.externalChatId, input.groupName ?? null, input.contactId ?? null],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<InboxConversation | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_conversations where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from inbox_conversations where id = $1", [id]);
  }

  async getByExternalChatId(input: { connectionId: string; externalChatId: string }): Promise<InboxConversation | undefined> {
    // Inclui linhas já mescladas de propósito (`merge_status` não filtrado aqui) — o reconciliador
    // (Fase 4) precisa enxergar o registro-perdedor pra decidir que já foi fundido e não repetir o
    // trabalho, diferente de `listByWorkspace`/`findOrCreate`, que nunca devem expor/reusar um
    // tombstone.
    const result = await this.pool.query<Row>(
      "select * from inbox_conversations where connection_id = $1 and external_chat_id = $2 order by (merge_status is null) desc, created_at asc limit 1",
      [input.connectionId, input.externalChatId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: {
    tenantId: string;
    workspaceId: string;
    filter?: InboxConversationListFilter;
    assignedUserId?: string;
  }): Promise<InboxConversationListItem[]> {
    const conditions = ["c.tenant_id = $1", "c.workspace_id = $2", "c.merge_status is null"];
    const params: unknown[] = [input.tenantId, input.workspaceId];
    if (input.filter === "mine" && input.assignedUserId) {
      params.push(input.assignedUserId);
      conditions.push(`c.assigned_user_id = $${params.length}`);
    } else if (input.filter === "unassigned") {
      // Só o que ainda precisa de alguém — conversa finalizada sem responsável não é "trabalho
      // pendente" pra ninguém pegar.
      conditions.push("c.assigned_user_id is null and c.status <> 'resolved' and c.status <> 'archived'");
    } else if (input.filter === "unread") {
      conditions.push("c.unread_count > 0");
    } else if (input.filter === "urgent") {
      conditions.push("c.is_urgent = true");
    } else if (input.filter === "open" || input.filter === "pending" || input.filter === "resolved") {
      params.push(input.filter);
      conditions.push(`c.status = $${params.length}`);
    }
    // Join com inbox_contacts só pra listagem (read-model, Fase 3) — evita a Inbox ter que fazer
    // uma segunda chamada por conversa só pra saber o nome/telefone de quem está do outro lado.
    // LEFT JOIN (era INNER) desde a correção do bug de identidade de conversa: uma conversa de
    // GRUPO não tem `contact_id` (nunca fundida com um Contact do CRM, ver migration 0115) — um
    // INNER aqui faria todo grupo desaparecer silenciosamente da listagem.
    // LATERAL join com a última mensagem (redesign operacional) — barato porque
    // `inbox_messages_conversation_idx (conversation_id, created_at desc)` (migration 0083) já
    // existe: o planner faz um index scan de 1 linha por conversa, não uma varredura completa.
    const result = await this.pool.query<
      Row & {
        contact_name: string | null; contact_phone: string | null; crm_contact_id: string | null;
        contact_profile_picture_storage_ref: InboxMediaStorageRef | null;
        lm_type: string | null; lm_body: string | null; lm_direction: string | null; lm_sender_display_name: string | null;
      }
    >(
      `select c.*, ct.name as contact_name, ct.phone_normalized as contact_phone, ct.contact_id as crm_contact_id,
              ct.profile_picture_storage_ref as contact_profile_picture_storage_ref,
              lm.type as lm_type, lm.body as lm_body, lm.direction as lm_direction, lm.sender_display_name as lm_sender_display_name
       from inbox_conversations c
       left join inbox_contacts ct on ct.id = c.contact_id
       left join lateral (
         select type, body, direction, sender_display_name
         from inbox_messages m
         where m.conversation_id = c.id
         order by m.created_at desc
         limit 1
       ) lm on true
       where ${conditions.join(" and ")}
       order by coalesce(c.last_message_at, c.created_at) desc`,
      params,
    );
    return result.rows.map((row) => ({
      ...this.toDomain(row),
      contactName: row.contact_name ?? undefined,
      contactPhone: row.contact_phone ?? undefined,
      crmContactId: row.crm_contact_id ?? undefined,
      contactProfilePictureStorageRef: row.contact_profile_picture_storage_ref ?? undefined,
      lastMessagePreview: row.lm_type
        ? {
            type: row.lm_type as InboxMessageType, body: row.lm_body ?? undefined, direction: row.lm_direction as InboxMessageDirection,
            senderDisplayName: row.lm_sender_display_name ?? undefined,
          }
        : undefined,
    }));
  }

  async markLastMessage(id: string, input: { lastMessageAt: string; incrementUnread: boolean }): Promise<void> {
    await this.pool.query(
      `update inbox_conversations set
         last_message_at = $2,
         unread_count = unread_count + (case when $3 then 1 else 0 end),
         updated_at = now()
       where id = $1`,
      [id, input.lastMessageAt, input.incrementUnread],
    );
  }

  async updateGroupMetadata(id: string, input: { groupName?: string; participantCount?: number; metadataUpdatedAt: string }): Promise<void> {
    await this.pool.query(
      `update inbox_conversations set
         group_name = coalesce($2, group_name),
         group_participant_count = coalesce($3, group_participant_count),
         group_metadata_updated_at = $4,
         updated_at = now()
       where id = $1`,
      [id, input.groupName ?? null, input.participantCount ?? null, input.metadataUpdatedAt],
    );
  }

  async updateGroupPicture(id: string, input: { storageRef: InboxMediaStorageRef; syncedAt: string }): Promise<void> {
    await this.pool.query(
      "update inbox_conversations set group_picture_storage_ref = $2, group_picture_synced_at = $3, updated_at = now() where id = $1",
      [id, JSON.stringify(input.storageRef), input.syncedAt],
    );
  }

  async markRead(id: string): Promise<void> {
    await this.pool.query("update inbox_conversations set unread_count = 0, updated_at = now() where id = $1", [id]);
  }

  async markUnread(id: string): Promise<void> {
    // `greatest` nunca reduz uma contagem real já maior — só garante pelo menos 1 quando estava
    // zerada (mesmo filtro `unread_count > 0` já usado pelo filtro "Não lidas", nenhum campo novo).
    await this.pool.query("update inbox_conversations set unread_count = greatest(unread_count, 1), updated_at = now() where id = $1", [id]);
  }

  async setUrgent(id: string, isUrgent: boolean): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set is_urgent = $2, updated_at = now() where id = $1 returning *",
      [id, isUrgent],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async assign(id: string, assignedUserId: string | undefined): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set assigned_user_id = $2, updated_at = now() where id = $1 returning *",
      [id, assignedUserId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async setTeam(id: string, teamId: string | undefined): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set current_team_id = $2, updated_at = now() where id = $1 returning *",
      [id, teamId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async setPhase(id: string, phaseId: string | undefined): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set current_phase_id = $2, updated_at = now() where id = $1 returning *",
      [id, phaseId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async setPinned(id: string, pinned: boolean): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set is_pinned = $2, pinned_at = case when $2 then now() else null end, updated_at = now() where id = $1 returning *",
      [id, pinned],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async setStatus(id: string, status: InboxConversationStatus): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set status = $2, updated_at = now() where id = $1 returning *",
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async setAiEnabled(id: string, aiEnabled: boolean, reason?: InboxAiPauseReason): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set ai_enabled = $2, ai_paused_reason = case when $2 then null else $3 end, updated_at = now() where id = $1 returning *",
      [id, aiEnabled, reason ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async tryTakeOver(id: string, userId: string): Promise<InboxConversation | undefined> {
    // Compare-and-set numa ÚNICA instrução: a cláusula WHERE só casa se ninguém mais pegou a
    // conversa primeiro (ou se for o mesmo usuário reafirmando) — o Postgres serializa isso a
    // nível de linha, então duas requisições concorrentes nunca podem AMBAS ver `assigned_user_id
    // is null` como verdadeiro pro mesmo update; uma delas sempre perde a corrida e recebe 0 linhas
    // de volta. `ai_enabled = false`/`ai_paused_reason = 'human_takeover'` na MESMA instrução fecha
    // a janela IA+humano (Fase 4/5, requisito crítico) — nunca chamadas separadas.
    const result = await this.pool.query<Row>(
      `update inbox_conversations
       set assigned_user_id = $2, ai_enabled = false, ai_paused_reason = 'human_takeover', updated_at = now()
       where id = $1 and (assigned_user_id is null or assigned_user_id = $2)
       returning *`,
      [id, userId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async tryTransfer(id: string, input: { fromUserId: string; toUserId: string }): Promise<InboxConversation | undefined> {
    const result = await this.pool.query<Row>(
      `update inbox_conversations
       set assigned_user_id = $3, updated_at = now()
       where id = $1 and assigned_user_id = $2
       returning *`,
      [id, input.fromUserId, input.toUserId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async tryAcquireAiLock(id: string, at: string, staleBeforeIso: string): Promise<InboxConversation | undefined> {
    // Mesma CAS de sempre (`returning *` — 0 linhas = não conseguiu), só com a condição ampliada
    // para tratar um lock mais velho que `staleBeforeIso` como disponível (lease recuperável, Fase
    // 6) — nunca dois donos válidos simultâneos: o Postgres serializa a nível de linha, então só
    // uma requisição concorrente pode ver a condição como verdadeira para o mesmo UPDATE.
    const result = await this.pool.query<Row>(
      "update inbox_conversations set ai_processing_since = $2 where id = $1 and (ai_processing_since is null or ai_processing_since < $3) returning *",
      [id, at, staleBeforeIso],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async releaseAiLock(id: string, ownedAt: string): Promise<void> {
    await this.pool.query("update inbox_conversations set ai_processing_since = null where id = $1 and ai_processing_since = $2", [id, ownedAt]);
  }

  private toDomain(row: Row): InboxConversation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      connectionId: row.connection_id,
      chatType: row.chat_type as InboxChatType,
      externalChatId: row.external_chat_id,
      groupName: row.group_name ?? undefined,
      groupParticipantCount: row.group_participant_count ?? undefined,
      groupMetadataUpdatedAt: row.group_metadata_updated_at?.toISOString(),
      groupPictureStorageRef: row.group_picture_storage_ref ?? undefined,
      groupPictureSyncedAt: row.group_picture_synced_at?.toISOString(),
      contactId: row.contact_id ?? undefined,
      status: row.status as InboxConversationStatus,
      assignedUserId: row.assigned_user_id ?? undefined,
      departmentId: row.department_id ?? undefined,
      currentTeamId: row.current_team_id ?? undefined,
      currentPhaseId: row.current_phase_id ?? undefined,
      isPinned: row.is_pinned,
      pinnedAt: row.pinned_at?.toISOString(),
      lastMessageAt: row.last_message_at?.toISOString(),
      unreadCount: row.unread_count,
      isUrgent: row.is_urgent,
      aiEnabled: row.ai_enabled,
      aiPausedReason: (row.ai_paused_reason as InboxAiPauseReason | null) ?? undefined,
      aiProcessingSince: row.ai_processing_since?.toISOString(),
      automationEnabled: row.automation_enabled,
      mergeStatus: (row.merge_status as "merged" | null) ?? undefined,
      mergedIntoConversationId: row.merged_into_conversation_id ?? undefined,
      mergedAt: row.merged_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
