import type { Pool } from "pg";
import type {
  InstagramDmConversation,
  InstagramDmConversationRepositoryPort,
  InstagramDmSender,
  UpsertInstagramDmConversationInput,
} from "../../../application/ports/instagram-dm-conversation-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  instagram_business_account_id: string;
  participant_id: string;
  participant_username: string | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  last_message_from: string;
  unread: boolean;
  automation_muted: boolean;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): InstagramDmConversation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    instagramBusinessAccountId: row.instagram_business_account_id,
    participantId: row.participant_id,
    participantUsername: row.participant_username ?? undefined,
    lastMessageAt: row.last_message_at?.toISOString(),
    lastMessagePreview: row.last_message_preview ?? undefined,
    lastMessageFrom: row.last_message_from as InstagramDmSender,
    unread: row.unread,
    automationMuted: row.automation_muted,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildId(workspaceId: string, instagramBusinessAccountId: string, participantId: string): string {
  return `idc-${workspaceId}-${instagramBusinessAccountId}-${participantId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PostgresInstagramDmConversationRepository implements InstagramDmConversationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertConversation(input: UpsertInstagramDmConversationInput): Promise<InstagramDmConversation> {
    const id = input.id ?? buildId(input.workspaceId, input.instagramBusinessAccountId, input.participantId);
    const result = await this.pool.query<Row>(
      `insert into instagram_dm_conversations
         (id, tenant_id, workspace_id, instagram_business_account_id, participant_id, participant_username, last_message_at, last_message_preview, last_message_from, unread, automation_muted)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (workspace_id, instagram_business_account_id, participant_id) do update
       set participant_username = coalesce(excluded.participant_username, instagram_dm_conversations.participant_username),
           last_message_at = excluded.last_message_at, last_message_preview = excluded.last_message_preview,
           last_message_from = excluded.last_message_from, unread = excluded.unread, automation_muted = excluded.automation_muted,
           updated_at = now()
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.instagramBusinessAccountId, input.participantId, input.participantUsername ?? null,
        input.lastMessageAt ?? null, input.lastMessagePreview ?? null, input.lastMessageFrom, input.unread, input.automationMuted,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId?: string }): Promise<InstagramDmConversation[]> {
    const result = await this.pool.query<Row>(
      `select * from instagram_dm_conversations
       where tenant_id = $1 and workspace_id = $2 and ($3::text is null or instagram_business_account_id = $3)
       order by coalesce(last_message_at, created_at) desc`,
      [input.tenantId, input.workspaceId, input.instagramBusinessAccountId ?? null],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<InstagramDmConversation | undefined> {
    const result = await this.pool.query<Row>("select * from instagram_dm_conversations where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async findByParticipant(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string; participantId: string }): Promise<InstagramDmConversation | undefined> {
    const result = await this.pool.query<Row>(
      "select * from instagram_dm_conversations where tenant_id = $1 and workspace_id = $2 and instagram_business_account_id = $3 and participant_id = $4",
      [input.tenantId, input.workspaceId, input.instagramBusinessAccountId, input.participantId],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async markRead(id: string): Promise<void> {
    await this.pool.query("update instagram_dm_conversations set unread = false, updated_at = now() where id = $1", [id]);
  }

  async setAutomationMuted(id: string, muted: boolean): Promise<void> {
    await this.pool.query("update instagram_dm_conversations set automation_muted = $2, updated_at = now() where id = $1", [id, muted]);
  }
}
