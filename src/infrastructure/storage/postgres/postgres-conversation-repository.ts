import type { Pool } from "pg";
import type { ConversationRepositoryPort, CreateConversationInput } from "../../../application/ports/conversation-repository.port.js";
import type { Conversation, ConversationState } from "../../../domain/conversation/conversation.model.js";

export type ConversationIdGenerator = () => string;
const defaultIdGenerator: ConversationIdGenerator = () => `conversation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type ConversationRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  status: string;
  state: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

export class PostgresConversationRepository implements ConversationRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: ConversationIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: ConversationIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const id = this.idGenerator();
    const result = await this.pool.query<ConversationRow>(
      `insert into conversations (id, tenant_id, workspace_id, status, state, title, created_at, updated_at)
       values ($1, $2, $3, 'active', 'idle', $4, now(), now())
       returning *`,
      [id, input.tenantId, input.workspaceId, input.title ?? null],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Conversation | undefined> {
    const result = await this.pool.query<ConversationRow>("select * from conversations where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(tenantId: string, workspaceId: string): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      "select * from conversations where tenant_id = $1 and workspace_id = $2 order by updated_at desc",
      [tenantId, workspaceId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async updateState(id: string, state: ConversationState): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      "update conversations set state = $2, updated_at = now() where id = $1 returning *",
      [id, state],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    return this.toDomain(row);
  }

  private toDomain(row: ConversationRow): Conversation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      status: row.status as Conversation["status"],
      state: row.state as ConversationState,
      title: row.title ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
