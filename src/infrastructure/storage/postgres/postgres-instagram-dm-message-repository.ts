import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { InstagramDmMessage, InstagramDmMessageRepositoryPort, RecordInstagramDmMessageInput } from "../../../application/ports/instagram-dm-message-repository.port.js";
import type { InstagramDmSender } from "../../../application/ports/instagram-dm-conversation-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  direction: string;
  sender: string;
  message_id: string | null;
  message_text: string | null;
  raw_payload: unknown;
  sent_at: Date;
  created_at: Date;
};

function toDomain(row: Row): InstagramDmMessage {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    direction: row.direction as "inbound" | "outbound",
    sender: row.sender as InstagramDmSender,
    messageId: row.message_id ?? undefined,
    messageText: row.message_text ?? undefined,
    rawPayload: row.raw_payload ?? undefined,
    sentAt: row.sent_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresInstagramDmMessageRepository implements InstagramDmMessageRepositoryPort {
  constructor(private readonly pool: Pool) {}

  /** `on conflict` só se aplica de verdade quando `message_id` não é nulo (índice único trata
   * NULL como sempre distinto, então reentregas sem `mid` nunca colidem — aceitável, mensagens de
   * saída registradas localmente às vezes não têm `mid` da Meta ainda). */
  async recordMessage(input: RecordInstagramDmMessageInput): Promise<InstagramDmMessage> {
    const result = await this.pool.query<Row>(
      `insert into instagram_dm_messages (id, tenant_id, workspace_id, conversation_id, direction, sender, message_id, message_text, raw_payload, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (conversation_id, message_id) do update set message_id = excluded.message_id
       returning *`,
      [
        randomUUID(), input.tenantId, input.workspaceId, input.conversationId, input.direction, input.sender,
        input.messageId ?? null, input.messageText ?? null, input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload), input.sentAt,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string; limit?: number }): Promise<InstagramDmMessage[]> {
    const result = await this.pool.query<Row>(
      `select * from instagram_dm_messages where tenant_id = $1 and workspace_id = $2 and conversation_id = $3 order by sent_at desc limit $4`,
      [input.tenantId, input.workspaceId, input.conversationId, input.limit ?? 50],
    );
    return result.rows.map(toDomain);
  }
}
