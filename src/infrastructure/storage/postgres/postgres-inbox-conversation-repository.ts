import type { Pool } from "pg";
import type {
  FindOrCreateInboxConversationInput,
  InboxConversationListFilter,
  InboxConversationListItem,
  InboxConversationRepositoryPort,
} from "../../../application/ports/inbox-conversation-repository.port.js";
import type { InboxConversation, InboxConversationStatus } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxconv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  connection_id: string;
  contact_id: string;
  status: string;
  assigned_user_id: string | null;
  department_id: string | null;
  last_message_at: Date | null;
  unread_count: number;
  ai_enabled: boolean;
  automation_enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

export class PostgresInboxConversationRepository implements InboxConversationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async findOrCreate(input: FindOrCreateInboxConversationInput): Promise<InboxConversation> {
    const id = idGenerator();
    const result = await this.pool.query<Row>(
      `insert into inbox_conversations (id, tenant_id, workspace_id, connection_id, contact_id)
       values ($1, $2, $3, $4, $5)
       on conflict (connection_id, contact_id) do update set updated_at = inbox_conversations.updated_at
       returning *`,
      [id, input.tenantId, input.workspaceId, input.connectionId, input.contactId],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<InboxConversation | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_conversations where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: {
    tenantId: string;
    workspaceId: string;
    filter?: InboxConversationListFilter;
    assignedUserId?: string;
  }): Promise<InboxConversationListItem[]> {
    const conditions = ["c.tenant_id = $1", "c.workspace_id = $2"];
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
    } else if (input.filter === "open" || input.filter === "pending" || input.filter === "resolved") {
      params.push(input.filter);
      conditions.push(`c.status = $${params.length}`);
    }
    // Join com inbox_contacts só pra listagem (read-model, Fase 3) — evita a Inbox ter que fazer
    // uma segunda chamada por conversa só pra saber o nome/telefone de quem está do outro lado.
    const result = await this.pool.query<Row & { contact_name: string | null; contact_phone: string }>(
      `select c.*, ct.name as contact_name, ct.phone_normalized as contact_phone
       from inbox_conversations c
       join inbox_contacts ct on ct.id = c.contact_id
       where ${conditions.join(" and ")}
       order by coalesce(c.last_message_at, c.created_at) desc`,
      params,
    );
    return result.rows.map((row) => ({ ...this.toDomain(row), contactName: row.contact_name ?? undefined, contactPhone: row.contact_phone }));
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

  async markRead(id: string): Promise<void> {
    await this.pool.query("update inbox_conversations set unread_count = 0, updated_at = now() where id = $1", [id]);
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

  async setStatus(id: string, status: InboxConversationStatus): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set status = $2, updated_at = now() where id = $1 returning *",
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  async setAiEnabled(id: string, aiEnabled: boolean): Promise<InboxConversation> {
    const result = await this.pool.query<Row>(
      "update inbox_conversations set ai_enabled = $2, updated_at = now() where id = $1 returning *",
      [id, aiEnabled],
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
    // de volta. `ai_enabled = false` na MESMA instrução fecha a janela IA+humano (Fase 4, requisito
    // crítico) — nunca duas chamadas separadas.
    const result = await this.pool.query<Row>(
      `update inbox_conversations
       set assigned_user_id = $2, ai_enabled = false, updated_at = now()
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

  private toDomain(row: Row): InboxConversation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      connectionId: row.connection_id,
      contactId: row.contact_id,
      status: row.status as InboxConversationStatus,
      assignedUserId: row.assigned_user_id ?? undefined,
      departmentId: row.department_id ?? undefined,
      lastMessageAt: row.last_message_at?.toISOString(),
      unreadCount: row.unread_count,
      aiEnabled: row.ai_enabled,
      automationEnabled: row.automation_enabled,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
